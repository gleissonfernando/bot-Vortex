function buildTranscriptSiteHtml({ apiPath = '/api/transcripts' } = {}) {
  const safeApiPath = String(apiPath || '/api/transcripts').replace(/</g, '%3C');
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Vortex | Transcripts</title>
  <link rel="stylesheet" href="/vendor/fontawesome/css/all.min.css">
  <style>
    :root{--bg:#030712;--panel:#07111f;--panel2:#0b1728;--panel3:#0f2038;--line:rgba(76,145,255,.24);--line2:rgba(255,255,255,.08);--text:#f8fafc;--muted:#9db2d3;--accent:#0b6bff;--accent2:#4aa3ff;--good:#22c55e;--warn:#facc15;--shadow:0 24px 80px rgba(0,0,0,.36)}
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;background:linear-gradient(180deg,#020617,#061121 48%,#030712);color:var(--text);font-family:Inter,Segoe UI,Arial,sans-serif;line-height:1.45}
    body:before{content:"";position:fixed;inset:0;pointer-events:none;background:linear-gradient(rgba(255,255,255,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.022) 1px,transparent 1px);background-size:38px 38px;mask-image:linear-gradient(#000,transparent 78%);opacity:.55}
    .wrap{width:min(1220px,calc(100% - 32px));margin:0 auto}
    header{position:sticky;top:0;z-index:5;border-bottom:1px solid var(--line);background:linear-gradient(135deg,rgba(3,7,18,.96),rgba(7,17,31,.94)),url("/assets/IMG_4234.png") center/cover no-repeat;box-shadow:var(--shadow);backdrop-filter:blur(18px)}
    .top{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 0}
    .brand{display:flex;align-items:center;gap:12px;min-width:0}
    .brand-mark{width:42px;height:42px;border-radius:8px;display:grid;place-items:center;background:linear-gradient(135deg,#0b6bff,#003a94);font-weight:900;box-shadow:0 0 28px rgba(11,107,255,.34)}
    h1{margin:0;font-size:24px;line-height:1.08;letter-spacing:0}
    .muted{color:var(--muted)}
    main{position:relative;padding:18px 0 38px;display:grid;gap:14px}
    .toolbar,.stats,.table-panel{background:linear-gradient(180deg,rgba(7,17,31,.92),rgba(4,9,18,.94));border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow);backdrop-filter:blur(18px)}
    .toolbar{display:grid;grid-template-columns:minmax(220px,1fr) 190px 130px;gap:10px;padding:12px}
    input,select,button{height:42px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.06);color:var(--text);font:inherit;outline:none}
    input,select{padding:0 12px}
    select option{background:#07111f;color:#fff}
    button{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:0 13px;font-weight:800;cursor:pointer;background:linear-gradient(135deg,#0b6bff,#0047b8);border-color:rgba(92,167,255,.45)}
    .stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:0;overflow:hidden}
    .stat{padding:14px;border-right:1px solid var(--line2)}
    .stat:last-child{border-right:0}
    .stat span{display:block;font-size:11px;text-transform:uppercase;font-weight:900;color:#93c5fd}
    .stat strong{display:block;margin-top:5px;font-size:20px;overflow-wrap:anywhere}
    .table-panel{overflow:hidden}
    .table-head{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:14px;border-bottom:1px solid var(--line2)}
    .table-head h2{margin:0;font-size:17px}
    .pill{display:inline-flex;align-items:center;gap:7px;border:1px solid rgba(76,145,255,.36);background:rgba(11,107,255,.1);color:#bfdbfe;border-radius:999px;padding:7px 10px;font-size:12px;font-weight:900}
    .table-scroll{overflow:auto}
    table{width:100%;border-collapse:collapse;min-width:980px}
    th,td{padding:12px 14px;border-bottom:1px solid var(--line2);text-align:left;vertical-align:middle}
    th{font-size:11px;text-transform:uppercase;color:#93c5fd;background:rgba(11,107,255,.08)}
    td{color:#e5e7eb}
    .title-cell strong{display:block;color:#fff}
    .title-cell span{display:block;color:var(--muted);font-size:12px;margin-top:2px}
    .kind{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:6px 9px;font-size:12px;font-weight:900;color:#e5e7eb;background:rgba(255,255,255,.06)}
    .kind.daily-report{color:#bbf7d0;border-color:rgba(34,197,94,.32);background:rgba(34,197,94,.12)}
    .open-link{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:8px;color:#fff;text-decoration:none;background:linear-gradient(135deg,#0b6bff,#0047b8);border:1px solid rgba(92,167,255,.45)}
    .empty{padding:26px;text-align:center;color:var(--muted)}
    @media(max-width:840px){.top{align-items:flex-start}.toolbar{grid-template-columns:1fr}.stats{grid-template-columns:1fr 1fr}h1{font-size:21px}}
    @media(max-width:560px){.stats{grid-template-columns:1fr}.stat{border-right:0;border-bottom:1px solid var(--line2)}.table-head{display:grid}}
  </style>
</head>
<body>
  <header>
    <div class="wrap top">
      <div class="brand">
        <div class="brand-mark">V</div>
        <div>
          <h1>Transcripts Vortex</h1>
          <div class="muted">Arquivo local de folhas e relatorios de ponto</div>
        </div>
      </div>
      <span class="pill"><i class="fa-solid fa-database"></i> Local</span>
    </div>
  </header>
  <main class="wrap">
    <section class="toolbar" aria-label="Filtros">
      <input id="search" type="search" placeholder="Buscar por usuario, periodo, servidor ou ID">
      <select id="kind">
        <option value="">Todos os tipos</option>
        <option value="point-report">Folha de ponto</option>
        <option value="daily-report">Relatorio diario</option>
      </select>
      <button id="refresh" type="button"><i class="fa-solid fa-rotate"></i> Atualizar</button>
    </section>
    <section class="stats" id="stats">
      <div class="stat"><span>Total</span><strong>...</strong></div>
      <div class="stat"><span>Folhas</span><strong>...</strong></div>
      <div class="stat"><span>Diarios</span><strong>...</strong></div>
      <div class="stat"><span>Expirados</span><strong>...</strong></div>
      <div class="stat"><span>Acessos</span><strong>...</strong></div>
    </section>
    <section class="table-panel">
      <div class="table-head">
        <h2>Arquivo de transcripts</h2>
        <span class="pill" id="count"><i class="fa-solid fa-file-lines"></i> Carregando</span>
      </div>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Transcript</th>
              <th>Tipo</th>
              <th>Periodo</th>
              <th>Servidor</th>
              <th>Gerado por</th>
              <th>Gerado em</th>
              <th>Acessos</th>
              <th>Abrir</th>
            </tr>
          </thead>
          <tbody id="rows"><tr><td colspan="8" class="empty">Carregando transcripts...</td></tr></tbody>
        </table>
      </div>
    </section>
  </main>
  <script>
    const apiPath = ${JSON.stringify(safeApiPath)};
    const rows = document.getElementById('rows');
    const stats = document.getElementById('stats');
    const count = document.getElementById('count');
    const search = document.getElementById('search');
    const kind = document.getElementById('kind');
    const refresh = document.getElementById('refresh');
    let debounce = null;

    function esc(value) {
      return String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    }

    function formatDate(value) {
      if (!value) return 'N/A';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return 'N/A';
      return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
    }

    function kindLabel(value) {
      return value === 'daily-report' ? 'Relatorio diario' : 'Folha de ponto';
    }

    function renderStats(data) {
      const s = data.stats || {};
      stats.innerHTML = [
        ['Total', s.total ?? 0],
        ['Folhas', s.pointReports ?? 0],
        ['Diarios', s.dailyReports ?? 0],
        ['Expirados', s.expired ?? 0],
        ['Acessos', s.views ?? 0],
      ].map(([label, value]) => '<div class="stat"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong></div>').join('');
    }

    function renderRows(items) {
      count.innerHTML = '<i class="fa-solid fa-file-lines"></i> ' + items.length + ' item(ns)';
      if (!items.length) {
        rows.innerHTML = '<tr><td colspan="8" class="empty">Nenhum transcript encontrado.</td></tr>';
        return;
      }
      rows.innerHTML = items.map((item) => {
        const icon = item.kind === 'daily-report' ? 'fa-calendar-day' : 'fa-user-clock';
        return '<tr>' +
          '<td class="title-cell"><strong>' + esc(item.title) + '</strong><span>' + esc(item.id) + '</span></td>' +
          '<td><span class="kind ' + esc(item.kind) + '"><i class="fa-solid ' + icon + '"></i> ' + esc(kindLabel(item.kind)) + '</span></td>' +
          '<td>' + esc(item.periodLabel || item.periodKey || 'N/A') + '</td>' +
          '<td>' + esc(item.guildName || 'Vortex') + '</td>' +
          '<td>' + esc(item.generatedByTag || 'Sistema') + '</td>' +
          '<td>' + esc(formatDate(item.generatedAt)) + '</td>' +
          '<td>' + esc(item.views || 0) + '</td>' +
          '<td><a class="open-link" href="' + esc(item.publicPath) + '" title="Abrir transcript"><i class="fa-solid fa-arrow-up-right-from-square"></i></a></td>' +
        '</tr>';
      }).join('');
    }

    async function load() {
      refresh.disabled = true;
      const url = new URL(apiPath, location.origin);
      if (search.value.trim()) url.searchParams.set('q', search.value.trim());
      if (kind.value) url.searchParams.set('kind', kind.value);
      const response = await fetch(url.toString(), { cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      renderStats(data);
      renderRows(data.items || []);
      refresh.disabled = false;
    }

    function scheduleLoad() {
      clearTimeout(debounce);
      debounce = setTimeout(() => load().catch((error) => {
        rows.innerHTML = '<tr><td colspan="8" class="empty">Erro ao carregar transcripts: ' + esc(error.message) + '</td></tr>';
        refresh.disabled = false;
      }), 180);
    }

    search.addEventListener('input', scheduleLoad);
    kind.addEventListener('change', scheduleLoad);
    refresh.addEventListener('click', scheduleLoad);
    scheduleLoad();
  </script>
</body>
</html>`;
}

module.exports = {
  buildTranscriptSiteHtml,
};
