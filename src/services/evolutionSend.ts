import axios, { type AxiosInstance } from 'axios';
import https from 'https';
import { env } from '../config/env';
import { brazilWhatsappEvolutionCandidates, digitsFromWhatsappRemote } from '../utils/brazilWhatsappEvolutionNumbers';

function client(): AxiosInstance {
  const httpsAgent = env.evolutionInsecureTls ? new https.Agent({ rejectUnauthorized: false }) : undefined;
  return axios.create({
    baseURL: env.evolutionBaseUrl,
    timeout: 90_000,
    headers: {
      ...(env.evolutionApiKey ? { apikey: env.evolutionApiKey } : {}),
      'Content-Type': 'application/json',
    },
    httpsAgent,
    validateStatus: () => true,
  });
}

export function extractMessageId(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const o = data as Record<string, unknown>;
  const pick = (obj: Record<string, unknown>): string => {
    const key = obj.key as Record<string, unknown> | undefined;
    if (key && typeof key.id === 'string' && key.id.trim()) return key.id.trim();
    if (typeof obj.messageId === 'string' && obj.messageId.trim()) return obj.messageId.trim();
    return '';
  };
  const direct = pick(o);
  if (direct) return direct;
  const nested = o.data;
  if (nested && typeof nested === 'object') return pick(nested as Record<string, unknown>);
  return '';
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

function stringifyMsg(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' && x !== null ? JSON.stringify(x) : String(x))).join('; ');
  if (v && typeof v === 'object') {
    try {
      return JSON.stringify(v).slice(0, 1500);
    } catch {
      return null;
    }
  }
  return null;
}

function formatEvolutionHttpError(status: number, d: unknown, instanceName: string): string {
  if (d && typeof d === 'object' && !Array.isArray(d)) {
    const o = d as Record<string, unknown>;
    if (o.exists === false) {
      const hint =
        'Número não encontrado no WhatsApp (exists: false). Se o contato usa o formato antigo sem o 9 após o DDD, o sistema tentará a variante automaticamente; confirme também se o número está no WhatsApp.';
      const n = o.number ?? o.jid;
      const tail = typeof n === 'string' ? ` Detalhe: ${n}` : ` Resposta: ${JSON.stringify(o).slice(0, 400)}`;
      return `${hint}${tail}`;
    }
    const fromRoot = stringifyMsg(o.message);
    if (fromRoot) {
      let msg = fromRoot;
      if (o.response && typeof o.response === 'object') {
        const r = o.response as Record<string, unknown>;
        const fromResp = stringifyMsg(r.message);
        if (fromResp) msg = `${msg} | ${fromResp}`;
      }
      if (status === 404) {
        msg += ` (instância «${instanceName}» — na Evolution use o nome interno da instância, não o nome de exibição)`;
      }
      return msg.slice(0, 2000);
    }
  }
  let msg = `Evolution HTTP ${status}`;
  if (d != null) {
    const s = stringifyMsg(d);
    if (s) msg = s;
  }
  if (status === 404) {
    msg += ` (instância «${instanceName}» — na Evolution use o nome interno da instância, não o nome de exibição)`;
  }
  return msg.slice(0, 2000);
}

function evolutionErrorSuggestsBrazilVariantRetry(message: string): boolean {
  const m = message.toLowerCase();
  return (
    (m.includes('exists') && m.includes('false')) ||
    m.includes('not registered') ||
    m.includes('invalid wid') ||
    m.includes('is not on whatsapp') ||
    m.includes('no whatsapp account')
  );
}

/**
 * POST Evolution com `number` só em dígitos (sem @s.whatsapp.net), como a API costuma esperar.
 */
async function evolutionSendWithDigits(
  instanceName: string,
  numberDigits: string,
  payload: FollowupPayload
): Promise<unknown> {
  if (!env.evolutionBaseUrl) {
    throw new Error('EVOLUTION_API_BASE_URL não configurado.');
  }
  const c = client();
  let path = '';
  const body: Record<string, unknown> = { number: numberDigits.replace(/\D/g, '') };

  if (payload.text) {
    path = `/message/sendText/${encodeURIComponent(instanceName)}`;
    body.text = payload.text;
  } else if (payload.image) {
    path = `/message/sendMedia/${encodeURIComponent(instanceName)}`;
    body.mediatype = 'image';
    body.media = payload.image;
    body.caption = payload.caption?.trim() || '';
  } else if (payload.video) {
    path = `/message/sendMedia/${encodeURIComponent(instanceName)}`;
    body.mediatype = 'video';
    body.media = payload.video;
    body.caption = payload.caption?.trim() || '';
  } else if (payload.audio) {
    path = `/message/sendWhatsAppAudio/${encodeURIComponent(instanceName)}`;
    body.audio = payload.audio;
  } else if (payload.document) {
    path = `/message/sendMedia/${encodeURIComponent(instanceName)}`;
    body.mediatype = 'document';
    body.media = payload.document;
    body.fileName = payload.fileName?.trim() || 'arquivo';
    body.caption = payload.caption?.trim() || '';
  } else {
    throw new Error('Payload de envio vazio.');
  }

  let res;
  try {
    res = await c.post(path, body);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('Invalid URL')) {
      throw new Error(
        'URL da Evolution inválida (EVOLUTION_API_BASE_URL). Use URL absoluta, ex.: https://sua-api.com'
      );
    }
    throw e instanceof Error ? e : new Error(String(e));
  }
  if (res.status >= 400) {
    throw new Error(formatEvolutionHttpError(res.status, res.data, instanceName));
  }
  return res.data;
}

/** Envio único: aceita JID completo ou só dígitos; normaliza para dígitos no body. */
export async function evolutionSend(instanceName: string, number: string, payload: FollowupPayload): Promise<unknown> {
  const digits = digitsFromWhatsappRemote(number);
  if (!digits) {
    throw new Error('Número / JID inválido para envio Evolution.');
  }
  return evolutionSendWithDigits(instanceName, digits, payload);
}

/**
 * Follow-up CRM: tenta o número como está no CRM; se a Evolution indicar “não existe” no WhatsApp,
 * tenta a variante brasileira com/sem o 9 após o DDD (ex.: 556284884280 ↔ 5562984884280).
 */
export async function evolutionSendFollowupWithBrazilVariantRetry(
  instanceName: string,
  remoteJid: string,
  payload: FollowupPayload
): Promise<unknown> {
  const base = digitsFromWhatsappRemote(remoteJid);
  if (!base) {
    throw new Error('JID WhatsApp inválido para follow-up.');
  }
  const candidates = brazilWhatsappEvolutionCandidates(base);
  let lastError: Error = new Error('Falha ao enviar follow-up.');
  for (let i = 0; i < candidates.length; i++) {
    const d = candidates[i];
    try {
      return await evolutionSendWithDigits(instanceName, d, payload);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      const canRetry = i < candidates.length - 1 && evolutionErrorSuggestsBrazilVariantRetry(lastError.message);
      if (!canRetry) {
        throw lastError;
      }
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
