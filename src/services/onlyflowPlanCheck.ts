import axios from 'axios';
import { env } from '../config/env';

const CACHE_MS_OK = 60_000;
const CACHE_MS_DENY = 60_000;
const CACHE_MS_ERROR = 30_000;

export type AutomationPlanCheckResult =
  | { ok: true }
  | { ok: false; reason: 'free_plan' }
  | { ok: false; reason: 'config_missing' }
  | { ok: false; reason: 'check_failed'; detail: string };

type CacheEntry = { result: AutomationPlanCheckResult; until: number };
const cache = new Map<string, CacheEntry>();

function cacheKey(userId: string): string {
  return String(userId || '').trim();
}

export async function checkUserAutomationPlan(userId: string): Promise<AutomationPlanCheckResult> {
  const id = cacheKey(userId);
  if (!id) return { ok: false, reason: 'check_failed', detail: 'userId vazio' };

  const base = env.onlyflowApiBaseUrl;
  const key = env.onlyflowInternalKey;
  if (!base || !key) {
    console.warn(
      '[followup-flow] ONLYFLOW_API_BASE_URL ou ONLYFLOW_INTERNAL_KEY ausente — não é possível verificar plano.'
    );
    return { ok: false, reason: 'config_missing' };
  }

  const hit = cache.get(id);
  if (hit && hit.until > Date.now()) return hit.result;

  try {
    const res = await axios.get<{
      data?: { canRunAutomations?: boolean; premiumPlan?: string };
    }>(`${base}/api/internal/users/${encodeURIComponent(id)}/automation-eligible`, {
      headers: { 'x-onlyflow-internal-key': key },
      timeout: 10_000,
    });
    const canRun = res.data?.data?.canRunAutomations === true;
    const result: AutomationPlanCheckResult = canRun
      ? { ok: true }
      : { ok: false, reason: 'free_plan' };
    cache.set(id, { result, until: Date.now() + (canRun ? CACHE_MS_OK : CACHE_MS_DENY) });
    if (!canRun) {
      console.warn(
        `[followup-flow] Plano não elegível para automação (user=${id}, plan=${res.data?.data?.premiumPlan ?? 'unknown'})`
      );
    }
    return result;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn('[followup-flow] Falha ao verificar plano:', detail);
    const result: AutomationPlanCheckResult = { ok: false, reason: 'check_failed', detail };
    cache.set(id, { result, until: Date.now() + CACHE_MS_ERROR });
    return result;
  }
}

export async function canUserRunAutomations(userId: string): Promise<boolean> {
  const r = await checkUserAutomationPlan(userId);
  return r.ok;
}
