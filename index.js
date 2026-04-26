const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const config = require('./config/config');
const { handleVoiceStateUpdate } = require('./config/callManager');
const { logger } = require('./utils/logger');
const { setDiscordClient } = require('./utils/dashboardClient');
const { notifyError, sendUpdateLog } = require('./utils/notifications');
const { startScheduler } = require('./utils/scheduler');

const app = express();
const API_PORT = Number(process.env.API_PORT || 3000);
const API_HOST = process.env.API_HOST || '0.0.0.0';
const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN || process.env.ADMIN_TOKEN || '';
const processStartTime = Date.now();

// Segurança e middlewares da API
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({
    origin: process.env.API_CORS_ORIGIN || '*'
}));
app.use(express.json({ limit: '1mb' }));

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.API_RATE_LIMIT_MAX || 200),
    standardHeaders: true,
    legacyHeaders: false
});
app.use('/api', apiLimiter);

function requireAdminToken(req, res, next) {
    if (!ADMIN_TOKEN) {
        return res.status(503).json({
            ok: false,
            error: 'ADMIN_API_TOKEN não configurado no ambiente'
        });
    }

    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

    if (!token || token !== ADMIN_TOKEN) {
        return res.status(401).json({
            ok: false,
            error: 'Token administrativo inválido'
        });
    }

    next();
}

function getUptimeMs() {
    return Date.now() - processStartTime;
}

function safeGuildsSummary(clientInstance) {
    return clientInstance.guilds.cache.map(g => ({
        id: g.id,
        name: g.name,
        memberCount: g.memberCount ?? null
    }));
}

// Initialize Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages
    ]
});

client.commands = new Collection();
setDiscordClient(client);

// Load Commands
const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.existsSync(foldersPath) ? fs.readdirSync(foldersPath) : [];

let commandCount = 0;
for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    if (!fs.statSync(commandsPath).isDirectory()) continue;

    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        try {
            const command = require(filePath);
            if ('data' in command && 'execute' in command) {
                client.commands.set(command.data.name, command);
                commandCount++;
            }
        } catch (error) {
            logger.warn(`Erro ao carregar comando: ${file}`, { error: error.message });
        }
    }
}
logger.info(`${commandCount} comandos carregados com sucesso`);

// Load Events
const eventsPath = path.join(__dirname, 'events');
if (fs.existsSync(eventsPath)) {
    const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
    let eventCount = 0;
    for (const file of eventFiles) {
        const filePath = path.join(eventsPath, file);
        try {
            const event = require(filePath);
            if (event.once) {
                client.once(event.name, (...args) => event.execute(...args));
            } else {
                client.on(event.name, (...args) => event.execute(...args));
            }
            eventCount++;
        } catch (error) {
            logger.warn(`Erro ao carregar evento: ${file}`, { error: error.message });
        }
    }
    logger.info(`${eventCount} eventos carregados com sucesso`);
}

// Register Slash Commands
const registerCommands = async () => {
    const commandsData = client.commands.map(cmd => cmd.data.toJSON());
    const rest = new REST({ version: '10' }).setToken(config.token);

    try {
        logger.info(`Registrando ${commandsData.length} slash commands...`);
        if (config.guildId) {
            await rest.put(
                Routes.applicationGuildCommands(config.clientId, config.guildId),
                { body: commandsData }
            );
        }
        await rest.put(
            Routes.applicationCommands(config.clientId),
            { body: commandsData }
        );
        logger.info('Comandos registrados com sucesso!');
    } catch (error) {
        logger.error('Erro ao registrar comandos', error);
        notifyError(client, error, 'Registro de Comandos');
    }
};

client.once('ready', async () => {
    logger.info(`Bot conectado como ${client.user.tag}`);
    await registerCommands();
    // Inicia o agendador de mensagens automáticas (bom dia)
    startScheduler(client);
    logger.info('Agendador de mensagens automáticas iniciado.');
});

client.on('voiceStateUpdate', (oldState, newState) => {
    try {
        handleVoiceStateUpdate(oldState, newState, client);
    } catch (error) {
        logger.error('Erro ao processar voice state update', error);
        notifyError(client, error, 'Voice State Update');
    }
});

// Rotas da API
app.get('/health', (req, res) => {
    return res.status(200).json({
        ok: true,
        service: 'magnatas-bot-api',
        uptimeMs: getUptimeMs(),
        timestamp: new Date().toISOString()
    });
});

app.get('/api/status', (req, res) => {
    return res.status(200).json({
        ok: true,
        bot: {
            isReady: client.isReady(),
            user: client.user ? {
                id: client.user.id,
                tag: client.user.tag
            } : null
        },
        commandsLoaded: client.commands.size,
        guildsCount: client.guilds.cache.size,
        uptimeMs: getUptimeMs(),
        timestamp: new Date().toISOString()
    });
});

app.get('/api/guilds', requireAdminToken, (req, res) => {
    return res.status(200).json({
        ok: true,
        total: client.guilds.cache.size,
        guilds: safeGuildsSummary(client)
    });
});

app.post('/api/admin/register-commands', requireAdminToken, async (req, res) => {
    try {
        await registerCommands();
        return res.status(200).json({
            ok: true,
            message: 'Comandos registrados com sucesso'
        });
    } catch (error) {
        logger.error('Falha no endpoint de registro de comandos', error);
        return res.status(500).json({
            ok: false,
            error: 'Falha ao registrar comandos'
        });
    }
});

// Handler de erros da API
app.use((err, req, res, next) => {
    logger.error('Erro interno na API', err, {
        path: req.path,
        method: req.method
    });
    return res.status(500).json({
        ok: false,
        error: 'Erro interno da API'
    });
});

// Login bot + subida da API
client.login(config.token).catch(err => {
    logger.critical('Erro ao logar o bot', err);
    // Nota: Aqui o bot ainda não está logado, então notifyError pode falhar se depender do client pronto
    process.exit(1);
});

app.listen(API_PORT, API_HOST, () => {
    logger.info(`API online em http://${API_HOST}:${API_PORT}`);
});

// Tratamento de erros não capturados
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Promise rejeitada não tratada', new Error(String(reason)));
    if (client.isReady()) notifyError(client, reason, 'Unhandled Rejection');
});

process.on('uncaughtException', (error) => {
    logger.critical('Exceção não capturada', error);
    if (client.isReady()) {
        notifyError(client, error, 'Uncaught Exception').then(() => {
            process.exit(1);
        }).catch(() => process.exit(1));
    } else {
        process.exit(1);
    }
});

process.on('SIGINT', async () => {
    if (client.isReady()) {
        await sendUpdateLog(client, 'Bot Desligado', 'O bot foi encerrado via sinal SIGINT (Manual).', '#ED4245');
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    if (client.isReady()) {
        await sendUpdateLog(client, 'Bot Desligado', 'O bot foi encerrado via sinal SIGTERM (Sistema).', '#ED4245');
    }
    process.exit(0);
});

module.exports = { client, app };
