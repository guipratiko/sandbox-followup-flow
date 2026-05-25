import type { Pool, PoolClient } from 'pg';

export type FollowupRecurrence = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly';

const RECURRENCE_VALUES = new Set<FollowupRecurrence>(['none', 'daily', 'weekly', 'biweekly', 'monthly']);

export function parseFollowupRecurrence(value: unknown): FollowupRecurrence | null {
  const v = String(value ?? 'none').trim().toLowerCase();
  return RECURRENCE_VALUES.has(v as FollowupRecurrence) ? (v as FollowupRecurrence) : null;
}

export function addOneCalendarMonth(from: Date): Date {
  const out = new Date(from.getTime());
  const day = out.getDate();
  const hour = out.getHours();
  const minute = out.getMinutes();
  const second = out.getSeconds();
  const ms = out.getMilliseconds();
  const targetMonth = out.getMonth() + 1;
  const year = out.getFullYear();
  const lastDay = new Date(year, targetMonth + 1, 0).getDate();
  out.setMonth(targetMonth, Math.min(day, lastDay));
  out.setHours(hour, minute, second, ms);
  return out;
}

export function computeNextCycleStart(cycleEnd: Date, recurrence: FollowupRecurrence): Date {
  if (recurrence === 'daily') {
    return new Date(cycleEnd.getTime() + 24 * 60 * 60 * 1000);
  }
  if (recurrence === 'weekly') {
    return new Date(cycleEnd.getTime() + 7 * 24 * 60 * 60 * 1000);
  }
  if (recurrence === 'biweekly') {
    return new Date(cycleEnd.getTime() + 15 * 24 * 60 * 60 * 1000);
  }
  if (recurrence === 'monthly') {
    return addOneCalendarMonth(cycleEnd);
  }
  return new Date(cycleEnd.getTime());
}

type DbExec = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

interface SequenceRecurrenceRow {
  id: string;
  status: string;
  recurrence: FollowupRecurrence;
  recurrence_max_cycles: number | null;
  recurrence_cycles_done: number;
  cycle_step_count: number;
}

interface StepRow {
  step_order: number;
  message_type: string;
  payload: Record<string, unknown>;
  scheduled_at: Date;
  sent_at: Date | null;
  status: string;
}

/**
 * Após todas as etapas do ciclo atual terminarem, agenda o próximo ciclo ou marca completed.
 * @returns true se um novo ciclo foi agendado; false se a sequência deve ser marcada completed.
 */
export async function tryScheduleNextRecurrenceCycle(
  db: DbExec,
  sequenceId: string
): Promise<boolean> {
  const seqRes = await db.query<SequenceRecurrenceRow>(
    `SELECT id, status, recurrence, recurrence_max_cycles, recurrence_cycles_done, cycle_step_count
     FROM crm_followup_sequences WHERE id = $1`,
    [sequenceId]
  );
  const seq = seqRes.rows[0];
  if (!seq || seq.status !== 'active') return false;

  const recurrence = (seq.recurrence || 'none') as FollowupRecurrence;
  if (recurrence === 'none') return false;

  const cycleCount = Number(seq.cycle_step_count) || 0;
  if (cycleCount < 1) return false;

  const cyclesDone = Number(seq.recurrence_cycles_done) || 0;
  const maxCycles = seq.recurrence_max_cycles != null ? Number(seq.recurrence_max_cycles) : null;
  if (maxCycles != null && cyclesDone >= maxCycles) return false;

  const stepsRes = await db.query<StepRow>(
    `SELECT step_order, message_type, payload, scheduled_at, sent_at, status
     FROM crm_followup_steps
     WHERE sequence_id = $1
     ORDER BY step_order DESC
     LIMIT $2`,
    [sequenceId, cycleCount]
  );
  const lastCycle = [...stepsRes.rows].sort((a, b) => a.step_order - b.step_order);
  if (lastCycle.length !== cycleCount) return false;

  const allTerminal = lastCycle.every(
    (s) => s.status === 'sent' || s.status === 'failed' || s.status === 'skipped'
  );
  if (!allTerminal) return false;

  const anchorTimes = lastCycle.map((s) => {
    const t = s.sent_at ?? s.scheduled_at;
    return new Date(t).getTime();
  });
  const firstMs = Math.min(...lastCycle.map((s) => new Date(s.scheduled_at).getTime()));
  const cycleEndMs = Math.max(...anchorTimes);
  const cycleEnd = new Date(cycleEndMs);
  const nextStart = computeNextCycleStart(cycleEnd, recurrence);

  const maxOrderRes = await db.query<{ m: number }>(
    `SELECT COALESCE(MAX(step_order), 0)::int AS m FROM crm_followup_steps WHERE sequence_id = $1`,
    [sequenceId]
  );
  let nextOrder = Number(maxOrderRes.rows[0]?.m) || 0;

  for (const step of lastCycle) {
    const offsetMs = new Date(step.scheduled_at).getTime() - firstMs;
    const scheduledAt = new Date(nextStart.getTime() + offsetMs);
    nextOrder += 1;
    await db.query(
      `INSERT INTO crm_followup_steps (sequence_id, step_order, message_type, payload, scheduled_at, status)
       VALUES ($1,$2,$3,$4::jsonb,$5,'pending')`,
      [
        sequenceId,
        nextOrder,
        step.message_type,
        JSON.stringify(step.payload || {}),
        scheduledAt.toISOString(),
      ]
    );
  }

  await db.query(
    `UPDATE crm_followup_sequences
     SET recurrence_cycles_done = recurrence_cycles_done + 1, updated_at = NOW()
     WHERE id = $1`,
    [sequenceId]
  );

  return true;
}
