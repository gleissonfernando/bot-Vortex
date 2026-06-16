# Regra de deploy da Vortex na ShardCloud

Use esta regra sempre antes de subir mudancas para `main`.

## Comando obrigatorio

```bash
npm run deploy:check
```

Esse comando faz o preflight completo:

- confere `package.json`, `.shardcloud` e workflow do GitHub;
- checa sintaxe dos arquivos JS do bot com `node --check`;
- compila API, bot e web do `frequency-panel`;
- confirma que existem `frequency-panel/apps/api/dist/index.js` e o Next standalone em `frequency-panel/apps/web/.next/standalone/apps/web/server.js`;
- falha antes do upload se o pacote nao estiver pronto.

## Regra da ShardCloud

O deploy deve compilar antes de enviar o zip. A ShardCloud deve apenas iniciar artefatos prontos.

Por isso o `.shardcloud` usa:

```env
REQUIRE_BUILT_ASSETS=true
BUILD_API_ON_STARTUP=false
BUILD_WEB_ON_STARTUP=false
```

Nao volte `BUILD_API_ON_STARTUP` ou `BUILD_WEB_ON_STARTUP` para `true` sem aumentar memoria e testar na hospedagem. Build no boot consome memoria, deixa o restart lento e costuma causar erro intermitente.

## Variaveis obrigatorias na hospedagem

Configure na ShardCloud, nunca no Git:

```env
MONGODB_URI=
JWT_SECRET=
INGEST_SECRET=
ADMIN_EMAIL=
ADMIN_PASSWORD=
SITE_ORIGIN=https://bot-vortex.shardweb.app
DISCORD_TOKEN=
DISCORD_CLIENT_ID=1505924330490695800
DISCORD_CLIENT_SECRET=
DISCORD_OAUTH_REDIRECT_URI=https://bot-vortex.shardweb.app/api/auth/discord/callback
```

`JWT_SECRET` e `INGEST_SECRET` precisam ter pelo menos 32 caracteres. `ADMIN_PASSWORD` precisa ter pelo menos 12 caracteres. Para validar o `.env` local sem mostrar segredos:

```bash
npm run deploy:check:env
```

## Fluxo certo

1. Faça a alteracao.
2. Rode `npm run deploy:check`.
3. Se passar, faça commit e push para `main`.
4. O workflow `.github/workflows/shardcloud-deploy.yml` vai empacotar sem `.env`, sem `node_modules` e sem arquivos JSON de estado local.
5. Depois do restart, valide `https://bot-vortex.shardweb.app` e `/api/health`.
