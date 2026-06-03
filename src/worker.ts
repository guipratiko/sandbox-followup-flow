import { getPool } from './db/pool';
import { mirrorFollowupOutboundToMessages } from './services/crmMirrorOutbound';
import {
  buildPayloadFromStep,
  evolutionSend,
  evolutionSendFollowupWithBrazilVariantRetry,
  extractMessageId,
} from './services/evolutionSend';
import { fetchInstanceWhatsappCredentials } from './utils/onlyflowInstanceCredentials';
import { normalizeEvolutionSendTimestamp } from './utils/whatsappTime';
import { tryScheduleNextRecurrenceCycle } from './services/recurrence';
import { checkUserAutomationPlan } from './services/onlyflowPlanCheck';
import { applyVariablesToFollowupPayload } from './utils/variableReplacer';

const ALLOWED_INTEGRATIONS = new Set<string | null | undefined>([
  null,
  undefined,
  '',
  'WHATSAPP-GO',
  'WHATSAPP-BAILEYS',
  'evolution',
  'EVOLUTION',
]);

async function logEvent(
  sequenceId: string,
  stepId: string | null,
  eventType: string,
  detail?: string,
  meta?: unknown
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO crm_followup_events (sequence_id, step_id, event_type, detail, meta)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [sequenceId, stepId, eventType, detail ?? null, meta ? JSON.stringify(meta) : null]
  );
}

/** Reivindica uma etapa (pending → processing) e devolve dados para envio. */
async function claimOneStep(): Promise<{
  step_id: string;
  sequence_id: string;
  message_type: string;
  payload: Record<string, unknown>;
  instance_name: string;
  remote_jid: string;
  instance_integration: string | null;
  user_id: string;
  contact_id: string;
  instance_id: string;
  contact_name: string | null;
} | null> {
  const pool = getPool();
  const { rows } = await pool.query<{
    step_id: string;
    sequence_id: string;
    message_type: string;
    payload: Record<string, unknown>;
    instance_name: string;
    remote_jid: string;
    instance_integration: string | null;
    user_id: string;
    contact_id: string;
    instance_id: string;
    contact_name: string | null;
  }>(
    `WITH picked AS (
       SELECT s.id AS step_id, s.sequence_id, s.message_type, s.payload,
              seq.instance_name, seq.remote_jid, seq.instance_integration,
              seq.user_id::text AS user_id, seq.contact_id::text AS contact_id, seq.instance_id::text AS instance_id,
              seq.contact_name
       FROM crm_followup_steps s
       INNER JOIN crm_followup_sequences seq ON seq.id = s.sequence_id
       WHERE s.status = 'pending'
         AND seq.status = 'active'
         AND s.scheduled_at <= NOW()
       ORDER BY s.scheduled_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE crm_followup_steps s
     SET status = 'processing', updated_at = NOW()
     FROM picked
     WHERE s.id = picked.step_id
     RETURNING s.id AS step_id, picked.sequence_id, picked.message_type, picked.payload,
               picked.instance_name, picked.remote_jid, picked.instance_integration,
               picked.user_id, picked.contact_id, picked.instance_id, picked.contact_name`
  );
  return rows[0] ?? null;
}

export async function processDueFollowupSteps(): Promise<void> {
  const pool = getPool();
  for (let n = 0; n < 40; n++) {
    const row = await claimOneStep();
    if (!row) break;

    const planCheck = await checkUserAutomationPlan(row.user_id);
    if (!planCheck.ok) {
      if (planCheck.reason === 'free_plan') {
        await pool.query(
          `UPDATE crm_followup_steps SET status = 'cancelled', error_message = $2, updated_at = NOW() WHERE id = $1`,
          [row.step_id, 'Plano free: follow-up cancelado.']
        );
        await pool.query(
          `UPDATE crm_followup_sequences SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND status = 'active'`,
          [row.sequence_id]
        );
        await logEvent(row.sequence_id, row.step_id, 'cancelled', 'plan_free');
      } else {
        const msg =
          planCheck.reason === 'config_missing'
            ? 'Serviço de follow-up sem configuração de plano (ONLYFLOW_API_BASE_URL / ONLYFLOW_INTERNAL_KEY).'
            : `Falha ao verificar plano: ${planCheck.detail}`;
        await pool.query(
          `UPDATE crm_followup_steps SET status = 'pending', error_message = $2, updated_at = NOW() WHERE id = $1`,
          [row.step_id, msg.slice(0, 2000)]
        );
        await logEvent(row.sequence_id, row.step_id, 'plan_check_failed', msg.slice(0, 500));
        console.error(`[followup-flow] Verificação de plano não concluída (user=${row.user_id}): ${msg}`);
      }
      continue;
    }

    if (!ALLOWED_INTEGRATIONS.has(row.instance_integration)) {
      await pool.query(
        `UPDATE crm_followup_steps SET status = 'failed', error_message = $2, updated_at = NOW() WHERE id = $1`,
        [row.step_id, 'Instância não suportada para envio automático (use WHATSAPP-GO).']
      );
      await logEvent(row.sequence_id, row.step_id, 'failed', 'integration_not_supported', {
        integration: row.instance_integration,
      });
      await maybeCompleteSequence(row.sequence_id);
      continue;
    }

    try {
      const resolvedPayload = applyVariablesToFollowupPayload(row.payload, {
        name: row.contact_name,
        remoteJid: row.remote_jid,
      });
      const sendPayload = buildPayloadFromStep(row.message_type, resolvedPayload);
      const creds = await fetchInstanceWhatsappCredentials(row.instance_id);
      const instanceToken = creds?.token?.trim();
      if (!instanceToken) {
        throw new Error('Instância sem token Evolution GO. Reconecte a instância no painel.');
      }
      const raw = row.remote_jid.toLowerCase().endsWith('@s.whatsapp.net')
        ? await evolutionSendFollowupWithBrazilVariantRetry(instanceToken, row.remote_jid, sendPayload)
        : await evolutionSend(instanceToken, row.remote_jid, sendPayload);
      const mid = extractMessageId(raw);
      const sentAt = normalizeEvolutionSendTimestamp(raw);
      if (mid) {
        try {
          await mirrorFollowupOutboundToMessages({
            pool,
            userId: row.user_id,
            instanceId: row.instance_id,
            contactId: row.contact_id,
            remoteJid: row.remote_jid,
            evolutionMessageId: mid,
            followupMessageType: row.message_type,
            payload: resolvedPayload,
            sentAt,
          });
        } catch (mirrorErr) {
          console.error(
            '[followup-flow] Espelho CRM messages:',
            mirrorErr instanceof Error ? mirrorErr.message : mirrorErr
          );
        }
      }
      await pool.query(
        `UPDATE crm_followup_steps
         SET status = 'sent', sent_at = NOW(), evolution_message_id = $2, error_message = NULL, updated_at = NOW()
         WHERE id = $1`,
        [row.step_id, mid || null]
      );
      await logEvent(row.sequence_id, row.step_id, 'sent', mid || undefined);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      await pool.query(
        `UPDATE crm_followup_steps SET status = 'failed', error_message = $2, updated_at = NOW() WHERE id = $1`,
        [row.step_id, errMsg.slice(0, 2000)]
      );
      await logEvent(row.sequence_id, row.step_id, 'failed', errMsg.slice(0, 500));
    }

    await maybeCompleteSequence(row.sequence_id);
  }
}

async function maybeCompleteSequence(sequenceId: string): Promise<void> {
  const pool = getPool();
  const { rows } = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM crm_followup_steps WHERE sequence_id = $1 AND status IN ('pending','processing')`,
    [sequenceId]
  );
  if (rows[0]?.c !== '0') return;

  const recurred = await tryScheduleNextRecurrenceCycle(pool, sequenceId);
  if (recurred) {
    await logEvent(sequenceId, null, 'cycle_recurred', 'Próximo ciclo de follow-up agendado.');
    return;
  }

  await pool.query(
    `UPDATE crm_followup_sequences SET status = 'completed', updated_at = NOW() WHERE id = $1 AND status = 'active'`,
    [sequenceId]
  );
  await logEvent(sequenceId, null, 'sequence_completed');
}

export function startFollowupWorker(): NodeJS.Timeout {
  return setInterval(() => {
    void processDueFollowupSteps();
  }, 45_000);
}
