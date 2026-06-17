export const dynamic = 'force-dynamic';
export const revalidate = 0;

type HealthPayload = {
  ok: boolean;
  service: string;
  web: {
    ok: boolean;
    service: string;
  };
  api: {
    ok: boolean;
    status: number | null;
    service?: string;
    error?: string;
  };
};

function apiBaseUrl() {
  return String(process.env.INTERNAL_API_URL || 'http://127.0.0.1:4100').replace(/\/+$/, '');
}

async function readApiHealth(): Promise<HealthPayload['api']> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(`${apiBaseUrl()}/health`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null) as { ok?: unknown; service?: unknown } | null;
    return {
      ok: response.ok && body?.ok === true,
      status: response.status,
      service: typeof body?.service === 'string' ? body.service : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  const api = await readApiHealth();
  const payload: HealthPayload = {
    ok: api.ok,
    service: 'vortex-shardcloud-health',
    web: {
      ok: true,
      service: 'vortex-frequency-web',
    },
    api,
  };

  return Response.json(payload, {
    status: payload.ok ? 200 : 503,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
