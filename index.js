const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const fs = require('fs');
const path = require('path');
const config = require('./config/config');
const { logger } = require('./utils/logger');
const { setDiscordClient } = require('./utils/dashboardClient');
const { notifyError } = require('./utils/notifications');

const app = express();
const API_PORT = Number(process.env.API_PORT || 3000);
const API_HOST = process.env.API_HOST || '0.0.0.0';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers
    ]
});

client.commands = new Collection();
setDiscordClient(client);

// Carregar Comandos
const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.existsSync(foldersPath) ? fs.readdirSync(foldersPath) : [];

for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    if (!fs.statSync(commandsPath).isDirectory()) continue;
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        try {
            const command = require(filePath);
            if (command.data && command.execute) client.commands.set(command.data.name, command);
        } catch (error) { console.error(`Erro comando ${file}:`, error.message); }
    }
}

// Carregar Eventos
const eventsPath = path.join(__dirname, 'events');
if (fs.existsSync(eventsPath)) {
    const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
    for (const file of eventFiles) {
        try {
            const event = require(path.join(eventsPath, file));
            if (event.once) client.once(event.name, (...args) => event.execute(...args));
            else client.on(event.name, (...args) => event.execute(...args));
        } catch (error) { console.error(`Erro evento ${file}:`, error.message); }
    }
}

// Registro de Comandos (Blindado)
const registerCommands = async () => {
    const commandsData = client.commands.map(cmd => cmd.data.toJSON());
    const rest = new REST({ version: '10' }).setToken(config.token);

    try {
        let guildId = config.guildId;
        if (guildId && (guildId.includes('discord.gg') || !/^\d+$/.test(guildId))) {
            const match = guildId.match(/\d+/);
            guildId = match ? match[0] : null;
        }

        console.log('Registrando comandos...');
        if (guildId) {
            await rest.put(Routes.applicationGuildCommands(config.clientId, guildId), { body: commandsData })
                .then(() => console.log('Comandos registrados no servidor.'))
                .catch(() => rest.put(Routes.applicationCommands(config.clientId), { body: commandsData }));
        } else {
            await rest.put(Routes.applicationCommands(config.clientId), { body: commandsData });
        }
    } catch (error) { console.error('Erro no registro:', error.message); }
};

client.once('ready', async () => {
    console.log(`Vortex Online: ${client.user.tag}`);
    await registerCommands();
});

// Blindagem contra Erros (Expected a string primitive fix)
process.on('unhandledRejection', (reason) => {
    console.error('Rejeição não tratada:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Exceção não capturada:', error.message);
    // Impede o bot de desligar
});

client.login(config.token).catch(console.error);
app.listen(API_PORT, API_HOST, () => console.log(`API Vortex: ${API_PORT}`));

module.exports = { client };
