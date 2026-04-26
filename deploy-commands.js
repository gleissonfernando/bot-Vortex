const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();

const token = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;
const clientId = process.env.VITE_DISCORD_CLIENT_ID || process.env.DISCORD_CLIENT_ID;

if (!token || !clientId) {
    console.error('❌ Erro: DISCORD_TOKEN ou DISCORD_CLIENT_ID não encontrados no .env');
    process.exit(1);
}

const commands = [];
const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    if (!fs.statSync(commandsPath).isDirectory()) continue;
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            commands.push(command.data.toJSON());
            console.log(`✅ Carregado comando: ${command.data.name}`);
        }
    }
}

const rest = new REST().setToken(token);

(async () => {
    try {
        console.log(`⏳ Iniciando atualização de ${commands.length} comandos de barra (/) globais...`);

        const data = await rest.put(
            Routes.applicationCommands(clientId),
            { body: commands },
        );

        console.log(`✅ Sucesso! ${data.length} comandos registrados globalmente no Discord.`);
        console.log('💡 Nota: Comandos globais podem levar alguns minutos para aparecer em todos os servidores.');
    } catch (error) {
        console.error('❌ Erro ao registrar comandos:', error);
    }
})();
