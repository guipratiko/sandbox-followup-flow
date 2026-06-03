import axios from 'axios';
import { env } from '../config/env';

export type InstanceWhatsappCredentials = {
  instanceId: string;
  instanceName: string;
  integration: string;
  token: string | null;
};

export async function fetchInstanceWhatsappCredentials(
  instanceId: string
): Promise<InstanceWhatsappCredentials | null> {
  const base = env.onlyflowApiBaseUrl?.replace(/\/$/, '');
  const key = env.onlyflowInternalKey;
  if (!base || !key) return null;
  try {
    const res = await axios.get(
      `${base}/api/internal/instances/${encodeURIComponent(instanceId)}/whatsapp-credentials`,
      {
        headers: { 'x-onlyflow-internal-key': key },
        timeout: 8000,
        validateStatus: () => true,
      }
    );
    if (res.status !== 200 || !res.data?.data) return null;
    const d = res.data.data as InstanceWhatsappCredentials;
    return {
      instanceId: String(d.instanceId || instanceId),
      instanceName: String(d.instanceName || ''),
      integration: String(d.integration || 'WHATSAPP-GO'),
      token: d.token ? String(d.token) : null,
    };
  } catch {
    return null;
  }
}
