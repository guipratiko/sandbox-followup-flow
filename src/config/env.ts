import dotenv from 'dotenv';

dotenv.config();

/** Fuso do processo Node (alinhado ao Brasil; override com TZ ou APP_TIMEZONE). */
if (!process.env.TZ?.trim()) {
  process.env.TZ = (process.env.APP_TIMEZONE || 'America/Sao_Paulo').trim();
}

function parseOrigins(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * URL absoluta para o cliente HTTP da Evolution. Host sem esquema vira https://
 * (axios lança "Invalid URL" se faltar protocolo).
 */
function normalizeEvolutionBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, '');
  if (!trimmed) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    if (!u.hostname) return '';
    const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
    return `${u.origin}${path}`;
  } catch {
    return '';
  }
}

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT) || 4337,
  /** Base URL do backend OnlyFlow (ex.: https://api.onlyflow.com.br) — notificação Socket após espelhar mensagem. */
  onlyflowApiBaseUrl: (process.env.ONLYFLOW_API_BASE_URL || '').trim().replace(/\/$/, ''),
  /** Mesmo segredo que FOLLOWUP_MIRROR_NOTIFY_SECRET no .env do backend. */
  followupMirrorNotifySecret: (process.env.FOLLOWUP_MIRROR_NOTIFY_SECRET || '').trim(),
  /** Opcional: mesmo REDIS_URI do backend OnlyFlow — invalida cache do chat após espelhar mensagem. */
  redisUri: (process.env.REDIS_URI || '').trim(),
  postgresUri: (process.env.POSTGRES_URI || '').trim(),
  jwtSecret: (process.env.JWT_SECRET || '').trim(),
  evolutionBaseUrl: normalizeEvolutionBaseUrl(process.env.EVOLUTION_API_BASE_URL || ''),
  evolutionApiKey: (process.env.EVOLUTION_API_KEY || '').trim(),
  evolutionInsecureTls: process.env.EVOLUTION_INSECURE_TLS === 'true',
  corsOrigins: parseOrigins(process.env.CORS_ORIGINS),
};
