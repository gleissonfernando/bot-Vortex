import { env } from './env.js';

export async function postToApi(path: string, payload: unknown) {
  const response = await fetch(`${env.apiUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Ingest-Secret': env.ingestSecret
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({ ok: false, error: 'Invalid API response' }));
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `API error ${response.status}`);
  }
  return data;
}
