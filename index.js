
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
const { initPointAutomation } = require('./utils/pointAutomation');
const { acceptLiveTermsToken, initTwitchLiveMonitor, parseLiveTermsToken } = require('./utils/liveAlertManager');

const app = express();
const API_PORT = Number(process.env.API_PORT || 3000);
const API_HOST = process.env.API_HOST || '0.0.0.0';

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use('/assets', express.static(path.join(__dirname, 'foto')));

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

app.get(['/twitch', '/live/termos'], (req, res) => {
    const token = String(req.query.token || '');
    if (!parseLiveTermsToken(token)) {
        return res.status(400).send('Link de aceite invalido ou expirado. Abra o /live novamente no Discord.');
    }

    const htmlPath = path.join(__dirname, 'public', 'twitch-terms.html');
    const html = fs.readFileSync(htmlPath, 'utf8')
        .replaceAll('__ACCEPT_URL__', `/twitch/webhook?token=${encodeURIComponent(token)}`);
    return res.type('html').send(html);
});

app.get('/twitch/webhook', (req, res) => {
    const accepted = acceptLiveTermsToken(req.query.token);
    if (!accepted) {
        return res.status(400).send('Link de aceite invalido ou expirado. Abra o /live novamente no Discord.');
    }

    return res.type('html').send([
        '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        '<title>Vortex | Termos aceitos</title>',
        '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#09090d;color:#f5f7fb;font-family:Arial,Helvetica,sans-serif}.box{max-width:520px;border:1px solid #262637;border-radius:8px;background:#14141c;padding:28px}h1{margin:0 0 12px;font-size:28px}p{color:#a9afc3;line-height:1.5}</style>',
        '</head><body><main class="box">',
        '<h1>Termos aceitos</h1>',
        '<p>Seu acesso para cadastrar links de live foi liberado. Volte ao Discord, use /live e clique em Adicionar link.</p>',
        '</main></body></html>',
    ].join(''));
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
    initPointAutomation(client);
    initTwitchLiveMonitor(client);
    
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
