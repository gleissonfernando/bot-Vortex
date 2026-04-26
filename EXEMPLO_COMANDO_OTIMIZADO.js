/**
 * EXEMPLO DE COMANDO OTIMIZADO COM AS NOVAS FUNCIONALIDADES
 * 
 * Este arquivo demonstra como usar os novos módulos de logging,
 * tratamento de erros e envio de mensagens otimizado.
 * 
 * Para usar este exemplo em um comando real:
 * 1. Copie a estrutura para seu arquivo de comando
 * 2. Substitua 'exemplo' pelo nome do seu comando
 * 3. Implemente sua lógica de negócio
 */

const { SlashCommandBuilder } = require('discord.js');
const { logger } = require('../utils/logger');
const { 
    createSuccessEmbed, 
    createErrorEmbed, 
    sendEmbed,
    validateMessageContent,
    formatCurrency,
    formatNumber
} = require('../utils/messageUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('exemplo')
        .setDescription('Comando de exemplo otimizado')
        .addUserOption(option =>
            option.setName('usuario')
                .setDescription('Usuário alvo')
                .setRequired(false)
        ),
    
    async execute(interaction) {
        // 1. Registrar início da execução
        const startTime = Date.now();
        logger.info(`Comando 'exemplo' iniciado por ${interaction.user.tag}`);

        try {
            // 2. Validar permissões (opcional)
            if (!interaction.member.permissions.has('SEND_MESSAGES')) {
                const errorEmbed = createErrorEmbed(
                    'Permissão Negada',
                    'Você não tem permissão para usar este comando.'
                );
                return await sendEmbed(interaction, errorEmbed, true);
            }

            // 3. Obter opções do comando
            const targetUser = interaction.options.getUser('usuario') || interaction.user;

            // 4. Validar dados
            if (!targetUser) {
                const errorEmbed = createErrorEmbed(
                    'Usuário Inválido',
                    'Não foi possível encontrar o usuário especificado.'
                );
                return await sendEmbed(interaction, errorEmbed, true);
            }

            // 5. Simular busca de dados (substituir com lógica real)
            const userData = {
                userId: targetUser.id,
                username: targetUser.username,
                balance: 1500,
                level: 25,
                totalEarnings: 5000,
                joinDate: new Date(2024, 0, 15)
            };

            // 6. Validar dados obtidos
            if (!userData) {
                const errorEmbed = createErrorEmbed(
                    'Dados não Encontrados',
                    'Não foi possível encontrar dados para este usuário.'
                );
                return await sendEmbed(interaction, errorEmbed, true);
            }

            // 7. Criar resposta com embed otimizado
            const successEmbed = createSuccessEmbed(
                'Informações do Usuário',
                `Dados de ${targetUser.username}`,
                {
                    fields: [
                        {
                            name: '💰 Saldo',
                            value: formatCurrency(userData.balance),
                            inline: true
                        },
                        {
                            name: '📊 Nível',
                            value: formatNumber(userData.level),
                            inline: true
                        },
                        {
                            name: '💎 Ganhos Totais',
                            value: formatCurrency(userData.totalEarnings),
                            inline: true
                        },
                        {
                            name: '📅 Data de Entrada',
                            value: userData.joinDate.toLocaleDateString('pt-BR'),
                            inline: true
                        }
                    ],
                    thumbnail: targetUser.displayAvatarURL({ size: 256 }),
                    footer: 'Magnatas.gg • Sistema de Informações'
                }
            );

            // 8. Enviar resposta
            await sendEmbed(interaction, successEmbed, false);

            // 9. Registrar sucesso com performance
            const duration = Date.now() - startTime;
            logger.performance('Comando exemplo', duration, {
                userId: interaction.user.id,
                targetUserId: targetUser.id,
                guildId: interaction.guildId
            });

        } catch (error) {
            // 10. Tratamento de erro
            logger.commandError('exemplo', error, {
                userId: interaction.user.id,
                guildId: interaction.guildId
            });

            // 11. Enviar mensagem de erro ao usuário
            const errorEmbed = createErrorEmbed(
                'Erro ao Processar',
                'Ocorreu um erro ao processar seu comando. Tente novamente mais tarde.'
            );

            try {
                await sendEmbed(interaction, errorEmbed, true);
            } catch (sendError) {
                logger.error('Erro ao enviar mensagem de erro', sendError);
            }
        }
    }
};

/**
 * PADRÕES DE USO RECOMENDADOS
 * 
 * 1. SEMPRE use logger para registrar eventos importantes
 *    logger.info('Evento importante');
 *    logger.command(commandName, userId, guildId);
 *    logger.error('Erro', error);
 * 
 * 2. USE embeds padronizados para melhor UX
 *    createSuccessEmbed() - Para sucesso
 *    createErrorEmbed() - Para erros
 *    createWarningEmbed() - Para avisos
 *    createInfoEmbed() - Para informações
 *    createTransactionEmbed() - Para transações
 * 
 * 3. VALIDE dados antes de usar
 *    validateMessageContent(text)
 *    validateEmbed(embed)
 * 
 * 4. USE formatadores para dados
 *    formatCurrency(amount) - Formata como moeda
 *    formatNumber(num) - Formata número com separadores
 *    truncateText(text, maxLength) - Trunca texto longo
 * 
 * 5. SEMPRE trate erros com try-catch
 *    Registre com logger.error()
 *    Envie mensagem amigável ao usuário
 *    Não exponha detalhes técnicos
 * 
 * 6. MEÇA performance de operações lentas
 *    logger.performance('operação', duration, meta)
 * 
 * 7. USE sendEmbed() para enviar embeds
 *    Trata automaticamente se já respondeu
 *    Trata erros de envio
 */

/**
 * EXEMPLO DE COMANDO COM TRANSAÇÃO
 */
const exampleTransactionCommand = {
    async execute(interaction) {
        try {
            const amount = interaction.options.getNumber('valor');
            const targetUser = interaction.options.getUser('usuario');

            // Simular transação
            const transactionEmbed = require('../utils/messageUtils').createTransactionEmbed(
                'transferencia',
                amount,
                {
                    from: interaction.user.username,
                    to: targetUser.username,
                    reason: 'Pagamento',
                    balance: formatCurrency(1000 - amount),
                    footer: 'Transação realizada com sucesso'
                }
            );

            await sendEmbed(interaction, transactionEmbed, false);
            logger.info(`Transação: ${interaction.user.id} -> ${targetUser.id}: ${amount}`);

        } catch (error) {
            logger.commandError('transferencia', error);
        }
    }
};

/**
 * EXEMPLO DE COMANDO COM VALIDAÇÃO
 */
const exampleValidationCommand = {
    async execute(interaction) {
        try {
            const message = interaction.options.getString('mensagem');

            // Validar conteúdo
            const validation = validateMessageContent(message);
            if (!validation.valid) {
                const errorEmbed = createErrorEmbed(
                    'Entrada Inválida',
                    validation.error
                );
                return await sendEmbed(interaction, errorEmbed, true);
            }

            // Processar mensagem validada
            const successEmbed = createSuccessEmbed(
                'Mensagem Processada',
                `Sua mensagem foi processada: ${message}`
            );

            await sendEmbed(interaction, successEmbed, false);

        } catch (error) {
            logger.commandError('processar_mensagem', error);
        }
    }
};

module.exports.exampleTransactionCommand = exampleTransactionCommand;
module.exports.exampleValidationCommand = exampleValidationCommand;
