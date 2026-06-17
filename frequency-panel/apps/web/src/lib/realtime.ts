import { API_URL, getToken } from './api';

export function subscribeDashboardEvents(onEvent: () => void) {
  if (typeof window === 'undefined') return () => {};

  const token = getToken();
  if (!token) return () => {};

  const url = `${API_URL}/events?token=${encodeURIComponent(token)}`;
  const source = new EventSource(url);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onEvent, 600);
  };

  source.addEventListener('dashboard', (event) => {
    try {
      const data = JSON.parse((event as MessageEvent).data);
      if (data?.type && data.type !== 'connected' && data.type !== 'presence.updated') schedule();
    } catch {
      schedule();
    }
  });

  return () => {
    if (timer) clearTimeout(timer);
    source.close();
  };
}
