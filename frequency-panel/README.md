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
JWT_SECRET=change-this-long-random-secret
ADMIN_EMAIL=vortex@adimin.com
ADMIN_PASSWORD=vortex
API_PORT=4100
API_ORIGIN=https://bot-vortex.shardweb.app
INGEST_SECRET=change-this-bot-ingest-secret

NEXT_PUBLIC_API_URL=/api

DISCORD_TOKEN=put-your-discord-bot-token
DISCORD_CLIENT_ID=put-your-discord-client-id
DISCORD_GUILD_ID=put-your-discord-guild-id
BOT_API_URL=http://localhost:4100
BOT_INGEST_SECRET=change-this-bot-ingest-secret
```

`INGEST_SECRET` e `BOT_INGEST_SECRET` precisam ter o mesmo valor.

## Login inicial

A API cria automaticamente um usuario admin ao iniciar:

- Email: valor de `ADMIN_EMAIL`
- Senha: valor de `ADMIN_PASSWORD`

Troque esses valores antes de colocar em producao.

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
