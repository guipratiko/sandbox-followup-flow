import axios, { type AxiosInstance } from 'axios';
import https from 'https';
import { env } from '../config/env';

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

export async function evolutionSend(instanceName: string, number: string, payload: FollowupPayload): Promise<unknown> {
  if (!env.evolutionBaseUrl) {
    throw new Error('EVOLUTION_API_BASE_URL não configurado.');
  }
  const c = client();
  let path = '';
  let body: Record<string, unknown> = { number };

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
    throw e;
  }
  if (res.status >= 400) {
    const d = res.data;
    let msg = `Evolution HTTP ${res.status}`;
    const stringifyMsg = (v: unknown): string | null => {
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
    };
    if (d && typeof d === 'object' && !Array.isArray(d)) {
      const o = d as Record<string, unknown>;
      const fromRoot = stringifyMsg(o.message);
      if (fromRoot) msg = fromRoot;
      else if (o.response && typeof o.response === 'object') {
        const r = o.response as Record<string, unknown>;
        const fromResp = stringifyMsg(r.message);
        if (fromResp) msg = fromResp;
      }
    } else if (d != null) {
      const s = stringifyMsg(d);
      if (s) msg = s;
    }
    if (res.status === 404) {
      msg += ` (instância «${instanceName}» — na Evolution use o nome interno da instância, não o nome de exibição)`;
    }
    throw new Error(msg.slice(0, 2000));
  }
  return res.data;
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
