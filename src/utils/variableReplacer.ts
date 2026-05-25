import { formatBrazilianPhone, phoneFromRemoteJid } from './phoneFormat';

export interface FollowupContactVars {
  name?: string | null;
  remoteJid: string;
}

function getFirstName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[0] || '';
}

function getLastName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return '';
  return parts.slice(1).join(' ');
}

export function replaceVariables(text: string, contact: FollowupContactVars, defaultName = 'Cliente'): string {
  if (!text || typeof text !== 'string') return text;
  const contactName = contact.name?.trim() ? contact.name.trim() : defaultName;
  const originalPhone = phoneFromRemoteJid(contact.remoteJid) || contact.remoteJid.replace(/\D/g, '');
  const formattedPhone = formatBrazilianPhone(originalPhone || contact.remoteJid);
  const fullName = contactName;
  const variables: Record<string, string> = {
    $name: fullName,
    $firstName: getFirstName(fullName),
    $lastName: getLastName(fullName),
    $fullName: fullName,
    $formattedPhone: formattedPhone,
    $originalPhone: originalPhone,
  };
  let result = text;
  for (const [variable, value] of Object.entries(variables)) {
    const regex = new RegExp(variable.replace(/\$/g, '\\$'), 'g');
    result = result.replace(regex, value);
  }
  return result;
}

/** Substitui variáveis em campos de texto do payload da etapa (text, caption, fileName). */
export function applyVariablesToFollowupPayload(
  payload: Record<string, unknown>,
  contact: FollowupContactVars
): Record<string, unknown> {
  const out = { ...payload };
  for (const key of ['text', 'caption', 'fileName'] as const) {
    if (typeof out[key] === 'string') {
      out[key] = replaceVariables(out[key], contact);
    }
  }
  return out;
}
