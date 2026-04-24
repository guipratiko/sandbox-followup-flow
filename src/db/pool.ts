import { Pool } from 'pg';
import { env } from '../config/env';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!env.postgresUri) {
    throw new Error('POSTGRES_URI não configurado.');
  }
  if (!pool) {
    pool = new Pool({ connectionString: env.postgresUri, max: 10 });
  }
  return pool;
}
