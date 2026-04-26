import axios from 'axios';
import { env } from '../config/env';

/**
 * Pedido ao backend OnlyFlow para emitir `new-message` no Socket.IO (chat CRM em tempo real).
 */
export async function notifyOnlyflowCrmNewMessage(params: {
  userId: string;
  instanceId: string;
  contactId: string;
  messageId: string;
}): Promise<void> {
  const base = env.onlyflowBackendUrl.replace(/\/$/, '');
  const key = env.onlyflowFollowupNotifyKey;
  if (!base || !key) {
    return;
  }
  try {
    const url = `${base}/api/internal/followup-chat-message`;
    const res = await axios.post(url, params, {
      headers: { 'x-onlyflow-followup-notify-key': key },
      timeout: 12_000,
      validateStatus: () => true,
    });
    if (res.status >= 400) {
      console.warn(
        '[followup-flow] notify CRM socket:',
        res.status,
        typeof res.data === 'object' ? JSON.stringify(res.data).slice(0, 200) : res.data
      );
    }
  } catch (e) {
    console.warn('[followup-flow] notify CRM socket:', e instanceof Error ? e.message : e);
  }
}
