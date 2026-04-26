/**
 * Normaliza timestamp devolvido pela Evolution no envio (segundos ou ms), igual à lógica do backend.
 */
export function normalizeEvolutionSendTimestamp(raw: unknown): Date {
  if (!raw || typeof raw !== 'object') {
    return new Date();
  }
  const o = raw as Record<string, unknown>;
  const key = o.key as Record<string, unknown> | undefined;
  const nested = o.data && typeof o.data === 'object' ? (o.data as Record<string, unknown>) : null;

  const candidates: unknown[] = [
    o.messageTimestamp,
    key?.messageTimestamp,
    nested?.messageTimestamp,
    nested && (nested.key as Record<string, unknown> | undefined)?.messageTimestamp,
  ];

  for (const t of candidates) {
    if (t == null || t === '') continue;
    const n = Number(t);
    if (Number.isNaN(n) || n <= 0) continue;
    if (n < 10000000000) {
      return new Date(n * 1000);
    }
    return new Date(n);
  }

  return new Date();
}
