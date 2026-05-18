
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
const { notifyError, notifyBotDown, sendVortexLog, initChannelLogRecovery } = require('./utils/notifications');
const { setupErrorHandlers } = require('./src/events/errorHandler');
const { initStatusPanel } = require('./utils/pontoPanel');
const { initAbsenceManager } = require('./utils/ausenciaManager');
const { initProfileManager } = require('./utils/profileManager');
const { initDailyPointTranscript } = require('./utils/dailyPointTranscript');
const { initPointAutomation } = require('./utils/pointAutomation');
const { scanCurrentFiveMActivities } = require('./utils/fivemActivityAlertManager');
const { buildPointSiteHtml, buildPointSitePayload } = require('./utils/pointSite');
const {
    getPointTranscriptRecord,
    validateTranscriptAccess,
    registerTranscriptAccess,
    buildTranscriptShell,
} = require('./utils/pointTranscriptStore');

const app = express();
const API_PORT = Number(process.env.API_PORT || process.env.PORT || 3000);
const API_HOST = process.env.API_HOST || '0.0.0.0';

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use('/assets', express.static(path.join(__dirname, 'foto')));
app.use('/vendor/fontawesome', express.static(path.join(__dirname, 'node_modules', '@fortawesome', 'fontawesome-free')));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.MessageContent
    ]
});

client.commands = new Collection();
setDiscordClient(client);
setupErrorHandlers(client, { notifyError, notifyBotDown });

app.get('/health', (req, res) => {
    res.json({ ok: true, service: 'vortex-bot' });
});

app.get('/api/site/status', (req, res) => {
    res.json({
        ok: true,
        service: 'vortex-site',
        bot: client.user ? {
            id: client.user.id,
            tag: client.user.tag,
        } : null,
        guilds: client.guilds?.cache?.size || 0,
        uptimeSeconds: Math.floor(process.uptime()),
    });
});

function getPointSiteGuildId(req) {
    const requestedGuildId = String(req.query.guildId || '').trim();
    if (/^\d{15,25}$/.test(requestedGuildId)) return requestedGuildId;
    if (/^\d{15,25}$/.test(config.guildId || '')) return String(config.guildId);
    return client.guilds.cache.first()?.id || null;
}

function isPointSiteAuthorized(req) {
    const configuredToken = String(process.env.POINT_SITE_TOKEN || '').trim();
    if (!configuredToken) return true;
    const receivedToken = String(req.query.token || req.headers['x-point-site-token'] || '').trim();
    return receivedToken && receivedToken === configuredToken;
}

function buildPointApiPath(req, userId) {
    const params = new URLSearchParams();
    const guildId = String(req.query.guildId || '').trim();
    const token = String(req.query.token || '').trim();
    if (guildId) params.set('guildId', guildId);
    if (token) params.set('token', token);
    const query = params.toString();
    return `/api/ponto/${userId}${query ? `?${query}` : ''}`;
}

app.get(['/api/ponto/:id', '/api/relatorio/ponto/:id'], async (req, res) => {
    if (!isPointSiteAuthorized(req)) {
        return res.status(401).json({ ok: false, error: 'Acesso nao autorizado.' });
    }

    const userId = String(req.params.id || '').trim();
    if (!/^\d{15,25}$/.test(userId)) {
        return res.status(400).json({ ok: false, error: 'ID de usuario invalido.' });
    }

    const guildId = getPointSiteGuildId(req);
    if (!guildId) {
        return res.status(404).json({ ok: false, error: 'Servidor nao encontrado.' });
    }

    const payload = await buildPointSitePayload({ client, guildId, userId }).catch((error) => {
        logger.error('Erro ao carregar folha de ponto do site:', error);
        return null;
    });

    if (!payload) return res.status(500).json({ ok: false, error: 'Erro ao carregar folha de ponto.' });
    return res.json(payload);
});

app.get(['/ponto/:id', '/relatorio/ponto/:id'], (req, res) => {
    if (!isPointSiteAuthorized(req)) {
        return res.status(401).type('html').send('<!doctype html><meta charset="utf-8"><title>Acesso negado</title><body>Acesso nao autorizado.</body>');
    }

    const userId = String(req.params.id || '').trim();
    if (!/^\d{15,25}$/.test(userId)) {
        return res.status(400).type('html').send('<!doctype html><meta charset="utf-8"><title>ID invalido</title><body>ID de usuario invalido.</body>');
    }

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
        'Content-Security-Policy',
        [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' https: data:",
            "connect-src 'self'",
            "base-uri 'self'",
            "frame-ancestors 'none'",
        ].join('; ')
    );
    return res.type('html').send(buildPointSiteHtml({ userId, apiPath: buildPointApiPath(req, userId) }));
});

app.get(['/transcripts/:id', '/vortex/transcript/ponto/:id'], (req, res) => {
    const transcriptId = String(req.params.id || '').trim();
    const record = getPointTranscriptRecord(transcriptId);
    const token = req.path.startsWith('/transcripts/')
        ? record?.token
        : String(req.query.token || '').trim();
    const access = validateTranscriptAccess(record, token);
    if (!access.ok) {
        return res.status(access.status).type('html').send(`<!doctype html><meta charset="utf-8"><title>Transcript Vortex</title><body>${access.message}</body>`);
    }

    registerTranscriptAccess(transcriptId, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
    });
    logger.info(`Transcript de ponto acessado: ${transcriptId}`);

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
        'Content-Security-Policy',
        [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' https: data:",
            "connect-src 'self'",
            "base-uri 'self'",
            "frame-ancestors 'none'",
        ].join('; ')
    );
    return res.type('html').send(buildTranscriptShell(record));
});

app.get(['/', '/termos', '/privacidade'], (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'vortex-site.html'));
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
        let registeredGuildCommands = false;
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
                registeredGuildCommands = true;
            } catch (err) {
                console.warn(`[VORTEX] Falha no servidor ${guildId}. Tentando registro global...`);
                await rest.put(Routes.applicationCommands(config.clientId), { body: commandsData });
                console.log('[VORTEX] Comandos registrados globalmente (fallback).');
            }
        } else {
            await rest.put(Routes.applicationCommands(config.clientId), { body: commandsData });
            console.log('[VORTEX] Comandos registrados globalmente.');
        }
        if (registeredGuildCommands) {
            const exibirCommand = client.commands.get('exibir');
            if (exibirCommand) {
                await rest.put(Routes.applicationCommands(config.clientId), { body: [exibirCommand.data.toJSON()] });
                console.log('[VORTEX] Comando /exibir registrado globalmente.');
            }
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
    initChannelLogRecovery(client);
    scanCurrentFiveMActivities(client).catch((error) => logger.error('Erro ao verificar atividades FiveM no startup:', error));
    
    await sendVortexLog(client, {
        title: 'Bot Inicializado',
        description: `O sistema **Vortex Management System** foi iniciado com sucesso.\n\n**Usuário:** ${client.user.tag}\n**Servidores:** ${client.guilds.cache.size}`,
        color: '#57F287',
        type: 'SISTEMA'
    });
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
