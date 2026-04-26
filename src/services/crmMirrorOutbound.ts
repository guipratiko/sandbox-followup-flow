/**
 * Espelha no Postgres (tabela `messages` do CRM) o envio feito pelo worker,
 * para o chat refletir a mensagem mesmo quando o webhook da Evolution não chega ou chega incompleto.
 */

import type { Pool } from 'pg';
import Redis from 'ioredis';
import { env } from '../config/env';

function buildMirrorPayload(
  followupMessageType: string,
  payload: Record<string, unknown>
): { content: string; mediaUrl: string | null; messageTypeCrm: string } {
  const text = typeof payload.text === 'string' ? payload.text.trim() : '';
  const mediaUrl = typeof payload.mediaUrl === 'string' ? payload.mediaUrl.trim() : '';
  const caption = typeof payload.caption === 'string' ? payload.caption.trim() : '';

  switch (followupMessageType) {
    case 'text':
      return {
        content: text.length > 0 ? text : '[Follow-up]',
        messageTypeCrm: 'conversation',
        mediaUrl: null,
      };
    case 'image':
      return { content: '[Mídia]', messageTypeCrm: 'imageMessage', mediaUrl: mediaUrl || null };
    case 'image_caption':
      return {
        content: caption.length > 0 ? caption : '[Mídia]',
        messageTypeCrm: 'imageMessage',
        mediaUrl: mediaUrl || null,
      };
    case 'video':
      return { content: '[Mídia]', messageTypeCrm: 'videoMessage', mediaUrl: mediaUrl || null };
    case 'video_caption':
      return {
        content: caption.length > 0 ? caption : '[Mídia]',
        messageTypeCrm: 'videoMessage',
        mediaUrl: mediaUrl || null,
      };
    case 'audio':
      return { content: '[Mídia]', messageTypeCrm: 'audioMessage', mediaUrl: mediaUrl || null };
    case 'document':
      return { content: '[Mídia]', messageTypeCrm: 'documentMessage', mediaUrl: mediaUrl || null };
    default:
      return { content: '[Mídia]', messageTypeCrm: 'conversation', mediaUrl: null };
  }
}

/** Tenta obter o instante real da mensagem na resposta da Evolution (alinha ordem ao WhatsApp). */
function parseEvolutionMessageTimestamp(evolutionRaw: unknown): Date | null {
  if (!evolutionRaw || typeof evolutionRaw !== 'object') return null;
  const o = evolutionRaw as Record<string, unknown>;

  const fromKey = (key: Record<string, unknown> | undefined): Date | null => {
    if (!key) return null;
    const t = key.messageTimestamp ?? key.t;
    const n = Number(t);
    if (!Number.isFinite(n) || n <= 0) return null;
    const ms = n < 1e12 ? n * 1000 : n;
    return new Date(ms);
  };

  let d = fromKey(o.key as Record<string, unknown> | undefined);
  if (d) return d;

  const nested = o.data;
  if (nested && typeof nested === 'object') {
    d = fromKey((nested as Record<string, unknown>).key as Record<string, unknown> | undefined);
    if (d) return d;
  }

  const top = Number(o.messageTimestamp);
  if (Number.isFinite(top) && top > 0) {
    const ms = top < 1e12 ? top * 1000 : top;
    return new Date(ms);
  }

  return null;
}

function resolveMirrorTimestamp(scheduledAt: Date, evolutionRaw: unknown): Date {
  const fromEvolution = parseEvolutionMessageTimestamp(evolutionRaw);
  if (fromEvolution && !Number.isNaN(fromEvolution.getTime())) {
    return fromEvolution;
  }
  if (scheduledAt && !Number.isNaN(scheduledAt.getTime())) {
    return scheduledAt;
  }
  return new Date();
}

/** Mesmo padrão de chaves que o backend usa em MessageService.invalidateCache */
async function invalidateCrmChatCache(contactId: string): Promise<void> {
  const uri = env.redisUri;
  if (!uri) return;

  const patterns = [
    `chat:messages:${contactId}:page:*`,
    `chat:messages:${contactId}:recent`,
  ];

  const redis = new Redis(uri, { maxRetriesPerRequest: 2, enableReadyCheck: false });
  try {
    for (const pattern of patterns) {
      const keys = new Set<string>();
      let cursor = '0';
      do {
        const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = next;
        for (const k of batch) keys.add(k);
      } while (cursor !== '0');
      if (keys.size > 0) {
        await redis.del(...Array.from(keys));
      }
    }
  } finally {
    redis.disconnect();
  }
}

/**
 * Insere (ou marca followup em conflito) a linha em `messages` para o CRM mostrar o envio.
 */
export async function mirrorFollowupOutboundToMessages(params: {
  pool: Pool;
  userId: string;
  instanceId: string;
  contactId: string;
  remoteJid: string;
  evolutionMessageId: string;
  followupMessageType: string;
  payload: Record<string, unknown>;
  /** Horário agendado da etapa (fallback se a Evolution não devolver messageTimestamp). */
  scheduledAt: Date;
  /** Resposta JSON bruta da Evolution após envio (para extrair timestamp real). */
  evolutionRaw?: unknown;
}): Promise<void> {
  const mid = String(params.evolutionMessageId ?? '').trim();
  if (!mid) {
    console.warn('[followup-flow] mirror CRM: evolution message id vazio — ignorado.');
    return;
  }

  const { content, mediaUrl, messageTypeCrm } = buildMirrorPayload(
    params.followupMessageType,
    params.payload
  );
  const ts = resolveMirrorTimestamp(params.scheduledAt, params.evolutionRaw);

  await params.pool.query(
    `INSERT INTO messages (
       user_id, instance_id, contact_id, remote_jid,
       message_id, from_me, message_type, content,
       media_url, timestamp, read, automated_outbound, followup_outbound, reactions
     ) VALUES ($1, $2, $3::uuid, $4, $5, true, $6, $7, $8, $9, true, false, true, '[]'::jsonb)
     ON CONFLICT (message_id, instance_id, contact_id) DO UPDATE SET
       followup_outbound = true,
       timestamp = EXCLUDED.timestamp,
       updated_at = CURRENT_TIMESTAMP`,
    [
      params.userId,
      params.instanceId,
      params.contactId,
      params.remoteJid,
      mid,
      messageTypeCrm,
      content,
      mediaUrl,
      ts,
    ]
  );

  try {
    await invalidateCrmChatCache(params.contactId);
  } catch (e) {
    console.warn('[followup-flow] Falha ao invalidar cache Redis do chat:', e instanceof Error ? e.message : e);
  }
}
