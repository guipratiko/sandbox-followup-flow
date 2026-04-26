import dotenv from 'dotenv';

dotenv.config();

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
  /** Opcional: mesmo REDIS_URI do backend OnlyFlow — invalida cache do chat após espelhar mensagem. */
  redisUri: (process.env.REDIS_URI || '').trim(),
  /** URL base do backend OnlyFlow (ex.: https://api.seudominio.com) — notificação Socket.IO após espelho. */
  onlyflowBackendUrl: (process.env.ONLYFLOW_BACKEND_URL || '').trim(),
  /** Igual a ONLYFLOW_FOLLOWUP_NOTIFY_KEY no backend. */
  onlyflowFollowupNotifyKey: (process.env.ONLYFLOW_FOLLOWUP_NOTIFY_KEY || '').trim(),
  postgresUri: (process.env.POSTGRES_URI || '').trim(),
  jwtSecret: (process.env.JWT_SECRET || '').trim(),
  evolutionBaseUrl: normalizeEvolutionBaseUrl(process.env.EVOLUTION_API_BASE_URL || ''),
  evolutionApiKey: (process.env.EVOLUTION_API_KEY || '').trim(),
  evolutionInsecureTls: process.env.EVOLUTION_INSECURE_TLS === 'true',
  corsOrigins: parseOrigins(process.env.CORS_ORIGINS),
};
