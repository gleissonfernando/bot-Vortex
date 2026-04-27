const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();

const config = require('./config/config');
const token = config.token;
const clientId = config.clientId;
let guildId = config.guildId;

if (!token || !clientId) {
    console.error('❌ Erro: DISCORD_TOKEN ou DISCORD_CLIENT_ID não encontrados no .env ou config.js');
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
        if (guildId && (guildId.includes('discord.gg') || !/^\d+$/.test(guildId))) {
            const match = guildId.match(/\d+/);
            guildId = match ? match[0] : null;
        }

        console.log('⏳ Limpando comandos globais para evitar duplicados...');
        await rest.put(Routes.applicationCommands(clientId), { body: [] });

        if (!guildId || !/^\d+$/.test(guildId)) {
            throw new Error('DISCORD_GUILD_ID/VITE_DISCORD_GUILD_ID invalido ou ausente para sincronizacao no servidor.');
        }

        console.log(`⏳ Sincronizando ${commands.length} comandos de barra (/) no servidor ${guildId}...`);

        const data = await rest.put(
            Routes.applicationGuildCommands(clientId, guildId),
            { body: commands },
        );

        console.log(`✅ Sucesso! ${data.length} comandos registrados no servidor ${guildId}.`);
        console.log('💡 Comandos de servidor aparecem mais rapido e nao duplicam com comandos globais.');
    } catch (error) {
        console.error('❌ Erro ao registrar comandos:', error);
    }
})();
