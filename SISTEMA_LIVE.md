# Sistema de Alerta de Live

## O que foi criado

Foi criado um sistema de alerta automatico de live usando o comando `/live`.

Qualquer usuario pode abrir o painel do `/live`, mas primeiro precisa aceitar os termos pela pagina web gerada pelo proprio painel. Depois do aceite, o cadastro de links e liberado.

O usuario pode cadastrar quantos links quiser. Quando o Discord ou a Twitch detectar que um dos canais entrou em transmissao, o bot envia um aviso automatico no canal:

`1202251715865489459`

O aviso informa:

- Quem entrou em live.
- O link cadastrado pelo usuario.
- O lugar detectado pelo Discord onde a live esta acontecendo.

## Arquivos criados

- `commands/general/live.js`
  - Comando `/live`.
  - Abre o painel para aceitar termos e cadastrar links.
  - Antes do aceite, mostra o link de termos.
  - Depois do aceite, libera adicionar varios links.
  - Remocao exige permissao configurada no `/painel`.

- `utils/liveAlertManager.js`
  - Salva os links em `commands/liveLinks.json`.
  - Detecta a atividade de streaming.
  - Consulta a Twitch Helix quando o link cadastrado for da Twitch.
  - Monta o embed do aviso de live.
  - Evita avisos repetidos enquanto o usuario continua na mesma live.

- `events/presenceUpdate.js`
  - Escuta atualizacoes de presenca.
  - Dispara o alerta quando o Discord informa a live como atividade de streaming.

- `events/voiceStateUpdate.js`
  - Escuta mudancas em call/canal de voz.
  - Dispara o alerta quando o usuario inicia uma live dentro de uma call do Discord.
  - Usa a propria call como o lugar onde a live esta acontecendo.

## Monitor Twitch

Quando o link cadastrado no `/live` for da Twitch, o bot extrai o nome do canal pelo link e consulta a Twitch Helix a cada 60 segundos.

Se a Twitch retornar a stream como online, o bot envia o alerta no canal configurado:

`1202251715865489459`

Para esse monitor funcionar, o `.env` precisa ter:

```env
TWITCH_CLIENT_ID=seu_client_id
TWITCH_CLIENT_SECRET=seu_client_secret
```

Essas credenciais sao de um app criado no painel de desenvolvedor da Twitch.

## Aceite de termos

O `/live` gera um link unico por servidor e usuario:

`/twitch?token=...`

Essa pagina mostra os termos e direciona para:

`/twitch/webhook?token=...`

Quando essa rota recebe um token valido, o usuario fica marcado como aceito em `commands/liveLinks.json`. Depois disso, o painel `/live` libera o botao para adicionar links.

## Termos e privacidade

A pagina de termos informa que o Bot Vortex pode coletar e armazenar:

- ID do usuario no Discord.
- Nome de usuario.
- ID do servidor.
- Canal da Twitch vinculado.

Esses dados sao usados exclusivamente para:

- Identificar o usuario dentro do sistema.
- Enviar alertas automaticos de live.
- Exibir informacoes no painel administrativo.

A politica de privacidade informa que os dados nao sao vendidos nem compartilhados com terceiros, e que o usuario pode solicitar a remocao dos dados ao administrador do bot.

## Arquivos alterados

- `events/interactionCreate.js`
  - Liberou o `/live` para qualquer membro.
  - Conectou os botoes e modal do painel de live.

- `commands/general/painel.js`
  - Adicionou a permissao `Remover /live`.
  - Essa permissao aparece na area de permissoes do `/painel`.

- `commands/config.example.json`
  - Adicionou a chave `live_remove` em `COMMAND_ROLE_PERMISSIONS`.

## Regras de permissao

### Cadastrar links

Qualquer pessoa pode usar `/live`, aceitar os termos e cadastrar quantos links quiser.

### Remover link

Para remover os links, o usuario precisa ter um cargo configurado no `/painel` em:

`Remover /live`

O cargo master tambem continua tendo permissao pela regra interna do sistema.

## Observacoes importantes

- O bot ja esta com `GatewayIntentBits.GuildPresences` no `index.js`.
- O bot tambem ja esta com `GatewayIntentBits.GuildVoiceStates`, usado para detectar live em call do Discord.
- O monitor Twitch nao depende do Discord mostrar a atividade de live, mas precisa das credenciais `TWITCH_CLIENT_ID` e `TWITCH_CLIENT_SECRET`.
- O intent de Presence tambem precisa estar ativado no Developer Portal do Discord.
- Para o comando `/live` aparecer no Discord, e necessario reiniciar o bot ou redeployar os comandos.
- Se o arquivo `commands/liveLinks.json` nao existir no ambiente onde o bot esta rodando, o usuario precisa cadastrar o link novamente usando `/live`.

## Commits enviados

- `59710d6 Ajusta visibilidade do comando avisos`
- `1171482 Adiciona alerta automatico de live`
