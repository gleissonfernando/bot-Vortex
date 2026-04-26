/**
 * Utilitários para Envio de Mensagens
 * Fornece funções para criar embeds padronizados e enviar mensagens com tratamento de erros
 */

const { EmbedBuilder } = require('discord.js');

/**
 * Cores padrão para embeds do Vortex
 */
const COLORS = {
    SUCCESS: 0x00FF00,      // Verde
    ERROR: 0xFF0000,        // Vermelho
    WARNING: 0xFFFF00,      // Amarelo
    INFO: 0x0099FF,         // Azul
    VORTEX: 0x7000FF,       // Roxo (Vortex)
    PREMIUM: 0xFF69B4,      // Rosa (Premium)
    TRANSACTION: 0x00CCFF   // Ciano (Transações)
};

/**
 * Cria embed de sucesso padronizado
 */
function createSuccessEmbed(title, description, options = {}) {
    const embed = new EmbedBuilder()
        .setTitle(`✅ ${title}`)
        .setDescription(description)
        .setColor(COLORS.SUCCESS)
        .setFooter({ 
            text: options.footer || 'Vortex Management System • Sucesso',
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
 */
function createErrorEmbed(title, description, options = {}) {
    const embed = new EmbedBuilder()
        .setTitle(`❌ ${title}`)
        .setDescription(description)
        .setColor(COLORS.ERROR)
        .setFooter({ 
            text: options.footer || 'Vortex Management System • Erro',
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
 */
function createWarningEmbed(title, description, options = {}) {
    const embed = new EmbedBuilder()
        .setTitle(`⚠️ ${title}`)
        .setDescription(description)
        .setColor(COLORS.WARNING)
        .setFooter({ 
            text: options.footer || 'Vortex Management System • Aviso',
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
 */
function createInfoEmbed(title, description, options = {}) {
    const embed = new EmbedBuilder()
        .setTitle(`ℹ️ ${title}`)
        .setDescription(description)
        .setColor(COLORS.INFO)
        .setFooter({ 
            text: options.footer || 'Vortex Management System • Info',
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
 */
function createTransactionEmbed(type, amount, options = {}) {
    const typeConfig = {
        'ganho': { emoji: '💰', color: COLORS.SUCCESS, verb: 'recebeu' },
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
            text: options.footer || 'Vortex Management System • Transação',
            iconURL: options.footerIcon
        })
        .setTimestamp();

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

async function sendMessage(interaction, messageData, ephemeral = false) {
    try {
        if (!interaction.isRepliable()) return null;

        const options = { ...messageData, ephemeral };

        if (interaction.replied || interaction.deferred) {
            return await interaction.followUp(options);
        } else {
            return await interaction.reply(options);
        }
    } catch (error) {
        console.error('❌ Erro ao enviar mensagem:', error);
        return null;
    }
}

async function sendEmbed(interaction, embed, ephemeral = false) {
    return sendMessage(interaction, { embeds: [embed] }, ephemeral);
}

async function sendEmbeds(interaction, embeds, ephemeral = false) {
    return sendMessage(interaction, { embeds }, ephemeral);
}

function validateMessageContent(content) {
    if (!content || typeof content !== 'string') return { valid: false, error: 'Conteúdo inválido' };
    if (content.length > 2000) return { valid: false, error: 'Conteúdo muito longo' };
    return { valid: true };
}

function validateEmbed(embed) {
    if (!embed) return { valid: false, error: 'Embed nulo' };
    const data = embed.toJSON();
    if (data.title && data.title.length > 256) return { valid: false, error: 'Título muito longo' };
    if (data.description && data.description.length > 4096) return { valid: false, error: 'Descrição muito longa' };
    return { valid: true };
}

function formatCurrency(amount, currency = 'BRL') {
    return amount.toLocaleString('pt-BR', { style: 'currency', currency });
}

function formatNumber(num) {
    return num.toLocaleString('pt-BR');
}

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
