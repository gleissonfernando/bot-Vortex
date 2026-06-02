# Vortex Frequency Panel

Painel web profissional para gestao de frequencia de membros do Discord.

## Stack

- Frontend: Next.js, React, TailwindCSS, Recharts
- Backend: Node.js, Express, JWT, MongoDB
- Bot Discord: discord.js
- Banco: MongoDB

## Estrutura

```txt
frequency-panel/
  apps/
    api/          API Node.js com auth, membros, ponto, frequencia e exportacao
    bot/          Bot Discord que sincroniza membros e envia eventos de ponto
    web/          Frontend Next.js com dashboard administrativo
  docker-compose.yml
  .env.example
```

## Funcionalidades

- Login seguro com JWT.
- Dashboard escuro com menu lateral.
- Lista de membros do Discord.
- Busca por nome, ID, status e cargo.
- Perfil individual do membro.
- Abas: Visao geral, Ponto, Frequencia, Ausencias, Relatorios e Graficos.
- Registro de entrada e saida pelo bot.
- Tempo total por periodo.
- Frequencia diaria e grafico de presenca.
- Exportacao CSV do relatorio.
- Layout responsivo.

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

7. Rode o frontend:

```bash
npm run dev:web
```

8. Rode o bot:

```bash
npm run dev:bot
```

## URLs locais

- Frontend: `http://localhost:3000`
- API: `http://localhost:4100`
- Healthcheck: `http://localhost:4100/health`

## Variaveis de ambiente

```env
MONGODB_URI=mongodb://localhost:27017/vortex_frequency
MONGODB_DB=vortex_frequency
JWT_SECRET=replace-with-32-plus-random-characters
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=replace-with-12-plus-random-characters
API_PORT=4100
API_ORIGIN=https://bot-vortex.shardweb.app
INGEST_SECRET=replace-with-32-plus-random-characters
LOGIN_RATE_LIMIT_WINDOW_MS=600000
LOGIN_RATE_LIMIT_MAX=8

NEXT_PUBLIC_API_URL=/api
SITE_ORIGIN=https://bot-vortex.shardweb.app

DISCORD_TOKEN=put-your-discord-bot-token
DISCORD_CLIENT_ID=1505924330490695800
DISCORD_CLIENT_SECRET=valor_real_do_client_secret
DISCORD_GUILD_ID=put-your-discord-guild-id
DISCORD_OAUTH_REDIRECT_URI=https://bot-vortex.shardweb.app/api/auth/discord/callback
BOT_API_URL=http://localhost:4100
BOT_INGEST_SECRET=replace-with-the-same-value-as-ingest-secret
BOT_LIGHT_MODE=true
FIVEM_SYSTEM_ENABLED=true
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
