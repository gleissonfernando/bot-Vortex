# Sistema - Correcoes e Atualizacoes

Atualizado em: horario real do bot no painel.

## Ponto

- Ajuste de ponto agora aceita data e horario separados.
- Data aceita exemplos como `23`, `23/04`, `23/04/2026` ou `23 ate 24`.
- Horario aceita exemplos como `23 as 02`, `23:00 ate 02:00`, `23h 02h` ou `12 as 23`.
- Quando o horario de fechamento passa da meia-noite, o sistema joga o fechamento automaticamente para o dia seguinte.
- Reajustes aparecem como corrigidos no transcript.
- O transcript diario de ponto e enviado automaticamente todos os dias as 00:00 no canal `1497776750233391204`.
- Depois do envio diario, o ciclo de pontos e reiniciado para comecar tudo de novo.
- Fechamento manual de ponto no `/painel > Pontos` exige confirmacao antes de aplicar.
- Quando o ponto e fechado manualmente ou automaticamente, o usuario recebe DM e o canal de correcao de ponto pode ser aberto em `1498087442304073870`.
- Quando um ajuste de ponto e realizado, o sistema gera log e envia DM ao usuario avisando que o ponto foi alterado.
- O canal da gerencia so recebe mensagem automatica quando o usuario acumula 3 falhas de confirmacao/fechamento de ponto.

## Perfil

- Criado o comando `/perfil`.
- O perfil mostra ID Discord, nome, nivel em game, call/canal, fotos salvas e datas reais.
- O `/set` agora pergunta o nivel em game.
- Pessoas aprovadas no `/set` entram no sistema de perfil.
- O painel possui cadastro manual para usuarios que ja estao no Discord.
- Links de foto ficam salvos em JSON para historico.
- A cobranca de atualizacao de perfil por DM pode ser ligada ou desligada no painel.
- Somente usuarios cadastrados no perfil ou aprovados no `/set` conseguem usar `/perfil`.
- Usuario comum so pode atualizar o proprio perfil.
- Usuario comum deve usar `/perfil` dentro do proprio canal/call cadastrado.
- Gerencia/Admin pode consultar e atualizar qualquer perfil.
- O `/perfil` permite atualizar foto e nivel com `/perfil link:<link da foto> nivel:<numero>`.
- O `/perfil` tambem aceita upload direto de imagem usando a opcao `foto`.
- Se o perfil ficar 1 dia sem atualizacao, o usuario recebe DM e a gerencia e avisada no canal configurado.

## Set

- Ao aprovar um usuario no `/set`, o sistema salva os dados no perfil.
- Ao aprovar, tambem cria canal do usuario aprovado.
- Os canais criados para aprovados sao privados para o usuario, gerencia e bot.
- Canais de aprovados recebem guia inicial com passos de `/perfil`, `/ponto` e `/ausencia`.
- Se o usuario sair do Discord, o canal dele e removido automaticamente.

## Ausencia

- `/ausencia` possui painel com banner da Vortex e botoes.
- O painel de ausencia foi reorganizado visualmente com campos de instrucao, formatos aceitos e retorno.
- O usuario pode solicitar ou retirar ausencia.
- Periodos aceitos incluem horas, dias e datas.

## Data e hora

- O sistema foi padronizado para usar data real e horario real no fuso `America/Sao_Paulo`.
- Paineis, logs, perfis, ponto, ausencia, manutencao e avisos usam esse padrao.
