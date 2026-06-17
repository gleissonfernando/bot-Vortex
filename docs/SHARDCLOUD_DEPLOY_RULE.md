# Regra de deploy da Vortex na ShardCloud

Use esta regra sempre antes de subir mudancas para `main`.

## Comando obrigatorio

```bash
npm run deploy:check
```

Esse comando faz o preflight completo:

- confere `package.json`, `.shardcloud` e workflow do GitHub;
- checa sintaxe dos arquivos JS do bot com `node --check`;
- confirma que `/encomenda`, `/exibir` e `/painel` estao prontos para registro no Discord;
- compila API, bot e web do `frequency-panel`;
- confirma que existem `frequency-panel/apps/api/dist/index.js` e o Next standalone em `frequency-panel/apps/web/.next/standalone/apps/web/server.js`;
- falha antes do deploy se o pacote nao estiver pronto.

## Regra da ShardCloud

O deploy oficial fica no GitHub Actions usando `shard-cloud/action@main`, com `commit <app_id>` seguido de `restart <app_id>`.

Antes da action enviar para a ShardCloud, o workflow roda `npm run deploy:check`, gera os artefatos (`dist` e `.next/standalone`) e remove arquivos de CI que nao devem entrar no deploy, como `node_modules`, caches e `.env`. Os `package-lock.json` precisam ir no pacote para a hospedagem instalar o mesmo grafo que passou no preflight.

Por isso o `.shardcloud` deve ficar curto:

```env
APPID=ccc23af3-03b5-4174-8143-f9da45518d1c
MAIN=shardcloud-start.js
LANGUAGE=node
MEMORY=1024
CUSTOM_COMMAND=MEMORY=1024 PORT=80 npm start
```

O `CUSTOM_COMMAND` precisa ficar abaixo de 250 caracteres, conforme a regra da ShardCloud. Mantenha `MEMORY=1024 PORT=80 npm start` para garantir que o runtime Node tambem enxergue o limite de memoria e que a hospedagem encaminhe para a porta publica correta; as demais flags de hospedagem ficam no `shardcloud-start.js` e nas variaveis do painel.
O `APPID` precisa ficar no `.shardcloud` para que `commit` e `restart` usem sempre o mesmo app da ShardCloud. Nao deixe um fallback de app id escondido no workflow.

## Runtime da hospedagem

`shardcloud-start.js` e o supervisor da Vortex na ShardCloud. Ele:

- aplica defaults de producao para build de API/web, registro de comandos e uso de memoria;
- evita build pesado do web no startup quando a hospedagem esta em 1GB, mantendo proxy/API vivos e usando o fallback web se o standalone nao estiver no pacote;
- inicia o bot Discord, a Frequency API e o Next standalone;
- permite desabilitar o Next/web em runtime com `NO_NEXT=true` ou `SKIP_FREQUENCY_WEB=true`, mantendo apenas o backend Node.js;
- abre o proxy publico por padrao e mantem a porta `80` obrigatoria na ShardCloud, mesmo se `PORT` vier errado;
- expõe `/health` para diagnostico rapido no Next e no supervisor; `/_shardcloud/health` tambem existe no supervisor se a ShardCloud encaminhar trafego publico por ele;
- reinicia processos internos que cairem;
- gera `JWT_SECRET` e `INGEST_SECRET` efemeros apenas se eles nao estiverem configurados, para impedir loop de crash. Para sessoes estaveis, configure secrets fixos na ShardCloud.

## Diagnostico de 502 na ShardCloud

Quando `https://bot-vortex.shardweb.app/health` retorna a pagina `502 Bad Gateway` da ShardCloud em vez de JSON, o processo principal nao esta escutando na porta publica esperada.

Verifique nesta ordem:

- `CUSTOM_COMMAND=MEMORY=1024 PORT=80 npm start` no `.shardcloud`;
- `SHARDCLOUD_ALLOW_PUBLIC_PROXY_DISABLE` ausente ou diferente de `true`;
- `SHARDCLOUD_REQUIRE_PORT_80` ausente ou diferente de `false`;
- `PORT=80` e `WEB_PORT=80` na hospedagem;
- `START_DISCORD_BOT` ausente ou diferente de `false`;
- `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID` e `MONGODB_URI` configurados na ShardCloud.

Se `/health` voltar JSON, confira `config.startDiscordBot`, `config.hasDiscordToken` e `children.discord-bot` para saber se o bot iniciou, foi pulado por falta de token, ou foi desligado por variavel de ambiente.

O arquivo `.shardignore` tambem deve continuar versionado como contrato do pacote, mas a CLI oficial da ShardCloud nao le esse arquivo. Por isso o workflow precisa remover explicitamente cache, segredos e JSONs de runtime antes do `commit`.
Quando a validacao publica falhar, o workflow consulta o status do app pela API da ShardCloud e publica apenas `status`, `name`, `ram` e `vcpu` como anotacao do check. Nao use `logs`/`status` do CLI dentro da Action porque esses comandos ficam em streaming/interativos.

## Variaveis obrigatorias no GitHub Actions

Configure no GitHub, em `Settings > Secrets and variables > Actions`:

```env
SHARD_CLOUD_API_KEY=
```

`SHARD_CLOUD_API_KEY` precisa ser uma API key criada no painel da ShardCloud em `Config > Integrations`, no mesmo usuario que tem permissao para atualizar o app.
O app alvo fica em `APPID` dentro da `.shardcloud`. Se o app mudar, atualize esse arquivo e rode `npm run deploy:check`.
Opcionalmente configure `SHARDCLOUD_PUBLIC_URL` se o dominio publico mudar.

## Variaveis obrigatorias na hospedagem

Configure na ShardCloud, nunca no Git. O bloco canônico tem 34 linhas:

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
MONGODB_URI=
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
JWT_SECRET=
ADMIN_EMAIL=
ADMIN_PASSWORD=
INGEST_SECRET=
BOT_INGEST_SECRET=
FREQUENCY_API_URL=http://127.0.0.1:4100
FREQUENCY_DASHBOARD_SYNC=true
FREQUENCY_MEMBER_SYNC_INTERVAL_MS=900000
POINT_AUTOMATION_INTERVAL_MS=900000
```

As variaveis canonicas sao `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID` e `MONGODB_URI`. O runtime tambem aceita os aliases comuns da ShardCloud (`TOKEN`, `CLIENT_ID`, `GUILD_ID`, `DATABASE_URL`, `MONGO_URI`, `DISCORD_BOT_TOKEN`) se voce precisar trocar algum nome, mas nao configure a variavel canonica e o alias ao mesmo tempo quando estiver mantendo o limite de 34 linhas.
`JWT_SECRET` e `INGEST_SECRET` precisam ter pelo menos 32 caracteres. `ADMIN_PASSWORD` precisa ter pelo menos 12 caracteres. Para validar o `.env` local sem mostrar segredos:

```bash
npm run deploy:check:env
```

## Erro `user cannot update project`

Esse erro vem da API da ShardCloud, nao da build da Vortex.

Ele significa que a API key ou integracao usada no GitHub/ShardCloud nao tem permissao para atualizar o app configurado. Corrija assim:

- No GitHub, em `Settings > Secrets and variables > Actions`, atualize `SHARD_CLOUD_API_KEY` com uma API key criada no mesmo usuario que e dono do app na ShardCloud.
- Se o app ID mudou, atualize `APPID` na `.shardcloud` com o ID correto do projeto.
- Se estiver usando a integracao Git nativa da ShardCloud, desconecte e conecte o GitHub novamente em `Config > Integrations`, liberando acesso ao repositorio `gleissonfernando/bot-Vortex`.
- Nao coloque a API key no codigo, no `.env` ou em mensagem de chat.

## Fluxo certo

1. Faca a alteracao.
2. Rode `npm run deploy:check`.
3. Se passar, faca commit e push para `main`.
4. No push, o workflow `.github/workflows/shardcloud-deploy.yml` valida, executa `shard-cloud/action@main`, faz `commit` na ShardCloud e reinicia o app usando o `APPID` da `.shardcloud`.
5. Depois do restart, o workflow valida `https://bot-vortex.shardweb.app/health`, `https://bot-vortex.shardweb.app/_shardcloud/health` e `https://bot-vortex.shardweb.app/api/health`; se todas falharem ou mostrarem build antigo, o deploy fica vermelho.
