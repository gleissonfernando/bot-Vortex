export const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';
const TOKEN_KEY = 'vortex_frequency_token';
const REFRESH_TOKEN_KEY = 'vortex_frequency_refresh_token';

export type ApiResult<T> = T & { ok: boolean; error?: string };

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export function getToken() {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function getRefreshToken() {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(REFRESH_TOKEN_KEY) || '';
}

export function setToken(token: string, refreshToken = '') {
  if (!token) return;
  localStorage.setItem(TOKEN_KEY, token);
  if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  let response = await fetchWithAuth(path, init);

  if (response.status === 401 && getRefreshToken()) {
    const refreshed = await refreshSession();
    if (refreshed) response = await fetchWithAuth(path, init);
  }

  if (response.status === 401) {
    clearToken();
  }

  const data = await response.json().catch(() => ({
    ok: false,
    error: response.status === 502
      ? 'API indisponivel no ShardCloud. Confira os logs do frequency-api.'
      : 'A API retornou uma resposta invalida'
  }));
  if (!response.ok || !data.ok) {
    throw new ApiError(data.error || `HTTP ${response.status}`, response.status);
  }
  return data;
}

async function fetchWithAuth(path: string, init: RequestInit = {}) {
  const token = getToken();
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {})
    },
    credentials: 'include',
    cache: 'no-store'
  });
}

async function refreshSession() {
  try {
    const response = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(getRefreshToken() ? { refreshToken: getRefreshToken() } : {}),
      credentials: 'include',
      cache: 'no-store'
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Refresh invalido');
    setToken(data.token, data.refreshToken);
    return true;
  } catch {
    clearToken();
    return false;
  }
}

export async function downloadFile(path: string, filename: string) {
  const token = getToken();
  const response = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include'
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
