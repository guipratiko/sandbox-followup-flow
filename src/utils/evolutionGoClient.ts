import axios from 'axios';
import https from 'https';
import { env } from '../config/env';

function client(instanceToken: string) {
  const baseURL = env.evolutionBaseUrl.replace(/\/$/, '');
  if (!baseURL) throw new Error('EVOLUTION_API_BASE_URL / EVOLUTION_HOST não configurado.');
  const httpsAgent = env.evolutionInsecureTls
    ? new https.Agent({ rejectUnauthorized: false })
    : undefined;
  return axios.create({
    baseURL,
    timeout: 90_000,
    headers: { apikey: instanceToken.trim(), 'Content-Type': 'application/json' },
    httpsAgent,
    validateStatus: () => true,
  });
}

export async function requestEvolutionGo(
  method: 'POST',
  path: string,
  options: { instanceToken: string; body?: unknown }
): Promise<{ statusCode: number; data: unknown }> {
  const c = client(options.instanceToken);
  const res = await c.request({ method, url: path, data: options.body });
  if (res.status >= 400) {
    throw new Error(
      `HTTP ${res.status} ${res.statusText}\nPATH: ${path}\nRESPONSE: ${JSON.stringify(res.data).slice(0, 800)}`
    );
  }
  return { statusCode: res.status, data: res.data };
}

export function toEvolutionRecipientNumber(value: string): string {
  const trimmed = String(value ?? '').trim();
  if (trimmed.endsWith('@s.whatsapp.net')) return trimmed.slice(0, -'@s.whatsapp.net'.length);
  if (trimmed.endsWith('@c.us')) return trimmed.slice(0, -'@c.us'.length);
  return trimmed;
}
