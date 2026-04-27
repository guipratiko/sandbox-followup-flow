/**
 * Converte falhas do worker em texto persistível (evita "[object Object]" em error_message / eventos).
 */
export function formatUnknownErrorForStorage(e: unknown, maxLen = 2000): string {
  if (e instanceof Error) return e.message.slice(0, maxLen);
  if (typeof e === 'string') return e.slice(0, maxLen);
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    if (typeof o.message === 'string' && o.message.trim()) return o.message.slice(0, maxLen);
    if (typeof o.error === 'string' && o.error.trim()) return o.error.slice(0, maxLen);
    const resp = o.response;
    if (resp && typeof resp === 'object') {
      const r = resp as Record<string, unknown>;
      const data = r.data;
      if (typeof data === 'string') return data.slice(0, maxLen);
      if (data && typeof data === 'object') {
        try {
          return JSON.stringify(data).slice(0, maxLen);
        } catch {
          /* fall through */
        }
      }
    }
    try {
      return JSON.stringify(e).slice(0, maxLen);
    } catch {
      return 'Erro desconhecido (não serializável)';
    }
  }
  return String(e).slice(0, maxLen);
}
