/** Extrai dígitos do JID WhatsApp (ex.: 5562998448536@s.whatsapp.net). */
export function phoneFromRemoteJid(remoteJid: string): string {
  const raw = String(remoteJid || '').split('@')[0] || '';
  return raw.replace(/\D/g, '');
}

/** Formata número brasileiro para exibição em variáveis de template. */
export function formatBrazilianPhone(phone: string): string {
  if (!phone) return '';
  let cleanPhone = phoneFromRemoteJid(phone);
  if (!cleanPhone) cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.startsWith('55') && cleanPhone.length > 10) {
    cleanPhone = cleanPhone.substring(2);
  }
  if (cleanPhone.length < 10) return phone;
  const ddd = cleanPhone.substring(0, 2);
  const numberOnly = cleanPhone.substring(2);
  if (numberOnly.length === 9) {
    return `(${ddd})${numberOnly.substring(0, 1)} ${numberOnly.substring(1, 5)}-${numberOnly.substring(5)}`;
  }
  if (numberOnly.length === 8) {
    return `(${ddd})9 ${numberOnly.substring(0, 4)}-${numberOnly.substring(4)}`;
  }
  return phone;
}
