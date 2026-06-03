import type { PoolClient } from 'pg';

const WHATSAPP_NET_SUFFIX = '@s.whatsapp.net';

/** Variantes de JID para bater com o card gravado no Postgres (com/sem 9º dígito BR). */
function whatsappRemoteJidLookupVariants(remoteJid: string): string[] {
  if (!remoteJid || typeof remoteJid !== 'string') return [];
  const lower = remoteJid.toLowerCase();
  if (!lower.endsWith(WHATSAPP_NET_SUFFIX)) return [remoteJid];

  const digits = remoteJid.split('@')[0].replace(/\D/g, '');
  if (!digits) return [remoteJid];

  const set = new Set<string>([remoteJid, `${digits}${WHATSAPP_NET_SUFFIX}`]);
  if (digits.startsWith('55') && digits.length === 13 && digits[4] === '9') {
    set.add(`55${digits.slice(2, 4)}${digits.slice(5)}${WHATSAPP_NET_SUFFIX}`);
  }
  if (digits.startsWith('55') && digits.length === 12) {
    set.add(`55${digits.slice(2, 4)}9${digits.slice(4)}${WHATSAPP_NET_SUFFIX}`);
  }
  return Array.from(set);
}

/**
 * Resolve o UUID do contato CRM (Postgres) para o tenant.
 * Aceita contactId direto ou fallback por instanceId + remoteJid.
 */
export async function resolveContactIdForTenant(
  client: PoolClient,
  tenantUserId: string,
  contactId: string,
  instanceId: string,
  remoteJid: string
): Promise<string | null> {
  const byId = await client.query<{ id: string }>(
    `SELECT id FROM contacts WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [contactId, tenantUserId]
  );
  if (byId.rows[0]?.id) return byId.rows[0].id;

  const jids = whatsappRemoteJidLookupVariants(remoteJid);
  if (!instanceId || jids.length === 0) return null;

  const byJid = await client.query<{ id: string }>(
    `SELECT id FROM contacts
     WHERE user_id = $1 AND instance_id = $2 AND remote_jid = ANY($3::text[])
     ORDER BY last_message_at DESC NULLS LAST, updated_at DESC
     LIMIT 1`,
    [tenantUserId, instanceId, jids]
  );
  return byJid.rows[0]?.id ?? null;
}
