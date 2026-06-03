import { env } from '../config/env';
import { brazilWhatsappEvolutionCandidates, digitsFromWhatsappRemote } from '../utils/brazilWhatsappEvolutionNumbers';
import { requestEvolutionGo, toEvolutionRecipientNumber } from '../utils/evolutionGoClient';

export function extractMessageId(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const o = data as Record<string, unknown>;
  const inner = (o.data ?? o) as Record<string, unknown>;
  const info = (inner.Info ?? inner.info) as Record<string, unknown> | undefined;
  const key = inner.key as Record<string, unknown> | undefined;
  const id =
    (typeof info?.ID === 'string' && info.ID) ||
    (typeof info?.Id === 'string' && info.Id) ||
    (typeof key?.id === 'string' && key.id) ||
    (typeof inner.messageId === 'string' && inner.messageId) ||
    '';
  return id.trim();
}

export type FollowupPayload = {
  text?: string;
  image?: string;
  video?: string;
  audio?: string;
  document?: string;
  caption?: string;
  fileName?: string;
};

function formatGoError(raw: string, instanceIdHint: string): string {
  try {
    const match = raw.match(/RESPONSE:\s*(\{[\s\S]*\})/);
    if (match) {
      const p = JSON.parse(match[1]) as { error?: string | { message?: string } };
      if (typeof p.error === 'string') return p.error;
      if (p.error && typeof p.error === 'object' && p.error.message) return String(p.error.message);
    }
  } catch {
    /* ignore */
  }
  const lower = raw.toLowerCase();
  if (lower.includes('not registered on whatsapp')) {
    return 'Número não registrado no WhatsApp.';
  }
  return raw.slice(0, 2000) + (instanceIdHint ? ` (instância ${instanceIdHint})` : '');
}

function evolutionErrorSuggestsBrazilVariantRetry(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('not registered') ||
    m.includes('exists') && m.includes('false') ||
    m.includes('invalid wid') ||
    m.includes('is not on whatsapp') ||
    m.includes('no whatsapp account')
  );
}

async function evolutionSendWithDigits(
  instanceToken: string,
  numberDigits: string,
  payload: FollowupPayload
): Promise<unknown> {
  const number = toEvolutionRecipientNumber(numberDigits);

  if (payload.text) {
    const { data } = await requestEvolutionGo('POST', '/send/text', {
      instanceToken,
      body: { number, text: payload.text },
    });
    return data;
  }
  if (payload.image) {
    const { data } = await requestEvolutionGo('POST', '/send/media', {
      instanceToken,
      body: {
        number,
        type: 'image',
        url: payload.image,
        ...(payload.caption?.trim() ? { caption: payload.caption.trim() } : {}),
      },
    });
    return data;
  }
  if (payload.video) {
    const { data } = await requestEvolutionGo('POST', '/send/media', {
      instanceToken,
      body: {
        number,
        type: 'video',
        url: payload.video,
        ...(payload.caption?.trim() ? { caption: payload.caption.trim() } : {}),
      },
    });
    return data;
  }
  if (payload.audio) {
    const { data } = await requestEvolutionGo('POST', '/send/media', {
      instanceToken,
      body: { number, type: 'audio', url: payload.audio },
    });
    return data;
  }
  if (payload.document) {
    const { data } = await requestEvolutionGo('POST', '/send/media', {
      instanceToken,
      body: {
        number,
        type: 'document',
        url: payload.document,
        filename: payload.fileName?.trim() || 'arquivo',
        ...(payload.caption?.trim() ? { caption: payload.caption.trim() } : {}),
      },
    });
    return data;
  }
  throw new Error('Payload de envio vazio.');
}

export async function evolutionSend(
  instanceToken: string,
  number: string,
  payload: FollowupPayload
): Promise<unknown> {
  const digits = digitsFromWhatsappRemote(number);
  if (!digits) throw new Error('Número / JID inválido para envio Evolution GO.');
  try {
    return await evolutionSendWithDigits(instanceToken, digits, payload);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(formatGoError(msg, ''));
  }
}

export async function evolutionSendFollowupWithBrazilVariantRetry(
  instanceToken: string,
  remoteJid: string,
  payload: FollowupPayload
): Promise<unknown> {
  const base = digitsFromWhatsappRemote(remoteJid);
  if (!base) throw new Error('JID WhatsApp inválido para follow-up.');
  const candidates = brazilWhatsappEvolutionCandidates(base);
  let lastError: Error = new Error('Falha ao enviar follow-up.');
  for (let i = 0; i < candidates.length; i++) {
    try {
      return await evolutionSendWithDigits(instanceToken, candidates[i], payload);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      const canRetry =
        i < candidates.length - 1 && evolutionErrorSuggestsBrazilVariantRetry(lastError.message);
      if (!canRetry) throw new Error(formatGoError(lastError.message, ''));
    }
  }
  throw lastError;
}

export function buildPayloadFromStep(
  messageType: string,
  payload: Record<string, unknown>
): FollowupPayload {
  const text = typeof payload.text === 'string' ? payload.text : '';
  const mediaUrl = typeof payload.mediaUrl === 'string' ? payload.mediaUrl.trim() : '';
  const caption = typeof payload.caption === 'string' ? payload.caption : '';
  const fileName = typeof payload.fileName === 'string' ? payload.fileName : '';

  switch (messageType) {
    case 'text':
      return { text: text.trim() };
    case 'image':
      return { image: mediaUrl, caption: '' };
    case 'image_caption':
      return { image: mediaUrl, caption };
    case 'video':
      return { video: mediaUrl, caption: '' };
    case 'video_caption':
      return { video: mediaUrl, caption };
    case 'audio':
      return { audio: mediaUrl };
    case 'document':
      return { document: mediaUrl, fileName: fileName || 'arquivo', caption };
    default:
      throw new Error(`Tipo de mensagem inválido: ${messageType}`);
  }
}
