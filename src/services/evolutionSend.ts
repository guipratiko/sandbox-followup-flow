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
  const key = o.key as Record<string, unknown> | undefined;
  if (key && typeof key.id === 'string') return key.id;
  if (typeof o.messageId === 'string') return o.messageId;
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

  const res = await c.post(path, body);
  if (res.status >= 400) {
    const msg =
      (res.data && typeof res.data === 'object' && (res.data as { message?: string }).message) ||
      `Evolution HTTP ${res.status}`;
    throw new Error(String(msg));
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
