import { Router, Response } from 'express';
import { getPool } from '../db/pool';
import { FollowupAuthRequest, jwtAuth } from '../middleware/jwtAuth';

const router = Router();
router.use(jwtAuth);

/** Antecedência mínima (ms) entre o relógio do servidor e `scheduledAt` de cada etapa. */
const SCHEDULE_MIN_LEAD_MS = 60_000;

const MESSAGE_TYPES = new Set([
  'text',
  'image',
  'image_caption',
  'video',
  'video_caption',
  'audio',
  'document',
]);

function assertTenant(req: FollowupAuthRequest): string {
  const id = req.tenantUserId?.trim();
  if (!id) throw new Error('tenant_missing');
  return id;
}

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

router.get('/sequences', async (req: FollowupAuthRequest, res: Response) => {
  try {
    const tenant = assertTenant(req);
    const status = String(req.query.status || '').trim();
    const pool = getPool();
    let q = `SELECT s.*,
      (SELECT COUNT(*)::int FROM crm_followup_steps st WHERE st.sequence_id = s.id) AS steps_total,
      (SELECT COUNT(*)::int FROM crm_followup_steps st WHERE st.sequence_id = s.id AND st.status = 'pending') AS pending_count
      FROM crm_followup_sequences s WHERE s.user_id = $1`;
    const p: unknown[] = [tenant];
    if (status === 'active' || status === 'paused' || status === 'cancelled' || status === 'completed') {
      q += ` AND s.status = $2`;
      p.push(status);
    }
    q += ' ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC LIMIT 300';
    const { rows } = await pool.query(q, p);
    res.json({ status: 'success', sequences: rows });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e instanceof Error ? e.message : 'Erro' });
  }
});

router.get('/sequences/by-contact/:contactId', async (req: FollowupAuthRequest, res: Response) => {
  try {
    const tenant = assertTenant(req);
    const { contactId } = req.params;
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT s.* FROM crm_followup_sequences s
       INNER JOIN contacts c ON c.id = s.contact_id
       WHERE s.contact_id = $1 AND s.user_id = $2 AND c.user_id = $2
       ORDER BY s.created_at DESC`,
      [contactId, tenant]
    );
    res.json({ status: 'success', sequences: rows });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e instanceof Error ? e.message : 'Erro' });
  }
});

router.get('/sequences/:id', async (req: FollowupAuthRequest, res: Response) => {
  try {
    const tenant = assertTenant(req);
    const { id } = req.params;
    const pool = getPool();
    const seq = await pool.query(`SELECT * FROM crm_followup_sequences WHERE id = $1 AND user_id = $2`, [id, tenant]);
    if (!seq.rows.length) {
      res.status(404).json({ status: 'error', message: 'Sequência não encontrada.' });
      return;
    }
    const steps = await pool.query(
      `SELECT * FROM crm_followup_steps WHERE sequence_id = $1 ORDER BY step_order ASC`,
      [id]
    );
    res.json({ status: 'success', sequence: seq.rows[0], steps: steps.rows });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e instanceof Error ? e.message : 'Erro' });
  }
});

router.get('/sequences/:id/events', async (req: FollowupAuthRequest, res: Response) => {
  try {
    const tenant = assertTenant(req);
    const { id } = req.params;
    const pool = getPool();
    const own = await pool.query(`SELECT 1 FROM crm_followup_sequences WHERE id = $1 AND user_id = $2`, [id, tenant]);
    if (!own.rows.length) {
      res.status(404).json({ status: 'error', message: 'Sequência não encontrada.' });
      return;
    }
    const { rows } = await pool.query(
      `SELECT * FROM crm_followup_events WHERE sequence_id = $1 ORDER BY created_at DESC LIMIT 500`,
      [id]
    );
    res.json({ status: 'success', events: rows });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e instanceof Error ? e.message : 'Erro' });
  }
});

function validateStepInput(messageType: string, payload: Record<string, unknown>): string | null {
  if (!MESSAGE_TYPES.has(messageType)) return 'messageType inválido.';
  const mediaUrl = typeof payload.mediaUrl === 'string' ? payload.mediaUrl.trim() : '';
  const text = typeof payload.text === 'string' ? payload.text.trim() : '';
  const caption = typeof payload.caption === 'string' ? payload.caption.trim() : '';
  if (messageType === 'text') {
    if (!text) return 'Texto obrigatório.';
    return null;
  }
  if (!mediaUrl || !/^https?:\/\//i.test(mediaUrl)) return 'mediaUrl https obrigatória para este tipo.';
  if (messageType === 'image_caption' || messageType === 'video_caption') {
    if (!caption) return 'Legenda obrigatória.';
  }
  return null;
}

router.post('/sequences', async (req: FollowupAuthRequest, res: Response) => {
  const client = await getPool().connect();
  try {
    const tenant = assertTenant(req);
    const body = req.body as {
      contactId?: string;
      instanceId?: string;
      remoteJid?: string;
      instanceName?: string;
      instanceIntegration?: string | null;
      contactName?: string;
      steps?: Array<{ messageType: string; payload?: Record<string, unknown>; scheduledAt: string }>;
    };
    if (!body.contactId || !body.instanceId || !body.remoteJid || !body.instanceName) {
      res.status(400).json({ status: 'error', message: 'contactId, instanceId, remoteJid e instanceName são obrigatórios.' });
      return;
    }
    if (body.instanceIntegration === 'WHATSAPP-CLOUD') {
      res.status(400).json({
        status: 'error',
        message: 'Follow-up automático não suporta WhatsApp API Oficial nesta versão.',
      });
      return;
    }
    if (!Array.isArray(body.steps) || body.steps.length === 0) {
      res.status(400).json({ status: 'error', message: 'Informe ao menos uma etapa.' });
      return;
    }
    if (body.steps.length > 30) {
      res.status(400).json({ status: 'error', message: 'Máximo de 30 etapas.' });
      return;
    }

    for (let i = 0; i < body.steps.length; i++) {
      const st = body.steps[i];
      const err = validateStepInput(st.messageType, st.payload || {});
      if (err) {
        res.status(400).json({ status: 'error', message: `Etapa ${i + 1}: ${err}` });
        return;
      }
      const t = Date.parse(st.scheduledAt);
      if (Number.isNaN(t)) {
        res.status(400).json({ status: 'error', message: `Etapa ${i + 1}: scheduledAt inválido.` });
        return;
      }
      if (t < Date.now() + SCHEDULE_MIN_LEAD_MS) {
        res.status(400).json({
          status: 'error',
          message: `Etapa ${i + 1}: agende pelo menos 1 minuto à frente do horário atual.`,
        });
        return;
      }
    }

    const chk = await client.query(`SELECT id FROM contacts WHERE id = $1 AND user_id = $2`, [body.contactId, tenant]);
    if (!chk.rows.length) {
      res.status(404).json({ status: 'error', message: 'Contato não encontrado.' });
      return;
    }

    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO crm_followup_sequences
       (user_id, contact_id, instance_id, remote_jid, instance_name, instance_integration, contact_name, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'active')
       RETURNING id`,
      [
        tenant,
        body.contactId,
        body.instanceId,
        body.remoteJid.trim(),
        body.instanceName.trim(),
        body.instanceIntegration ?? null,
        (body.contactName || '').trim() || null,
      ]
    );
    const sequenceId = ins.rows[0].id as string;

    for (let i = 0; i < body.steps.length; i++) {
      const st = body.steps[i];
      await client.query(
        `INSERT INTO crm_followup_steps (sequence_id, step_order, message_type, payload, scheduled_at, status)
         VALUES ($1,$2,$3,$4::jsonb,$5,'pending')`,
        [sequenceId, i + 1, st.messageType, JSON.stringify(st.payload || {}), new Date(st.scheduledAt).toISOString()]
      );
    }

    await client.query('COMMIT');
    await logEvent(sequenceId, null, 'created', `Etapas: ${body.steps.length}`);
    res.status(201).json({ status: 'success', sequenceId });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ status: 'error', message: e instanceof Error ? e.message : 'Erro' });
  } finally {
    client.release();
  }
});

router.patch('/sequences/:id', async (req: FollowupAuthRequest, res: Response) => {
  try {
    const tenant = assertTenant(req);
    const { id } = req.params;
    const { status } = req.body as { status?: string };
    if (!status || !['active', 'paused', 'cancelled'].includes(status)) {
      res.status(400).json({ status: 'error', message: 'status deve ser active, paused ou cancelled.' });
      return;
    }
    const pool = getPool();
    const own = await pool.query(`SELECT id FROM crm_followup_sequences WHERE id = $1 AND user_id = $2`, [id, tenant]);
    if (!own.rows.length) {
      res.status(404).json({ status: 'error', message: 'Sequência não encontrada.' });
      return;
    }
    await pool.query(`UPDATE crm_followup_sequences SET status = $2, updated_at = NOW() WHERE id = $1`, [id, status]);
    if (status === 'cancelled') {
      await pool.query(
        `UPDATE crm_followup_steps SET status = 'cancelled', updated_at = NOW()
         WHERE sequence_id = $1 AND status IN ('pending', 'processing')`,
        [id]
      );
    }
    await logEvent(id, null, `status_${status}`);
    res.json({ status: 'success' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e instanceof Error ? e.message : 'Erro' });
  }
});

router.delete('/sequences/:id', async (req: FollowupAuthRequest, res: Response) => {
  try {
    const tenant = assertTenant(req);
    const { id } = req.params;
    const pool = getPool();
    const r = await pool.query(`DELETE FROM crm_followup_sequences WHERE id = $1 AND user_id = $2 RETURNING id`, [id, tenant]);
    if (!r.rowCount) {
      res.status(404).json({ status: 'error', message: 'Sequência não encontrada.' });
      return;
    }
    res.json({ status: 'success' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e instanceof Error ? e.message : 'Erro' });
  }
});

router.put('/sequences/:id', async (req: FollowupAuthRequest, res: Response) => {
  const client = await getPool().connect();
  try {
    const tenant = assertTenant(req);
    const { id } = req.params;
    const body = req.body as {
      steps?: Array<{ messageType: string; payload?: Record<string, unknown>; scheduledAt: string }>;
    };
    if (!Array.isArray(body.steps) || body.steps.length === 0) {
      res.status(400).json({ status: 'error', message: 'steps obrigatório.' });
      return;
    }

    const own = await client.query(
      `SELECT id FROM crm_followup_sequences WHERE id = $1 AND user_id = $2 AND status IN ('active','paused')`,
      [id, tenant]
    );
    if (!own.rows.length) {
      res.status(404).json({ status: 'error', message: 'Sequência não encontrada ou não editável.' });
      return;
    }

    const blk = await client.query(
      `SELECT 1 FROM crm_followup_steps WHERE sequence_id = $1 AND status NOT IN ('pending','cancelled') LIMIT 1`,
      [id]
    );
    if (blk.rows.length) {
      res.status(409).json({ status: 'error', message: 'Não é possível editar: já existem etapas enviadas ou com falha.' });
      return;
    }

    for (let i = 0; i < body.steps.length; i++) {
      const st = body.steps[i];
      const err = validateStepInput(st.messageType, st.payload || {});
      if (err) {
        res.status(400).json({ status: 'error', message: `Etapa ${i + 1}: ${err}` });
        return;
      }
      const ts = Date.parse(st.scheduledAt);
      if (Number.isNaN(ts)) {
        res.status(400).json({ status: 'error', message: `Etapa ${i + 1}: scheduledAt inválido.` });
        return;
      }
      if (ts < Date.now() + SCHEDULE_MIN_LEAD_MS) {
        res.status(400).json({
          status: 'error',
          message: `Etapa ${i + 1}: agende pelo menos 1 minuto à frente do horário atual.`,
        });
        return;
      }
    }

    await client.query('BEGIN');
    await client.query(`DELETE FROM crm_followup_steps WHERE sequence_id = $1`, [id]);
    for (let i = 0; i < body.steps.length; i++) {
      const st = body.steps[i];
      await client.query(
        `INSERT INTO crm_followup_steps (sequence_id, step_order, message_type, payload, scheduled_at, status)
         VALUES ($1,$2,$3,$4::jsonb,$5,'pending')`,
        [id, i + 1, st.messageType, JSON.stringify(st.payload || {}), new Date(st.scheduledAt).toISOString()]
      );
    }
    await client.query(`UPDATE crm_followup_sequences SET updated_at = NOW() WHERE id = $1`, [id]);
    await client.query('COMMIT');
    await logEvent(id, null, 'steps_replaced', `${body.steps.length} etapas`);
    res.json({ status: 'success' });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ status: 'error', message: e instanceof Error ? e.message : 'Erro' });
  } finally {
    client.release();
  }
});

export default router;
