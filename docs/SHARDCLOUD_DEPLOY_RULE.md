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

Antes da action enviar para a ShardCloud, o workflow roda `npm run deploy:check`, gera os artefatos (`dist` e `.next/standalone`) e remove arquivos de CI que nao devem entrar no deploy, como `node_modules`, `package-lock.json` e `.env`.

Por isso o `.shardcloud` deve ficar curto:

```env
MAIN=shardcloud-start.js
LANGUAGE=node
MEMORY=1024
CUSTOM_COMMAND=PORT=80 npm start
```

O `CUSTOM_COMMAND` precisa ficar abaixo de 250 caracteres, conforme a regra da ShardCloud. As flags de hospedagem nao ficam mais nesse campo; elas sao aplicadas pelo `shardcloud-start.js`.

## Runtime da hospedagem

`shardcloud-start.js` e o supervisor da Vortex na ShardCloud. Ele:

- aplica defaults de producao para build de API/web, registro de comandos e uso de memoria;
- inicia o bot Discord, a Frequency API e o Next standalone;
- abre o proxy publico em `PORT=80`;
- expõe `/health` para diagnostico rapido no Next e no supervisor; `/_shardcloud/health` tambem existe no supervisor se a ShardCloud encaminhar trafego publico por ele;
- reinicia processos internos que cairem;
- gera `JWT_SECRET` e `INGEST_SECRET` efemeros apenas se eles nao estiverem configurados, para impedir loop de crash. Para sessoes estaveis, configure secrets fixos na ShardCloud.

O arquivo `.shardignore` tambem deve continuar versionado para impedir envio de cache, segredos e JSONs de runtime.

## Variaveis obrigatorias no GitHub Actions

Configure no GitHub, em `Settings > Secrets and variables > Actions`:

```env
SHARD_CLOUD_API_KEY=
SHARDCLOUD_APP_ID=ccc23af3-03b5-4174-8143-f9da45518d1c
```

`SHARD_CLOUD_API_KEY` precisa ser uma API key criada no painel da ShardCloud em `Config > Integrations`, no mesmo usuario que tem permissao para atualizar o app.

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

## Erro `user cannot update project`

Esse erro vem da API da ShardCloud, nao da build da Vortex.

Ele significa que a API key ou integracao usada no GitHub/ShardCloud nao tem permissao para atualizar o app configurado. Corrija assim:

- No GitHub, em `Settings > Secrets and variables > Actions`, atualize `SHARD_CLOUD_API_KEY` com uma API key criada no mesmo usuario que e dono do app na ShardCloud.
- Se o app ID mudou, configure `SHARDCLOUD_APP_ID` como secret ou variable com o ID correto do projeto.
- Se estiver usando a integracao Git nativa da ShardCloud, desconecte e conecte o GitHub novamente em `Config > Integrations`, liberando acesso ao repositorio `gleissonfernando/bot-Vortex`.
- Nao coloque a API key no codigo, no `.env` ou em mensagem de chat.

## Fluxo certo

1. Faca a alteracao.
2. Rode `npm run deploy:check`.
3. Se passar, faca commit e push para `main`.
4. No push, o workflow `.github/workflows/shardcloud-deploy.yml` valida, executa `shard-cloud/action@main`, faz `commit` na ShardCloud e reinicia o app.
5. Depois do restart, valide `https://bot-vortex.shardweb.app` e `/api/health`.
