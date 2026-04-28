/**
 * Variantes de número BR para envio Evolution (alinhado ao `numberNormalizer` do Backend).
 * Alguns contatos ficam com JID 55+DDD+8 dígitos (sem o 9); a Evolution pode validar só a forma com 9 — ou o contrário.
 */

/** Só dígitos do user part do JID ou string já numérica. */
export function digitsFromWhatsappRemote(remoteJidOrDigits: string): string {
  const t = remoteJidOrDigits.trim();
  const lower = t.toLowerCase();
  const cut = lower.endsWith('@s.whatsapp.net') ? t.slice(0, -'@s.whatsapp.net'.length) : t.split('@')[0];
  return cut.replace(/\D/g, '');
}

/**
 * Lista de candidatos na ordem: **como está no CRM primeiro**, depois a variante BR (com/sem 9).
 */
export function brazilWhatsappEvolutionCandidates(digits: string): string[] {
  const d = digits.replace(/\D/g, '');
  const out: string[] = [];
  const push = (x: string) => {
    if (x && !out.includes(x)) out.push(x);
  };
  push(d);

  if (d.startsWith('55') && d.length === 13) {
    const ddd = d.slice(2, 4);
    const rest = d.slice(4);
    if (rest.length === 9 && rest[0] === '9') {
      push(`55${ddd}${rest.slice(1)}`);
    }
  }
  if (d.startsWith('55') && d.length === 12) {
    const ddd = d.slice(2, 4);
    const sub = d.slice(4);
    if (sub.length === 8 && /^[6-9]\d{7}$/.test(sub)) {
      push(`55${ddd}9${sub}`);
    }
  }
  return out;
}
