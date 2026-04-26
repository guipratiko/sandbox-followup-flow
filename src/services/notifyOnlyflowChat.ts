import axios from 'axios';
import { env } from '../config/env';

export type FollowupMirrorSocketMessage = {
  id: string;
  messageId: string;
  channel: 'whatsapp';
  fromMe: boolean;
  messageType: string;
  content: string;
  mediaUrl: string | null;
  timestamp: string;
  read: boolean;
  automatedOutbound: boolean;
  followupOutbound: boolean;
  reactions: Array<{ fromMe: boolean; emoji: string; at: string }>;
};

/**
 * Notifica o backend OnlyFlow para emitir `new-message` + `contact-updated` (chat CRM em tempo real).
 */
export async function notifyOnlyflowFollowupMirror(params: {
  userId: string;
  instanceId: string;
  contactId: string;
  message: FollowupMirrorSocketMessage;
}): Promise<void> {
  const base = env.onlyflowApiBaseUrl;
  const secret = env.followupMirrorNotifySecret;
  if (!base || !secret) {
    return;
  }

  const url = `${base}/api/crm/followup-mirror-notify`;
  try {
    const res = await axios.post(
      url,
      {
        userId: params.userId,
        instanceId: params.instanceId,
        contactId: params.contactId,
        message: params.message,
      },
      {
        headers: { 'x-followup-mirror-secret': secret },
        timeout: 12_000,
        validateStatus: () => true,
      }
    );
    if (res.status >= 400) {
      console.warn(
        `[followup-flow] notify backend HTTP ${res.status}:`,
        typeof res.data === 'object' ? JSON.stringify(res.data).slice(0, 300) : String(res.data)
      );
    }
  } catch (e) {
    console.warn('[followup-flow] notify backend:', e instanceof Error ? e.message : e);
  }
}
