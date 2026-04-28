# Sistema de Correcao

Este arquivo descreve os ajustes implementados no sistema Vortex.

## Ponto

- O sistema registra data e horario real do ponto com hora, minuto e segundo.
- O `/painel` na aba de pontos possui selecao de usuario para facilitar a busca da pessoa.
- O botao `Reajustar ponto` permite informar:
  - horario que abriu o ponto;
  - horario que fechou o ponto.
- O reajuste soma o periodo informado ao total do usuario e salva o registro em `commands/pontos.json`.
- Formatos aceitos:
  - `HH:mm:ss` para o dia atual;
  - `DD/MM/AAAA HH:mm:ss` para uma data especifica.
- Os segundos sao opcionais.

## Ausencia

- O comando `/ausencia` abre um painel com botoes.
- O botao `Solicitar ausencia` abre o formulario de solicitacao.
- O botao `Retirar ausencia` remove a ausencia ativa do proprio usuario.
- O periodo da ausencia aceita:
  - `12:00` para horas e minutos;
  - `12h` para horas;
  - `3` para quantidade de dias;
  - `12/01` para dia e mes;
  - `12/01/2026` para data completa.

## Git

Repositorio de destino:

`https://github.com/gleissonfernando/bot-Vortex.git`
