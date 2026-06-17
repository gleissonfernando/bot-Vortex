# Vortex Frequency Panel

Servicos Node.js para gestao de frequencia de membros do Discord.

## Stack

- Backend: Node.js, Express, JWT, MongoDB
- Bot Discord: discord.js
- Site: HTML/CSS/JS estatico servido por `shardcloud-start.js`
- Banco: MongoDB

## Estrutura

```txt
frequency-panel/
  apps/
    api/          API Node.js com auth, membros, ponto, frequencia e exportacao
    bot/          Bot Discord que sincroniza membros e envia eventos de ponto
  ../public/site/ Site estatico sem Next
  docker-compose.yml
  .env.example
```

## Funcionalidades

- Login seguro com JWT.
- Lista de membros do Discord.
- Busca por nome, ID, status e cargo.
- Perfil individual do membro.
- Abas: Visao geral, Ponto, Frequencia, Ausencias, Relatorios e Graficos.
- Registro de entrada e saida pelo bot.
- Tempo total por periodo.
- Frequencia diaria e grafico de presenca.
- Exportacao CSV do relatorio.
- Layout responsivo.
- Painel web sem Next, React ou build separado na ShardCloud.

## Instalacao

1. Entre na pasta:

```bash
cd frequency-panel
```

2. Copie o arquivo de ambiente:

```bash
cp .env.example .env
```

3. Ajuste as variaveis no `.env`.

4. Suba o MongoDB:

```bash
docker compose up -d
```

5. Instale dependencias:

```bash
npm install
```

6. Rode a API:

```bash
npm run dev:api
```

7. Rode o bot:

```bash
npm run dev:bot
```

## URLs locais

- API: `http://localhost:4100`
- Healthcheck: `http://localhost:4100/health`
- Site pelo supervisor: `npm run dev` na raiz e abra `http://localhost:3000/dashboard`

## Variaveis de ambiente

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
DISCORD_CLIENT_SECRET=
DISCORD_OAUTH_REDIRECT_URI=https://bot-vortex.shardweb.app/api/auth/discord/callback
REGISTER_COMMANDS_ON_STARTUP=true
ENABLE_PRESENCE_FEATURES=true
TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=
LIVE_ALERT_CHECK_INTERVAL_MS=120000
LIVE_ALERT_WRITE_OFFLINE_HEARTBEAT=false
MONGODB_URI=mongodb://localhost:27017/vortex_frequency
MONGODB_REQUIRED=false
MONGODB_MAX_POOL_SIZE=5
MONGODB_MAX_IDLE_TIME_MS=30000
MONGODB_SERVER_SELECTION_TIMEOUT_MS=10000
VORTEX_TRANSCRIPT_BASE_URL=https://bot-vortex.shardweb.app
APP_URL=https://bot-vortex.shardweb.app
SITE_ORIGIN=https://bot-vortex.shardweb.app
API_PORT=3000
API_HOST=0.0.0.0
BOT_API_PORT=3000
PORT=80
WEB_PORT=80
WEB_INTERNAL_PORT=3001
JWT_SECRET=replace-with-32-plus-random-characters
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=replace-with-12-plus-random-characters
INGEST_SECRET=replace-with-32-plus-random-characters
BOT_INGEST_SECRET=replace-with-the-same-value-as-ingest-secret
FREQUENCY_API_URL=http://127.0.0.1:4100
FREQUENCY_DASHBOARD_SYNC=true
FREQUENCY_MEMBER_SYNC_INTERVAL_MS=900000
POINT_AUTOMATION_INTERVAL_MS=900000
```

`INGEST_SECRET` e `BOT_INGEST_SECRET` precisam ter o mesmo valor.

Para o login com Discord OAuth2, cadastre exatamente a URL de callback acima em Discord Developer Portal > sua aplicacao > OAuth2 > Redirects. O `DISCORD_CLIENT_SECRET` fica na mesma pagina do portal e deve ser mantido privado. Se `DISCORD_OAUTH_REDIRECT_URI` nao for definido, a API usa `SITE_ORIGIN` + `/api/auth/discord/callback`.

## Login inicial

A API cria automaticamente um usuario admin ao iniciar:

- Email: valor de `ADMIN_EMAIL`
- Senha: valor de `ADMIN_PASSWORD`

Troque esses valores antes de colocar em producao. A API recusa iniciar com senha admin curta, placeholders ou segredos fracos.

Se a URI do MongoDB nao tiver `/nomeDoBanco`, defina `MONGODB_DB=vortex_frequency` para o bot e o painel usarem o mesmo banco. Em hospedagem pequena, deixe `BOT_LIGHT_MODE=true` para reduzir caches e scans pesados. O FiveM continua ativo com `FIVEM_SYSTEM_ENABLED=true`.

## Comandos do bot

- `/sync-membros`: envia os membros do servidor para o painel.
- `/ponto acao:Entrada`: abre o ponto do membro.
- `/ponto acao:Saida`: fecha o ponto do membro.

## Modelo de dados

O MongoDB usa estas colecoes:

- `app_users`: usuarios do painel.
- `discord_members`: membros sincronizados do Discord.
- `attendance_sessions`: sessoes de ponto.
- `absence_records`: ausencias.
- `audit_events`: auditoria tecnica.

## Producao

Use senhas fortes, HTTPS, `JWT_SECRET` longo e um MongoDB gerenciado. O bot deve ter intents de membros e presenca habilitadas no portal do Discord.
