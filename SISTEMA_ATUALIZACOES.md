# Sistema - Correcoes e Atualizacoes

Atualizado em: horario real do bot no painel.

## Ponto

- Ajuste de ponto agora exige data obrigatoria no formato `DD/MM/AAAA HH:mm:ss`.
- O horario pode ser qualquer horario valido, mas precisa vir junto com a data.
- Reajustes aparecem como corrigidos no transcript.
- O transcript diario de ponto e enviado automaticamente todos os dias as 00:00 no canal `1498473417144533255`.
- Depois do envio diario, o ciclo de pontos e reiniciado para comecar tudo de novo.

## Perfil

- Criado o comando `/perfil`.
- O perfil mostra ID Discord, nome, nivel em game, call/canal, fotos salvas e datas reais.
- O `/set` agora pergunta o nivel em game.
- Pessoas aprovadas no `/set` entram no sistema de perfil.
- O painel possui cadastro manual para usuarios que ja estao no Discord.
- Links de foto ficam salvos em JSON para historico.
- A cobranca de atualizacao de perfil por DM pode ser ligada ou desligada no painel.

## Set

- Ao aprovar um usuario no `/set`, o sistema salva os dados no perfil.
- Ao aprovar, tambem cria canal do usuario aprovado.
- Os canais criados para aprovados podem ser vistos por todos.
- Se o usuario sair do Discord, o canal dele e removido automaticamente.

## Ausencia

- `/ausencia` possui painel com banner da Vortex e botoes.
- O usuario pode solicitar ou retirar ausencia.
- Periodos aceitos incluem horas, dias e datas.

## Data e hora

- O sistema foi padronizado para usar data real e horario real no fuso `America/Sao_Paulo`.
- Paineis, logs, perfis, ponto, ausencia, manutencao e avisos usam esse padrao.
