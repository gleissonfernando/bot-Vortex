/**
 * Rate Limiter e Message Queue para Discord Bot
 * Gerencia requisições para evitar rate limits e garantir estabilidade
 */

class RateLimiter {
    constructor(maxRequestsPerSecond = 5) {
        this.maxRequestsPerSecond = maxRequestsPerSecond;
        this.requests = new Map(); // Armazena requisições por bucket
        this.globalLimit = 50; // Limite global do Discord
        this.globalRequests = [];
    }

    /**
     * Verifica se pode fazer uma requisição
     * @param {string} bucket - Identificador único do rate limit bucket
     * @returns {boolean} - True se pode fazer requisição
     */
    canMakeRequest(bucket = 'global') {
        const now = Date.now();
        
        // Limpar requisições antigas (mais de 1 segundo)
        if (!this.requests.has(bucket)) {
            this.requests.set(bucket, []);
        }
        
        const bucketRequests = this.requests.get(bucket);
        const recentRequests = bucketRequests.filter(time => now - time < 1000);
        this.requests.set(bucket, recentRequests);
        
        return recentRequests.length < this.maxRequestsPerSecond;
    }

    /**
     * Registra uma requisição
     * @param {string} bucket - Identificador único do rate limit bucket
     */
    recordRequest(bucket = 'global') {
        if (!this.requests.has(bucket)) {
            this.requests.set(bucket, []);
        }
        this.requests.get(bucket).push(Date.now());
    }

    /**
     * Calcula tempo de espera até poder fazer próxima requisição
     * @param {string} bucket - Identificador único do rate limit bucket
     * @returns {number} - Tempo em ms até poder fazer requisição
     */
    getWaitTime(bucket = 'global') {
        const now = Date.now();
        
        if (!this.requests.has(bucket)) {
            return 0;
        }
        
        const bucketRequests = this.requests.get(bucket);
        if (bucketRequests.length < this.maxRequestsPerSecond) {
            return 0;
        }
        
        const oldestRequest = bucketRequests[0];
        const waitTime = (oldestRequest + 1000) - now;
        return Math.max(0, waitTime);
    }

    /**
     * Processa headers de rate limit da resposta
     * @param {object} headers - Headers da resposta HTTP
     * @returns {object} - Informações de rate limit
     */
    processRateLimitHeaders(headers) {
        return {
            limit: parseInt(headers.get('x-ratelimit-limit')) || null,
            remaining: parseInt(headers.get('x-ratelimit-remaining')) || null,
            reset: parseInt(headers.get('x-ratelimit-reset')) || null,
            resetAfter: parseFloat(headers.get('x-ratelimit-reset-after')) || null,
            bucket: headers.get('x-ratelimit-bucket') || null,
            global: headers.get('x-ratelimit-global') === 'true',
            scope: headers.get('x-ratelimit-scope') || null
        };
    }

    /**
     * Log de informações de rate limit
     * @param {object} rateLimitInfo - Informações de rate limit
     */
    logRateLimitInfo(rateLimitInfo) {
        if (rateLimitInfo.remaining !== null) {
            console.log(
                `📊 Rate Limit: ${rateLimitInfo.remaining}/${rateLimitInfo.limit} | ` +
                `Reset em: ${rateLimitInfo.resetAfter}s | ` +
                `Bucket: ${rateLimitInfo.bucket}`
            );
        }
    }
}

/**
 * Fila de Mensagens para envio ordenado
 */
class MessageQueue {
    constructor(maxPerSecond = 5) {
        this.queue = [];
        this.maxPerSecond = maxPerSecond;
        this.lastReset = Date.now();
        this.count = 0;
        this.processing = false;
    }

    /**
     * Adiciona mensagem à fila
     * @param {string} channelId - ID do canal
     * @param {object} messageData - Dados da mensagem
     * @returns {Promise} - Promise que resolve quando mensagem é enviada
     */
    async add(channelId, messageData) {
        return new Promise((resolve, reject) => {
            this.queue.push({ 
                channelId, 
                messageData, 
                resolve, 
                reject,
                timestamp: Date.now()
            });
            this.process();
        });
    }

    /**
     * Processa fila de mensagens
     */
    async process() {
        if (this.processing || this.queue.length === 0) return;
        
        this.processing = true;

        while (this.queue.length > 0) {
            const now = Date.now();
            
            // Reset contador a cada segundo
            if (now - this.lastReset > 1000) {
                this.count = 0;
                this.lastReset = now;
            }

            // Se atingiu limite, aguarda
            if (this.count >= this.maxPerSecond) {
                const waitTime = 1000 - (now - this.lastReset);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }

            const item = this.queue.shift();
            this.count++;

            try {
                // Aqui seria feito o envio real da mensagem
                // Por enquanto, apenas resolvemos o promise
                item.resolve({
                    success: true,
                    channelId: item.channelId,
                    timestamp: Date.now()
                });
            } catch (error) {
                item.reject(error);
            }
        }

        this.processing = false;
    }

    /**
     * Retorna status da fila
     */
    getStatus() {
        return {
            queueLength: this.queue.length,
            requestsThisSecond: this.count,
            maxPerSecond: this.maxPerSecond,
            canSend: this.count < this.maxPerSecond
        };
    }
}

/**
 * Retry Logic com Backoff Exponencial
 */
class RetryHandler {
    constructor(maxRetries = 3, initialBackoff = 1000) {
        this.maxRetries = maxRetries;
        this.initialBackoff = initialBackoff;
    }

    /**
     * Executa função com retry automático
     * @param {Function} fn - Função a executar
     * @param {string} context - Contexto para logging
     * @returns {Promise} - Resultado da função
     */
    async execute(fn, context = 'operation') {
        let lastError;

        for (let attempt = 0; attempt < this.maxRetries; attempt++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error;
                
                // Não retry em erros 4xx (exceto 429)
                if (error.status && error.status >= 400 && error.status < 500 && error.status !== 429) {
                    throw error;
                }

                if (attempt < this.maxRetries - 1) {
                    const backoffTime = this.initialBackoff * Math.pow(2, attempt);
                    console.warn(
                        `⚠️ ${context} falhou (tentativa ${attempt + 1}/${this.maxRetries}). ` +
                        `Aguardando ${backoffTime}ms antes de retry...`
                    );
                    await new Promise(resolve => setTimeout(resolve, backoffTime));
                }
            }
        }

        throw lastError;
    }

    /**
     * Calcula tempo de espera para retry
     * @param {number} attempt - Número da tentativa (0-indexed)
     * @returns {number} - Tempo em ms
     */
    getBackoffTime(attempt) {
        return this.initialBackoff * Math.pow(2, attempt);
    }
}

/**
 * Gerenciador de Requisições HTTP com Rate Limiting
 */
class RequestManager {
    constructor(token, maxRequestsPerSecond = 5) {
        this.token = token;
        this.rateLimiter = new RateLimiter(maxRequestsPerSecond);
        this.messageQueue = new MessageQueue(maxRequestsPerSecond);
        this.retryHandler = new RetryHandler(3, 1000);
        this.baseUrl = 'https://discord.com/api/v10';
    }

    /**
     * Faz requisição HTTP com rate limiting e retry
     * @param {string} method - Método HTTP (GET, POST, etc)
     * @param {string} endpoint - Endpoint da API
     * @param {object} data - Dados para enviar
     * @param {string} bucket - Bucket de rate limit
     * @returns {Promise} - Resposta da API
     */
    async request(method, endpoint, data = null, bucket = 'global') {
        return this.retryHandler.execute(async () => {
            // Aguarda se necessário
            const waitTime = this.rateLimiter.getWaitTime(bucket);
            if (waitTime > 0) {
                console.log(`⏳ Rate limit: aguardando ${waitTime}ms`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }

            // Faz requisição
            const options = {
                method,
                headers: {
                    'Authorization': `Bot ${this.token}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'DiscordBot (Magnatas, 1.0)'
                }
            };

            if (data) {
                options.body = JSON.stringify(data);
            }

            const response = await fetch(`${this.baseUrl}${endpoint}`, options);
            
            // Processa headers de rate limit
            const rateLimitInfo = this.rateLimiter.processRateLimitHeaders(response.headers);
            this.rateLimiter.logRateLimitInfo(rateLimitInfo);

            // Registra requisição
            this.rateLimiter.recordRequest(bucket);

            // Trata erros
            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}`);
                error.status = response.status;
                error.rateLimitInfo = rateLimitInfo;

                if (response.status === 429) {
                    console.error(
                        `🚫 Rate Limited! Aguarde ${rateLimitInfo.resetAfter}s ` +
                        `(Scope: ${rateLimitInfo.scope})`
                    );
                }

                throw error;
            }

            return await response.json();
        }, `${method} ${endpoint}`);
    }

    /**
     * Envia mensagem com fila
     * @param {string} channelId - ID do canal
     * @param {object} messageData - Dados da mensagem
     * @returns {Promise} - Resposta da API
     */
    async sendMessage(channelId, messageData) {
        return this.messageQueue.add(channelId, messageData);
    }

    /**
     * Retorna status do gerenciador
     */
    getStatus() {
        return {
            queue: this.messageQueue.getStatus(),
            rateLimiter: {
                maxPerSecond: this.rateLimiter.maxRequestsPerSecond,
                globalLimit: this.rateLimiter.globalLimit
            }
        };
    }
}

module.exports = {
    RateLimiter,
    MessageQueue,
    RetryHandler,
    RequestManager
};
