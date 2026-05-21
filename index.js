
console.log("🔥 VORTEX LOCAL ATIVO 🔥");
const { Client, GatewayIntentBits, Collection, Events, REST, Routes } = require('discord.js');
const { DefaultWebSocketManagerOptions } = require('@discordjs/ws');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const fs = require('fs');
const path = require('path');
const {
    installMongoJsonStoreBridge,
    initializeMongoJsonStore,
    flushMongoJsonStore,
    getMongoJsonStoreStatus,
} = require('./utils/mongoJsonStore');
installMongoJsonStoreBridge();
const config = require('./config/config');
const { logger } = require('./utils/logger');
const { connectDatabase, disconnectDatabase, getDatabaseStatus, isMongoRequired } = require('./utils/database');
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
    normalizeTranscriptId,
} = require('./utils/pointTranscriptStore');

const app = express();
const API_PORT = Number(process.env.API_PORT || process.env.PORT || 3000);
const API_HOST = process.env.API_HOST || '0.0.0.0';
const DISCORD_HANDSHAKE_TIMEOUT_MS = Number(process.env.DISCORD_HANDSHAKE_TIMEOUT_MS || 120_000);
const REGISTER_COMMANDS_ON_STARTUP = process.env.REGISTER_COMMANDS_ON_STARTUP !== 'false';
const FIVEM_STARTUP_SCAN_ENABLED = process.env.FIVEM_STARTUP_SCAN_ENABLED === 'true';
const ENABLE_PRESENCE_FEATURES = process.env.ENABLE_PRESENCE_FEATURES !== 'false';

if (Number.isFinite(DISCORD_HANDSHAKE_TIMEOUT_MS) && DISCORD_HANDSHAKE_TIMEOUT_MS > 0) {
    DefaultWebSocketManagerOptions.handshakeTimeout = DISCORD_HANDSHAKE_TIMEOUT_MS;
}

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use('/assets', express.static(path.join(__dirname, 'foto')));
app.use('/vendor/fontawesome', express.static(path.join(__dirname, 'node_modules', '@fortawesome', 'fontawesome-free')));

const clientIntents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.MessageContent
];

if (ENABLE_PRESENCE_FEATURES) {
    clientIntents.push(GatewayIntentBits.GuildPresences);
}

const client = new Client({ intents: clientIntents });

client.commands = new Collection();
setDiscordClient(client);
setupErrorHandlers(client, { notifyError, notifyBotDown });

app.get(['/api/database/status', '/api/db/status'], (req, res) => {
    const status = getDatabaseStatus();
    res.status(status.required && !status.connected ? 503 : 200).json({
        ok: status.connected,
        service: 'vortex-database',
        mongo: status,
        jsonStore: getMongoJsonStoreStatus(),
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
    const month = String(req.query.month || '').trim();
    const week = String(req.query.week || '').trim();
    if (guildId) params.set('guildId', guildId);
    if (token) params.set('token', token);
    if (month) params.set('month', month);
    if (week) params.set('week', week);
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

    const payload = await buildPointSitePayload({
        client,
        guildId,
        userId,
        month: req.query.month,
        week: req.query.week,
    }).catch((error) => {
        logger.error('Erro ao carregar folha de ponto do site:', error);
        return null;
    });

    if (!payload) return res.status(500).json({ ok: false, error: 'Erro ao carregar folha de ponto.' });
    return res.json(payload);
});

function isTranscriptId(value) {
    return /^vtx-[a-z0-9-]+$/i.test(normalizeTranscriptId(value));
}

function sendTranscriptPage(req, res, transcriptId) {
    const normalizedId = normalizeTranscriptId(transcriptId);
    const record = getPointTranscriptRecord(normalizedId);
    const requiresQueryToken = req.path.startsWith('/vortex/transcript/');
    const token = requiresQueryToken ? String(req.query.token || '').trim() : record?.token;
    const access = validateTranscriptAccess(record, token);
    if (!access.ok) {
        return res.status(access.status).type('html').send(`<!doctype html><meta charset="utf-8"><title>Transcript Vortex</title><body>${access.message}</body>`);
    }

    registerTranscriptAccess(normalizedId, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
    });
    logger.info(`Transcript Vortex acessado: ${normalizedId} (${record.kind || 'point-report'})`);

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
}

app.get(['/ponto/:id', '/relatorio/ponto/:id'], (req, res) => {
    const requestedId = String(req.params.id || '').trim();
    if (isTranscriptId(requestedId)) {
        return sendTranscriptPage(req, res, requestedId);
    }

    if (!isPointSiteAuthorized(req)) {
        return res.status(401).type('html').send('<!doctype html><meta charset="utf-8"><title>Acesso negado</title><body>Acesso nao autorizado.</body>');
    }

    const userId = requestedId;
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

app.get('/vortex/transcript/ponto/:id', (req, res) => {
    return sendTranscriptPage(req, res, req.params.id);
});

app.get('/relatorio/:id', (req, res) => {
    return sendTranscriptPage(req, res, req.params.id);
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
            const runEvent = (...args) => {
                Promise.resolve(event.execute(...args)).catch((error) => {
                    logger.error(`Erro nao tratado no evento ${event.name || file}:`, error);
                    notifyError(client, error, `Evento ${event.name || file}`).catch(() => null);
                });
            };
            if (event.once) client.once(event.name, runEvent);
            else client.on(event.name, runEvent);
        } catch (error) { console.error(`Erro evento ${file}:`, error.message); }
    }
}

// Registro de Comandos (Blindagem Anti-404)
const registerCommands = async () => {
    const commandsData = client.commands.map(cmd => cmd.data.toJSON());
    if (!config.token || !config.clientId) return console.error('[VORTEX] Token ou ClientID ausentes.');

    const rest = new REST({ version: '10' }).setToken(config.token);
    const exibirCommand = client.commands.get('exibir');
    const exibirCommandsData = exibirCommand ? [exibirCommand.data.toJSON()] : [];

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
            if (exibirCommand) {
                await rest.put(Routes.applicationCommands(config.clientId), { body: exibirCommandsData });
                console.log('[VORTEX] Comando /exibir registrado globalmente.');

                for (const guild of client.guilds.cache.values()) {
                    if (String(guild.id) === String(guildId)) continue;
                    await rest.put(Routes.applicationGuildCommands(config.clientId, guild.id), { body: exibirCommandsData });
                    console.log(`[VORTEX] Comando /exibir registrado no servidor externo: ${guild.name} (${guild.id}).`);
                }
            }
        }
    } catch (error) { 
        console.error('[VORTEX] Erro fatal no registro:', error.message);
        // Não envia notifyError aqui para evitar loop se o erro for no registro
    }
};

client.on(Events.GuildCreate, async (guild) => {
    try {
        const primaryGuildId = String(config.guildId || '');
        if (String(guild.id) === primaryGuildId) return;

        const exibirCommand = client.commands.get('exibir');
        if (!exibirCommand) return;

        const rest = new REST({ version: '10' }).setToken(config.token);
        await rest.put(Routes.applicationGuildCommands(config.clientId, guild.id), {
            body: [exibirCommand.data.toJSON()],
        });
        console.log(`[VORTEX] /exibir liberado no novo servidor: ${guild.name} (${guild.id}).`);
    } catch (error) {
        logger.error('Erro ao registrar /exibir em novo servidor:', error);
    }
});

client.once(Events.ClientReady, async () => {
    console.log(`Vortex Online: ${client.user.tag}`);
    if (REGISTER_COMMANDS_ON_STARTUP) {
        await registerCommands();
    } else {
        console.log('[VORTEX] Registro de comandos no startup desativado.');
    }
    initStatusPanel(client);
    initAbsenceManager(client);
    initProfileManager(client);
    initDailyPointTranscript(client);
    initPointAutomation(client);
    initChannelLogRecovery(client);
    if (FIVEM_STARTUP_SCAN_ENABLED) {
        scanCurrentFiveMActivities(client).catch((error) => logger.error('Erro ao verificar atividades FiveM no startup:', error));
    } else {
        logger.info('Scan inicial FiveM desativado para reduzir uso de CPU/RAM no startup.');
    }
    
    await sendVortexLog(client, {
        title: 'Bot Inicializado',
        description: `O sistema **Vortex Management System** foi iniciado com sucesso.\n\n**Usuário:** ${client.user.tag}\n**Servidores:** ${client.guilds.cache.size}`,
        color: '#57F287',
        type: 'SISTEMA'
    });
});

async function shutdown(reason, type) {
    await notifyBotDown(client, reason, type).catch(() => null);
    await flushMongoJsonStore().catch((error) => logger.error('Erro ao sincronizar JSON Store no encerramento:', error));
    await disconnectDatabase().catch(() => null);
    process.exit(0);
}

process.on('SIGINT', () => {
    shutdown('Processo encerrado por SIGINT', 'Encerramento manual');
});

process.on('SIGTERM', () => {
    shutdown('Processo encerrado por SIGTERM', 'Encerramento do processo');
});

client.on('shardDisconnect', (event, shardId) => {
    const reason = `Shard ${shardId} desconectada. Codigo: ${event?.code || 'N/A'} | Motivo: ${event?.reason || 'N/A'}`;
    console.error('[VORTEX CRITICAL]', reason);
    notifyBotDown(client, reason, 'Shard Disconnect');
});

client.on('shardError', (error, shardId) => {
    logger.warn(`Erro temporario no gateway Discord da shard ${shardId}: ${error?.message || error}`);
});

client.on('shardReconnecting', (shardId) => {
    logger.warn(`Reconectando shard ${shardId} ao gateway Discord...`);
});

async function start() {
    const connected = await connectDatabase();
    if (!connected && isMongoRequired()) {
        throw new Error('MongoDB obrigatorio, mas a conexao falhou. Verifique MONGODB_URI/MONGO_URI e acesso de rede.');
    }
    if (connected) await initializeMongoJsonStore();

    await client.login(config.token).catch(err => {
        console.error('[VORTEX] Falha no Login:', err.message);
        notifyBotDown(client, err, 'Falha no Login');
        throw err;
    });

    app.listen(API_PORT, API_HOST, () => console.log(`API Vortex Online: ${API_PORT}`));
}

start().catch((error) => {
    logger.error('Erro fatal ao iniciar Vortex:', error);
    process.exit(1);
});

module.exports = { client };
