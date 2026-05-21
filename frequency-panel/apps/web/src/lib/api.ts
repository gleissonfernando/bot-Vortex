export const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

export type ApiResult<T> = T & { ok: boolean; error?: string };

export function getToken() {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('vortex_frequency_token') || '';
}

export function setToken(token: string) {
  localStorage.setItem('vortex_frequency_token', token);
}

export function clearToken() {
  localStorage.removeItem('vortex_frequency_token');
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
      ...(init.headers || {})
    },
    cache: 'no-store'
  });

  const data = await response.json().catch(() => ({
    ok: false,
    error: response.status === 502
      ? 'API indisponivel no ShardCloud'
      : 'A API retornou uma resposta invalida'
  }));
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

export async function downloadFile(path: string, filename: string) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${getToken()}` }
  });
  if (!response.ok) throw new Error(`Falha ao exportar: HTTP ${response.status}`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
