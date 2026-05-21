# Pasta `commands`

Esta pasta tem dois tipos de arquivo:

- `general/*.js`: comandos reais do bot.
- `*.json`: estado/cache local usado pelo bot e espelhado no MongoDB pelo `utils/mongoJsonStore.js`.

Os JSONs precisam continuar neste caminho enquanto o codigo ainda usa `fs.readFileSync` e `fs.writeFileSync`.
Eles nao devem ser versionados, porque contem dados de servidor, usuarios, ponto, perfis e paineis.

O arquivo `config.example.json` e o modelo seguro para publicar.
