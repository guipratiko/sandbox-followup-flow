import dotenv from 'dotenv';

dotenv.config();

function parseOrigins(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT) || 4337,
  postgresUri: (process.env.POSTGRES_URI || '').trim(),
  jwtSecret: (process.env.JWT_SECRET || '').trim(),
  evolutionBaseUrl: (process.env.EVOLUTION_API_BASE_URL || '').replace(/\/$/, ''),
  evolutionApiKey: (process.env.EVOLUTION_API_KEY || '').trim(),
  evolutionInsecureTls: process.env.EVOLUTION_INSECURE_TLS === 'true',
  corsOrigins: parseOrigins(process.env.CORS_ORIGINS),
};
