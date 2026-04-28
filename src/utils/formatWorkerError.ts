/**
 * Converte qualquer valor lançado no worker numa mensagem legível (evita "[object Object]" em DB/UI).
 */
export function formatWorkerError(err: unknown): string {
  if (err instanceof Error && err.message.trim()) {
    return err.message.trim().slice(0, 2000);
  }
  if (typeof err === 'string') return err.trim().slice(0, 2000);
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>;
    if (typeof o.message === 'string' && o.message.trim()) return o.message.trim().slice(0, 2000);
    try {
      return JSON.stringify(err).slice(0, 2000);
    } catch {
      return String(err).slice(0, 2000);
    }
  }
  return String(err).slice(0, 2000);
}
