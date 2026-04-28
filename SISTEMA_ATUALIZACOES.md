# Sistema - Atualizações Recentes

Atualizado em: 28/04/2026.

## Perfil
- `/perfil` agora aceita atualização por link e por upload direto na opção `foto`.
- O usuário pode atualizar foto e nível no mesmo comando.
- Apenas usuários cadastrados ou aprovados no `/set` podem usar `/perfil`.
- Usuário comum atualiza somente o próprio perfil e deve usar o comando no canal cadastrado.
- Gerência/Admin pode consultar e atualizar qualquer perfil.
- Cobrança de perfil envia DM ao usuário e só avisa a gerência após 1 dia sem atualização.

## Ponto
- Reajuste de ponto aceita data e horário separados.
- Data aceita `23`, `23/04`, `23/04/2026` ou `23 até 24`.
- Horário aceita `23 às 02`, `23:00 até 02:00`, `23h 02h` ou `12 às 23`.
- Quando o fechamento passa da meia-noite, o sistema joga o fechamento para o dia seguinte.
- Fechamento manual no `/painel > Pontos` exige confirmação.
- Fechamento manual ou automático envia DM ao usuário e pode abrir canal de correção em `1498087442304073870`.
- Ajuste realizado gera log e DM ao usuário, sem mensagem no canal da gerência.
- Canal da gerência só recebe cobrança quando há 3 falhas de confirmação/fechamento de ponto.

## Ausência
- `/ausencia` recebeu painel visual reorganizado com instruções, formatos aceitos e orientação de retorno.

## Avisos e Atualização
- `/avisos` possui envio individual por DM.
- Mensagens globais vão por DM; canal só recebe aviso quando o envio local for escolhido.
- Mensagem de atualização do bot usa o canal `1497776750233391204` com fallback caso o `.env` esteja incorreto.

## Set
- Canais criados para aprovados no `/set` ficam privados para usuário, gerência e bot.
- Canais aprovados recebem guia inicial sobre `/perfil`, `/ponto` e `/ausencia`.
