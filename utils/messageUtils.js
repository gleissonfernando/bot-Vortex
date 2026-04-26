/**
 * Utilitários para Envio de Mensagens
 * Fornece funções para criar embeds padronizados e enviar mensagens com tratamento de erros
 */

const { EmbedBuilder } = require('discord.js');

/**
 * Cores padrão para embeds do Magnatas
 */
const COLORS = {
    SUCCESS: 0x00FF00,      // Verde
    ERROR: 0xFF0000,        // Vermelho
    WARNING: 0xFFFF00,      // Amarelo
    INFO: 0x0099FF,         // Azul
    GOLD: 0xFFD700,         // Ouro (Magnatas)
    PREMIUM: 0xFF69B4,      // Rosa (Premium)
    TRANSACTION: 0x00CCFF   // Ciano (Transações)
};

/**
 * Cria embed de sucesso padronizado
 * @param {string} title - Título do embed
 * @param {string} description - Descrição
 * @param {object} options - Opções adicionais
 * @returns {EmbedBuilder}
 */
function createSuccessEmbed(title, description, options = {}) {
    const embed = new EmbedBuilder()
        .setTitle(`✅ ${title}`)
        .setDescription(description)
        .setColor(COLORS.SUCCESS)
        .setFooter({ 
            text: options.footer || 'Magnatas.gg • Sistema de Economia',
            iconURL: options.footerIcon
        })
        .setTimestamp();

    if (options.fields) {
        options.fields.forEach(field => {
            embed.addFields({
                name: field.name,
                value: field.value,
                inline: field.inline !== false
            });
        });
    }

    if (options.image) embed.setImage(options.image);
    if (options.thumbnail) embed.setThumbnail(options.thumbnail);

    return embed;
}

/**
 * Cria embed de erro padronizado
 * @param {string} title - Título do embed
 * @param {string} description - Descrição do erro
 * @param {object} options - Opções adicionais
 * @returns {EmbedBuilder}
 */
function createErrorEmbed(title, description, options = {}) {
    const embed = new EmbedBuilder()
        .setTitle(`❌ ${title}`)
        .setDescription(description)
        .setColor(COLORS.ERROR)
        .setFooter({ 
            text: options.footer || 'Magnatas.gg • Sistema de Economia',
            iconURL: options.footerIcon
        })
        .setTimestamp();

    if (options.fields) {
        options.fields.forEach(field => {
            embed.addFields({
                name: field.name,
                value: field.value,
                inline: field.inline !== false
            });
        });
    }

    return embed;
}

/**
 * Cria embed de aviso padronizado
 * @param {string} title - Título do embed
 * @param {string} description - Descrição
 * @param {object} options - Opções adicionais
 * @returns {EmbedBuilder}
 */
function createWarningEmbed(title, description, options = {}) {
    const embed = new EmbedBuilder()
        .setTitle(`⚠️ ${title}`)
        .setDescription(description)
        .setColor(COLORS.WARNING)
        .setFooter({ 
            text: options.footer || 'Magnatas.gg • Sistema de Economia',
            iconURL: options.footerIcon
        })
        .setTimestamp();

    if (options.fields) {
        options.fields.forEach(field => {
            embed.addFields({
                name: field.name,
                value: field.value,
                inline: field.inline !== false
            });
        });
    }

    return embed;
}

/**
 * Cria embed de informação padronizado
 * @param {string} title - Título do embed
 * @param {string} description - Descrição
 * @param {object} options - Opções adicionais
 * @returns {EmbedBuilder}
 */
function createInfoEmbed(title, description, options = {}) {
    const embed = new EmbedBuilder()
        .setTitle(`ℹ️ ${title}`)
        .setDescription(description)
        .setColor(COLORS.INFO)
        .setFooter({ 
            text: options.footer || 'Magnatas.gg • Sistema de Economia',
            iconURL: options.footerIcon
        })
        .setTimestamp();

    if (options.fields) {
        options.fields.forEach(field => {
            embed.addFields({
                name: field.name,
                value: field.value,
                inline: field.inline !== false
            });
        });
    }

    if (options.image) embed.setImage(options.image);
    if (options.thumbnail) embed.setThumbnail(options.thumbnail);

    return embed;
}

/**
 * Cria embed de transação padronizado
 * @param {string} type - Tipo de transação (ganho, perda, transferência)
 * @param {number} amount - Valor da transação
 * @param {object} options - Opções adicionais
 * @returns {EmbedBuilder}
 */
function createTransactionEmbed(type, amount, options = {}) {
    const typeConfig = {
        'ganho': { emoji: '💰', color: COLORS.SUCCESS, verb: 'ganhou' },
        'perda': { emoji: '💸', color: COLORS.ERROR, verb: 'perdeu' },
        'transferencia': { emoji: '💳', color: COLORS.TRANSACTION, verb: 'transferiu' },
        'compra': { emoji: '🛍️', color: COLORS.WARNING, verb: 'comprou' }
    };

    const config = typeConfig[type] || typeConfig['ganho'];
    const amountFormatted = amount.toLocaleString('pt-BR', { 
        style: 'currency', 
        currency: 'BRL' 
    });

    const embed = new EmbedBuilder()
        .setTitle(`${config.emoji} Transação Realizada`)
        .setDescription(`Você ${config.verb} **${amountFormatted}**`)
        .setColor(config.color)
        .setFooter({ 
            text: options.footer || 'Magnatas.gg • Sistema de Economia',
            iconURL: options.footerIcon
        })
        .setTimestamp();

    // Adiciona campos adicionais
    const fields = [];
    if (options.from) fields.push({ name: 'De', value: options.from, inline: true });
    if (options.to) fields.push({ name: 'Para', value: options.to, inline: true });
    if (options.reason) fields.push({ name: 'Motivo', value: options.reason, inline: false });
    if (options.balance) fields.push({ name: 'Saldo Atual', value: options.balance, inline: true });

    if (fields.length > 0) {
        embed.addFields(...fields);
    }

    return embed;
}

/**
 * Envia mensagem com tratamento de erros
 * @param {object} interaction - Interação do Discord
 * @param {object} messageData - Dados da mensagem
 * @param {boolean} ephemeral - Se a mensagem deve ser efêmera
 * @returns {Promise}
 */
async function sendMessage(interaction, messageData, ephemeral = false) {
    try {
        if (!interaction.isRepliable()) {
            console.warn('⚠️ Interação não é respondível');
            return null;
        }

        const options = {
            ...messageData,
            ephemeral
        };

        if (interaction.replied || interaction.deferred) {
            return await interaction.followUp(options);
        } else {
            return await interaction.reply(options);
        }
    } catch (error) {
        console.error('❌ Erro ao enviar mensagem:', error);
        
        // Tenta enviar mensagem de erro alternativa
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ Ocorreu um erro ao processar sua solicitação.',
                    ephemeral: true
                });
            }
        } catch (fallbackError) {
            console.error('❌ Erro ao enviar mensagem de fallback:', fallbackError);
        }

        throw error;
    }
}

/**
 * Envia embed com tratamento de erros
 * @param {object} interaction - Interação do Discord
 * @param {EmbedBuilder} embed - Embed a enviar
 * @param {boolean} ephemeral - Se a mensagem deve ser efêmera
 * @returns {Promise}
 */
async function sendEmbed(interaction, embed, ephemeral = false) {
    return sendMessage(interaction, { embeds: [embed] }, ephemeral);
}

/**
 * Envia múltiplos embeds com tratamento de erros
 * @param {object} interaction - Interação do Discord
 * @param {array} embeds - Array de embeds
 * @param {boolean} ephemeral - Se a mensagem deve ser efêmera
 * @returns {Promise}
 */
async function sendEmbeds(interaction, embeds, ephemeral = false) {
    return sendMessage(interaction, { embeds }, ephemeral);
}

/**
 * Valida conteúdo de mensagem
 * @param {string} content - Conteúdo a validar
 * @returns {object} - { valid: boolean, error?: string }
 */
function validateMessageContent(content) {
    if (!content || typeof content !== 'string') {
        return { valid: false, error: 'Conteúdo deve ser uma string' };
    }

    if (content.length > 2000) {
        return { valid: false, error: 'Conteúdo não pode exceder 2000 caracteres' };
    }

    return { valid: true };
}

/**
 * Valida embed
 * @param {EmbedBuilder} embed - Embed a validar
 * @returns {object} - { valid: boolean, error?: string }
 */
function validateEmbed(embed) {
    if (!embed) {
        return { valid: false, error: 'Embed não pode ser nulo' };
    }

    // Discord.js valida automaticamente, mas podemos adicionar validações customizadas
    const data = embed.toJSON();
    
    if (data.title && data.title.length > 256) {
        return { valid: false, error: 'Título não pode exceder 256 caracteres' };
    }

    if (data.description && data.description.length > 4096) {
        return { valid: false, error: 'Descrição não pode exceder 4096 caracteres' };
    }

    if (data.fields && data.fields.length > 25) {
        return { valid: false, error: 'Embed não pode ter mais de 25 campos' };
    }

    return { valid: true };
}

/**
 * Formata número como moeda
 * @param {number} amount - Valor a formatar
 * @param {string} currency - Código da moeda (padrão: BRL)
 * @returns {string}
 */
function formatCurrency(amount, currency = 'BRL') {
    return amount.toLocaleString('pt-BR', {
        style: 'currency',
        currency: currency
    });
}

/**
 * Formata número com separador de milhares
 * @param {number} num - Número a formatar
 * @returns {string}
 */
function formatNumber(num) {
    return num.toLocaleString('pt-BR');
}

/**
 * Trunca texto se exceder limite
 * @param {string} text - Texto a truncar
 * @param {number} maxLength - Comprimento máximo
 * @param {string} suffix - Sufixo (padrão: '...')
 * @returns {string}
 */
function truncateText(text, maxLength = 100, suffix = '...') {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - suffix.length) + suffix;
}

module.exports = {
    COLORS,
    createSuccessEmbed,
    createErrorEmbed,
    createWarningEmbed,
    createInfoEmbed,
    createTransactionEmbed,
    sendMessage,
    sendEmbed,
    sendEmbeds,
    validateMessageContent,
    validateEmbed,
    formatCurrency,
    formatNumber,
    truncateText
};
