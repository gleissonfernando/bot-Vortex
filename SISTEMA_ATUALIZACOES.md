# Sistema de Atualizacoes

Este arquivo deve registrar, por escrito, o que foi mudado no bot a cada ajuste relevante.

## 2026-04-29

- Removido o aviso automatico de "Bot Atualizado" que era enviado no evento `ready`.
- Removida a configuracao de canal do sistema de atualizacoes no `/painel`.
- Mantido o registro de mudancas em Markdown para consulta manual no projeto e no painel.
- Ajustado o sistema de live para monitorar cadastros por usuario no `liveLinks.json`, usando o mesmo fluxo automatico que monitora `TWITCH_STREAMERS`.
- Ajustado o acesso master para reconhecer os cargos `1497703127074345040` e `1498884908028792942`.
- Ajustado o `/painel` para buscar estatisticas reais do Discord quando possivel.
