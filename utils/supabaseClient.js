const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

function isPlaceholder(value) {
  return !value || value === 'your-anon-key' || value === 'coloque_sua_chave_aqui';
}

function isSupabaseEnabled() {
  return Boolean(SUPABASE_URL && !isPlaceholder(SUPABASE_KEY));
}

function buildUrl(table, query = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}`);

  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  return url;
}

async function supabaseRequest(table, options = {}) {
  if (!isSupabaseEnabled()) {
    throw new Error('Supabase não configurado. Defina SUPABASE_URL e SUPABASE_ANON_KEY no .env.');
  }

  const {
    method = 'GET',
    query = {},
    headers = {},
    body,
  } = options;

  const response = await fetch(buildUrl(table, query), {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = data?.message || data?.error || response.statusText;
    throw new Error(`Supabase ${method} ${table} falhou: ${message}`);
  }

  return data;
}

module.exports = {
  isSupabaseEnabled,
  supabaseRequest,
};
