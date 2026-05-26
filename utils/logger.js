/**
 * Sistema de Logging para Bot Vortex
 * Fornece logging estruturado com diferentes níveis
 */

const fs = require('fs');
const path = require('path');
const { safeError, safeLog, safeWarn } = require('./safeConsole');

/**
 * Níveis de log
 */
const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    CRITICAL: 4
};

/**
 * Cores para console (ANSI)
 */
const COLORS = {
    RESET: '\x1b[0m',
    RED: '\x1b[31m',
    GREEN: '\x1b[32m',
    YELLOW: '\x1b[33m',
    BLUE: '\x1b[34m',
    MAGENTA: '\x1b[35m',
    CYAN: '\x1b[36m',
    GRAY: '\x1b[90m'
};

class Logger {
    constructor(options = {}) {
        this.minLevel = options.minLevel || LOG_LEVELS.INFO;
        this.logDir = options.logDir || path.join(__dirname, '../logs');
        this.maxLogSize = options.maxLogSize || 10 * 1024 * 1024; // 10MB
        this.enableConsole = options.enableConsole !== false;
        this.enableFile = options.enableFile !== false;
        this.enableTimestamp = options.enableTimestamp !== false;

        // Criar diretório de logs se não existir
        if (this.enableFile && !fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }

        this.logFiles = {
            debug: path.join(this.logDir, 'debug.log'),
            info: path.join(this.logDir, 'info.log'),
            warn: path.join(this.logDir, 'warn.log'),
            error: path.join(this.logDir, 'error.log'),
            all: path.join(this.logDir, 'all.log')
        };
    }

    isLockedFileError(error) {
        return ['EBUSY', 'EPERM', 'EACCES'].includes(error?.code);
    }

    retryWriteToFile(file, message, attempt = 1) {
        const maxAttempts = 5;
        const delay = Math.min(100 * attempt, 1000);

        const timer = setTimeout(() => {
            try {
                fs.appendFileSync(file, message + '\n', 'utf8');
            } catch (error) {
                if (this.isLockedFileError(error) && attempt < maxAttempts) {
                    this.retryWriteToFile(file, message, attempt + 1);
                    return;
                }

                safeError('Erro ao escrever log em arquivo apos tentativas:', error.message || error);
            }
        }, delay);

        if (typeof timer.unref === 'function') timer.unref();
    }

    /**
     * Formata timestamp
     * @returns {string}
     */
    getTimestamp() {
        if (!this.enableTimestamp) return '';
        return new Date().toISOString();
    }

    /**
     * Formata mensagem de log
     * @param {string} level - Nível de log
     * @param {string} message - Mensagem
     * @param {object} meta - Metadados adicionais
     * @returns {string}
     */
    formatMessage(level, message, meta = {}) {
        const timestamp = this.getTimestamp();
        const metaStr = Object.keys(meta).length > 0 
            ? ` | ${JSON.stringify(meta)}`
            : '';
        
        return `[${timestamp}] [${level}] ${message}${metaStr}`;
    }

    /**
     * Formata mensagem para console com cores
     * @param {string} level - Nível de log
     * @param {string} message - Mensagem
     * @param {string} color - Cor ANSI
     * @returns {string}
     */
    formatConsoleMessage(level, message, color) {
        const timestamp = this.getTimestamp();
        const levelStr = `${color}[${level}]${COLORS.RESET}`;
        const timeStr = timestamp ? `${COLORS.GRAY}[${timestamp}]${COLORS.RESET}` : '';
        
        return `${timeStr} ${levelStr} ${message}`;
    }

    /**
     * Escreve log em arquivo
     */
    writeToFile(file, message) {
        try {
            if (fs.existsSync(file)) {
                const stats = fs.statSync(file);
                if (stats.size > this.maxLogSize) {
                    const backup = `${file}.${Date.now()}.backup`;
                    fs.renameSync(file, backup);
                }
            }

            fs.appendFileSync(file, message + '\n', 'utf8');
        } catch (error) {
            if (this.isLockedFileError(error)) {
                this.retryWriteToFile(file, message);
                return;
            }

            safeError('Erro ao escrever log em arquivo:', error);
        }
    }

    debug(message, meta = {}) {
        if (this.minLevel > LOG_LEVELS.DEBUG) return;
        const formatted = this.formatMessage('DEBUG', message, meta);
        if (this.enableConsole) safeLog(this.formatConsoleMessage('DEBUG', message, COLORS.CYAN));
        if (this.enableFile) {
            this.writeToFile(this.logFiles.debug, formatted);
            this.writeToFile(this.logFiles.all, formatted);
        }
    }

    info(message, meta = {}) {
        if (this.minLevel > LOG_LEVELS.INFO) return;
        const formatted = this.formatMessage('INFO', message, meta);
        if (this.enableConsole) safeLog(this.formatConsoleMessage('INFO', message, COLORS.GREEN));
        if (this.enableFile) {
            this.writeToFile(this.logFiles.info, formatted);
            this.writeToFile(this.logFiles.all, formatted);
        }
    }

    warn(message, meta = {}) {
        if (this.minLevel > LOG_LEVELS.WARN) return;
        const formatted = this.formatMessage('WARN', message, meta);
        if (this.enableConsole) safeWarn(this.formatConsoleMessage('WARN', message, COLORS.YELLOW));
        if (this.enableFile) {
            this.writeToFile(this.logFiles.warn, formatted);
            this.writeToFile(this.logFiles.all, formatted);
        }
    }

    error(message, error = null, meta = {}) {
        if (this.minLevel > LOG_LEVELS.ERROR) return;
        const errorStack = error ? error.stack : '';
        const errorMsg = error ? error.message : '';
        const fullMeta = { ...meta, error: errorMsg };
        const formatted = this.formatMessage('ERROR', message, fullMeta);
        const fullFormatted = errorStack ? `${formatted}\n${errorStack}` : formatted;
        
        if (this.enableConsole) {
            safeError(this.formatConsoleMessage('ERROR', message, COLORS.RED));
            if (error) safeError(error);
        }
        
        if (this.enableFile) {
            this.writeToFile(this.logFiles.error, fullFormatted);
            this.writeToFile(this.logFiles.all, fullFormatted);
        }
    }

    critical(message, error = null, meta = {}) {
        if (this.minLevel > LOG_LEVELS.CRITICAL) return;
        const errorStack = error ? error.stack : '';
        const errorMsg = error ? error.message : '';
        const fullMeta = { ...meta, error: errorMsg, severity: 'CRITICAL' };
        const formatted = this.formatMessage('CRITICAL', message, fullMeta);
        const fullFormatted = errorStack ? `${formatted}\n${errorStack}` : formatted;
        
        if (this.enableConsole) {
            safeError(this.formatConsoleMessage('CRITICAL', message, COLORS.MAGENTA));
            if (error) safeError(error);
        }
        
        if (this.enableFile) {
            this.writeToFile(this.logFiles.error, fullFormatted);
            this.writeToFile(this.logFiles.all, fullFormatted);
        }

        // Envia alerta (poderia integrar com Discord, email, etc)
        this.sendAlert(message, error, meta);
    }

    /**
     * Envia alerta (integração com notificações do Discord)
     */
    sendAlert(message, error, meta) {
        safeLog('ALERTA CRITICO VORTEX:', message);
        // Tenta enviar para o Discord se as notificações estiverem disponíveis
        try {
            const { notifyError } = require('./notifications');
            const { client } = require('../index');
            if (client && client.isReady()) {
                notifyError(client, error || message, `Alerta Crítico: ${message}`).catch(() => {});
            }
        } catch (err) {
            // Silencia erros para evitar loops
        }
    }

    performance(operation, duration, meta = {}) {
        const level = duration > 1000 ? 'WARN' : 'DEBUG';
        const emoji = duration > 1000 ? '⚠️' : '⏱️';
        const message = `${emoji} ${operation} levou ${duration}ms`;
        const fullMeta = { ...meta, duration };
        if (level === 'WARN') this.warn(message, fullMeta);
        else this.debug(message, fullMeta);
    }

    interaction(type, userId, guildId, meta = {}) {
        this.debug(`Interação: ${type}`, { type, userId, guildId, ...meta });
    }

    command(commandName, userId, guildId, meta = {}) {
        this.info(`Comando executado: ${commandName}`, { command: commandName, userId, guildId, ...meta });
    }

    commandError(commandName, error, meta = {}) {
        this.error(`Erro no comando: ${commandName}`, error, { command: commandName, ...meta });
    }

    cleanOldLogs(daysOld = 7) {
        try {
            const now = Date.now();
            const maxAge = daysOld * 24 * 60 * 60 * 1000;

            const files = fs.readdirSync(this.logDir);
            files.forEach(file => {
                const filePath = path.join(this.logDir, file);
                const stats = fs.statSync(filePath);
                
                if (now - stats.mtimeMs > maxAge) {
                    fs.unlinkSync(filePath);
                    this.info(`Log antigo removido: ${file}`);
                }
            });
        } catch (error) {
            this.error('Erro ao limpar logs antigos', error);
        }
    }

    getStats() {
        const stats = {};
        try {
            Object.entries(this.logFiles).forEach(([key, file]) => {
                if (fs.existsSync(file)) {
                    const fileStats = fs.statSync(file);
                    stats[key] = {
                        size: fileStats.size,
                        sizeKB: (fileStats.size / 1024).toFixed(2),
                        modified: fileStats.mtime
                    };
                }
            });
        } catch (error) {
            this.error('Erro ao obter estatísticas de logs', error);
        }

        return stats;
    }
}

// Exporta instância padrão
const logger = new Logger({
    minLevel: LOG_LEVELS.INFO,
    enableConsole: true,
    enableFile: true,
    enableTimestamp: true
});

module.exports = {
    Logger,
    logger,
    LOG_LEVELS
};
