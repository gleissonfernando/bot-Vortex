
console.log("🔥 VORTEX LOCAL ATIVO 🔥");
const { Client, GatewayIntentBits, Collection, Events, REST, Routes } = require('discord.js');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const fs = require('fs');
const path = require('path');
const config = require('./config/config');
const { logger } = require('./utils/logger');
const { setDiscordClient } = require('./utils/dashboardClient');
const { notifyError, notifyBotDown, sendVortexLog } = require('./utils/notifications');
const { initStatusPanel } = require('./utils/pontoPanel');
const { initAbsenceManager } = require('./utils/ausenciaManager');
const { initProfileManager } = require('./utils/profileManager');
const { initDailyPointTranscript } = require('./utils/dailyPointTranscript');

const app = express();
const API_PORT = Number(process.env.API_PORT || 3000);
const API_HOST = process.env.API_HOST || '0.0.0.0';

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildPresences
    ]
});

client.commands = new Collection();
setDiscordClient(client);

app.get('/health', (req, res) => {
    res.json({ ok: true, service: 'vortex-bot' });
});

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

// Registro de Comandos (Blindagem Anti-404)
const registerCommands = async () => {
    const commandsData = client.commands.map(cmd => cmd.data.toJSON());
    if (!config.token || !config.clientId) return console.error('[VORTEX] Token ou ClientID ausentes.');

    const rest = new REST({ version: '10' }).setToken(config.token);

    try {
        let guildId = config.guildId;
        
        // Limpeza de Guild ID (Remove links de convite e caracteres não numéricos)
        if (guildId && (guildId.includes('discord.gg') || !/^\d+$/.test(guildId))) {
            const match = guildId.match(/\d+/);
            guildId = match ? match[0] : null;
        }

        console.log('[VORTEX] Iniciando registro de comandos...');
        
        if (guildId && /^\d+$/.test(guildId)) {
            try {
                await rest.put(Routes.applicationGuildCommands(config.clientId, guildId), { body: commandsData });
                console.log(`[VORTEX] Comandos registrados no servidor: ${guildId}`);
            } catch (err) {
                console.warn(`[VORTEX] Falha no servidor ${guildId}. Tentando registro global...`);
                await rest.put(Routes.applicationCommands(config.clientId), { body: commandsData });
                console.log('[VORTEX] Comandos registrados globalmente (fallback).');
            }
        } else {
            await rest.put(Routes.applicationCommands(config.clientId), { body: commandsData });
            console.log('[VORTEX] Comandos registrados globalmente.');
        }
    } catch (error) { 
        console.error('[VORTEX] Erro fatal no registro:', error.message);
        // Não envia notifyError aqui para evitar loop se o erro for no registro
    }
};

client.once(Events.ClientReady, async () => {
    console.log(`Vortex Online: ${client.user.tag}`);
    await registerCommands();
    initStatusPanel(client);
    initAbsenceManager(client);
    initProfileManager(client);
    initDailyPointTranscript(client);
    
    await sendVortexLog(client, {
        title: 'Bot Inicializado',
        description: `O sistema **Vortex Management System** foi iniciado com sucesso.\n\n**Usuário:** ${client.user.tag}\n**Servidores:** ${client.guilds.cache.size}`,
        color: '#57F287',
        type: 'SISTEMA'
    });
});

// Blindagem contra Crashes
process.on('unhandledRejection', (reason) => {
    console.error('[VORTEX CRITICAL] Rejeição não tratada:', reason);
    notifyError(client, reason, 'Unhandled Rejection');
    notifyBotDown(client, reason, 'Unhandled Rejection');
});

process.on('uncaughtException', (error) => {
    console.error('[VORTEX CRITICAL] Exceção não capturada:', error.message);
    notifyError(client, error, 'Uncaught Exception');
    notifyBotDown(client, error, 'Uncaught Exception');
});

process.on('SIGINT', () => {
    notifyBotDown(client, 'Processo encerrado por SIGINT', 'Encerramento manual').finally(() => {
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    notifyBotDown(client, 'Processo encerrado por SIGTERM', 'Encerramento do processo').finally(() => {
        process.exit(0);
    });
});

client.on('shardDisconnect', (event, shardId) => {
    const reason = `Shard ${shardId} desconectada. Codigo: ${event?.code || 'N/A'} | Motivo: ${event?.reason || 'N/A'}`;
    console.error('[VORTEX CRITICAL]', reason);
    notifyBotDown(client, reason, 'Shard Disconnect');
});

client.login(config.token).catch(err => {
    console.error('[VORTEX] Falha no Login:', err.message);
    notifyBotDown(client, err, 'Falha no Login');
});
app.listen(API_PORT, API_HOST, () => console.log(`API Vortex Online: ${API_PORT}`));
   module.exports = { client };
