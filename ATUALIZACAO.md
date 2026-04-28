# Atualizacao do Sistema Vortex

Este arquivo resume os principais sistemas criados, ajustados e organizados no bot Vortex.

## Sistema de Avisos

Foi criado um painel completo no comando `/avisos`.

O painel possui:

- Banner oficial da Vortex.
- Cabecalho `VORTEX | Aviso Oficial`.
- Titulo `Vortex informa`.
- Selecao de canal de texto.
- Selecao de usuario relacionado.
- Selecao de cargos extras para mencao.
- Selecao de c1all relacionada.
- Dois botoes principais:
  - `Enviar Local`
  - `Enviar Global Vortex`

Todo aviso enviado menciona os cargos fixos configurados e tambem os cargos extras selecionados no painel.

O modo global envia DM para os membros e tambem publica no canal selecionado.

Existe controle no `/painel` para ativar ou desativar DMs de avisos.

## Sistema de Ponto

Foi criado um sistema visual de bater ponto com banner da Vortex.

O painel de ponto possui:

- Botao `Entrar em Servico`.
- Botao `Sair de Servico`.
- Botao `Solicitar ajuste de ponto`.
- Explicacao visual de como usar o sistema.

Quando o usuario abre o ponto, ele fica registrado como online.

Quando fecha o ponto, o tempo e salvo automaticamente.

O canal de usuarios online do ponto e:

`1498087749784178708`

Esse canal agora so pode ser visto por quem esta com ponto aberto. Quando o usuario bate ponto, o bot libera o canal para ele. Quando fecha o ponto, o bot remove o acesso.

O painel online mostra os membros da fac em servico.

## Ajuste de Ponto

Foi criado um sistema para solicitar ajuste de ponto.

Ao clicar em `Solicitar ajuste de ponto`, o usuario informa:

- Horario correto em que ficou em game.
- Motivo de nao ter fechado o ponto.

O bot abre um canal privado de atendimento na categoria:

`1498087442304073870`

Nesse canal aparecem os botoes:

- `Aceitar ajuste`
- `Recusar ajuste`

Se o ajuste for aceito, o ponto do usuario e fechado automaticamente no horario informado.

Se for recusado, o usuario recebe a resposta da recusa.

O usuario recebe DM com:

- Status aprovado ou recusado.
- Usuario.
- Horario solicitado.
- Motivo informado.
- Quem aceitou ou recusou.
- Tempo contabilizado quando aprovado.
- Banner da Vortex.

## Relatorio de Pontos

No `/painel`, aba `Pontos`, foi adicionado o botao:

`Mostrar todos os pontos`

Esse relatorio mostra:

- Todos os usuarios com ponto.
- Quem esta online.
- Pontos fechados.
- Ajustes registrados.
- Horario de abertura.
- Ultimo fechamento.
- Tempo total.
- Usuarios que menos logaram.

O relatorio tambem gera um arquivo TXT anexado.

## Comando `/registro`

Foi criado o comando `/registro`.

Ele substitui o antigo `/registrplayer`.

Uso:

`/registro`

ou

`/registro usuario:@usuario`

Ele mostra o registro de ponto de um usuario, incluindo:

- Status do ponto.
- Abertura atual.
- Ultima abertura.
- Ultimo fechamento.
- Dias logados.
- Tempo total.
- Tempo do ponto atual.
- Quantidade de ajustes.

## Comando `/clear`

Foi criado o comando `/clear`.

Uso:

`/clear quantidade:10`

Ele apaga a quantidade de mensagens informada no canal.

Regras:

- Qualquer usuario pode usar o comando.
- O bot precisa ter permissao `Gerenciar Mensagens`.
- O Discord so permite apagar mensagens recentes.
- Toda limpeza gera log no sistema Vortex.

## Comandos Removidos

Foram removidos:

- `/calltemporaria`
- `/registrplayer`

O sistema de registro foi transferido para `/registro`.

## Sistema de Cargos Vortex

O antigo modo de cargos staff foi reorganizado para `Cargos Vortex`.

Existe um cargo master:

`1497703127074345040`

Esse cargo e o unico com acesso total.

Ele pode usar tudo, inclusive manutencao.

Os demais cargos precisam ser configurados dentro do `/painel`.

Niveis criados:

### Admin Vortex

Pode mexer nos sistemas administrativos, como:

- Avisos.
- Set.
- Pontos.
- Ajustes de ponto.
- Configuracoes gerais.

Nao pode mexer em manutencao.

### Medio Vortex

Pode usar funcoes intermediarias, como:

- Aceitar set.
- Mandar avisos.
- Configuracoes liberadas de Set e Avisos.

### Membro Vortex

Pode usar funcoes basicas, como:

- Botoes de bater ponto.
- Registro basico.

## Permissoes por Comando

Foi criada uma aba de configuracao de comandos dentro do `/painel`.

Nela e possivel definir quais cargos podem usar cada comando ou acao.

Os comandos sao bloqueados se o cargo nao estiver configurado no modo `Cargos Vortex`.

Excecao:

- `/clear` pode ser usado por todos.

## Modo Manutencao

O modo manutencao foi reforcado.

Enquanto o bot estiver em manutencao:

- Ninguem consegue usar comandos ou interacoes.
- Apenas o cargo master `1497703127074345040` consegue usar.
- O estado fica salvo em `commands/config.json`.
- Se o bot reiniciar ou desligar, a manutencao continua ativa ate ser desativada pelo master.

## Notificacao Automatica de Atualizacao

Foi criado um sistema automatico de notificacao de atualizacao.

Sempre que o bot inicia ou reinicia, ele envia mensagem no canal configurado:

`14977767502333912041`

Mencionando o cargo:

`1201235607549124639`

A mensagem inclui:

- Embed profissional.
- Status online.
- Nome do bot.
- Ambiente.
- Versao.
- Data e hora.
- Banner da Vortex.
- Arquivo TXT com resumo das atualizacoes.

Variaveis usadas:

```env
UPDATE_LOG_CHANNEL_ID=14977767502333912041
UPDATE_NOTIFY_ROLE_ID=1201235607549124639
BOT_ENV=production
BOT_VERSION=1.0.0
```

## Logs

Foram adicionados logs para varias acoes:

- Comandos executados.
- Avisos enviados.
- Ponto aberto.
- Ponto fechado.
- Ajuste aprovado.
- Ajuste recusado.
- Relatorio de pontos gerado.
- Mensagens apagadas com `/clear`.
- Alteracoes no painel.
- Inicializacao e atualizacao do bot.

## Arquivos Protegidos no Git

O `.gitignore` foi reforcado para nao subir arquivos locais e sensiveis.

Arquivos de estado local ignorados:

- `.env`
- `commands/config.json`
- `commands/stats.json`
- `commands/pontos.json`
- `commands/pontoPanels.json`
- `commands/pontoAdjustRequests.json`
- `commands/pedidos_ativos.json`
- `commands/ausencias.json`
- backups
- caches
- uploads
- transcripts
- reports

Foi criado o arquivo seguro:

`commands/config.example.json`

Ele serve como modelo para configurar o bot em producao.

## Observacoes de Deploy

Depois de atualizar o codigo no servidor, rode o deploy dos comandos para registrar novos slash commands:

```bash
node deploy-commands.js
```

Depois reinicie o bot.

Comandos novos como `/registro` e `/clear` so aparecem no Discord depois do deploy dos comandos.
