const { ModalBuilder, TextInputBuilder, ActionRowBuilder } = require('discord.js');

module.exports = {
    // Helper to create modals for user-input based actions
    createLimitModal: () => {
        return new ModalBuilder()
            .setCustomId('modal_call_limit')
            .setTitle('Alterar Limite da Call')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('limit_value')
                        .setLabel('Quantidade de usuários (1-99)')
                        .setStyle(require('discord.js').TextInputStyle.Short)
                        .setMaxLength(2)
                        .setRequired(true)
                )
            );
    },
    createUserIdModal: (action) => {
        return new ModalBuilder()
            .setCustomId(`modal_${action}`)
            .setTitle(`Ação: ${action === 'allow' ? 'Permitir' : action === 'disconnect' ? 'Desconectar' : 'Banir'}`)
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('user_id')
                        .setLabel('ID do Usuário')
                        .setStyle(require('discord.js').TextInputStyle.Short)
                        .setRequired(true)
                )
            );
    }
};
