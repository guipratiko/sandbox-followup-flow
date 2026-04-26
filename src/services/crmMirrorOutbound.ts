/**
 * Espelha no Postgres (tabela `messages` do CRM) o envio feito pelo worker,
 * para o chat refletir a mensagem mesmo quando o webhook da Evolution não chega ou chega incompleto.
 */

import type { Pool } from 'pg';
import Redis from 'ioredis';
import { env } from '../config/env';
import { notifyOnlyflowFollowupMirror, type FollowupMirrorSocketMessage } from './notifyOnlyflowChat';

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
  /** Instantâneo do envio (Evolution); fallback `new Date()` no worker. */
  sentAt: Date;
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
  const ts = params.sentAt;

  const insertRes = await params.pool.query<{
    id: string;
    message_id: string;
    from_me: boolean;
    message_type: string;
    content: string;
    media_url: string | null;
    timestamp: Date;
    read: boolean;
    automated_outbound: boolean;
    followup_outbound: boolean;
  }>(
    `INSERT INTO messages (
       user_id, instance_id, contact_id, remote_jid,
       message_id, from_me, message_type, content,
       media_url, timestamp, read, automated_outbound, followup_outbound, reactions
     ) VALUES ($1, $2, $3::uuid, $4, $5, true, $6, $7, $8, $9, true, false, true, '[]'::jsonb)
     ON CONFLICT (message_id, instance_id, contact_id) DO UPDATE SET
       followup_outbound = true,
       updated_at = CURRENT_TIMESTAMP
     RETURNING id, message_id, from_me, message_type, content, media_url, timestamp, read, automated_outbound, followup_outbound`,
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

  const row = insertRes.rows[0];
  if (!row) {
    return;
  }

  const socketMsg: FollowupMirrorSocketMessage = {
    id: row.id,
    messageId: row.message_id,
    channel: 'whatsapp',
    fromMe: row.from_me,
    messageType: row.message_type,
    content: row.content,
    mediaUrl: row.media_url,
    timestamp: row.timestamp.toISOString(),
    read: row.read,
    automatedOutbound: row.automated_outbound === true,
    followupOutbound: row.followup_outbound === true,
    reactions: [],
  };

  await notifyOnlyflowFollowupMirror({
    userId: params.userId,
    instanceId: params.instanceId,
    contactId: params.contactId,
    message: socketMsg,
  });
}
