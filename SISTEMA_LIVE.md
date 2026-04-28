# Sistema de Alerta de Live

## O que foi criado

Foi criado um sistema de alerta automatico de live usando o comando `/live`.

Qualquer usuario pode abrir o painel do `/live` e cadastrar ou alterar o proprio link da live. Quando o Discord detectar que esse usuario entrou em transmissao, o bot envia um aviso automatico no canal:

`1202251715865489459`

O aviso informa:

- Quem entrou em live.
- O link cadastrado pelo usuario.
- O lugar detectado pelo Discord onde a live esta acontecendo.

## Arquivos criados

- `commands/general/live.js`
  - Comando `/live`.
  - Abre o painel para cadastrar, alterar ou remover o link.
  - Cadastro e alteracao ficam liberados para qualquer usuario.
  - Remocao exige permissao configurada no `/painel`.

- `utils/liveAlertManager.js`
  - Salva os links em `commands/liveLinks.json`.
  - Detecta a atividade de streaming.
  - Monta o embed do aviso de live.
  - Evita avisos repetidos enquanto o usuario continua na mesma live.

- `events/presenceUpdate.js`
  - Escuta atualizacoes de presenca.
  - Dispara o alerta quando o Discord informa a live como atividade de streaming.

- `events/voiceStateUpdate.js`
  - Escuta mudancas em call/canal de voz.
  - Dispara o alerta quando o usuario inicia uma live dentro de uma call do Discord.
  - Usa a propria call como o lugar onde a live esta acontecendo.

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

### Cadastrar ou alterar link

Qualquer pessoa pode usar `/live` para cadastrar ou alterar o proprio link.

### Remover link

Para remover o link, o usuario precisa ter um cargo configurado no `/painel` em:

`Remover /live`

O cargo master tambem continua tendo permissao pela regra interna do sistema.

## Observacoes importantes

- O bot ja esta com `GatewayIntentBits.GuildPresences` no `index.js`.
- O bot tambem ja esta com `GatewayIntentBits.GuildVoiceStates`, usado para detectar live em call do Discord.
- O intent de Presence tambem precisa estar ativado no Developer Portal do Discord.
- Para o comando `/live` aparecer no Discord, e necessario reiniciar o bot ou redeployar os comandos.
- Se o arquivo `commands/liveLinks.json` nao existir no ambiente onde o bot esta rodando, o usuario precisa cadastrar o link novamente usando `/live`.

## Commits enviados

- `59710d6 Ajusta visibilidade do comando avisos`
- `1171482 Adiciona alerta automatico de live`
