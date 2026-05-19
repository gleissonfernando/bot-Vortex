const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const { isRegisteredUser, hasCommandRole, denyNotRegistered } = require('../../utils/permissions');
const { safeReply } = require('../../utils/safeReply');
const { buildThemedPanelPayload } = require('../../utils/panelTheme');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('set')
        .setDescription('Abre o painel de cadastro da Vortex'),

    async execute(interaction) {
        // 1. Verificar autorização
        if (!isRegisteredUser(interaction) && !hasCommandRole(interaction.member, 'set')) {
            return denyNotRegistered(interaction);
        }

        const embed = new EmbedBuilder()
            .setColor('#D4AF37')
            .setAuthor({
                name: 'VORTEX • Cadastro',
                iconURL: interaction.guild.iconURL({ dynamic: true })
            })
            .setTitle('📋 Painel de Set')
            .setDescription(
                '**Use este painel para solicitar seu set na Vortex.**\n\n' +
                'Preencha seus dados corretamente para a staff analisar o pedido.'
            )
            .addFields(
                {
                    name: '📝 Como funciona',
                    value: [
                        '`1.` Clique em **Iniciar set**.',
                        '`2.` Escolha **Morador** ou **Membro**.',
                        '`3.` Informe seus dados em game.',
                        '`4.` Aguarde a análise da staff.',
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '⚠️ Atenção',
                    value: 'Dados incorretos podem atrasar ou reprovar o pedido.',
                    inline: false
                }
            )
            .setFooter({
                text: 'Vortex • Sistema de Set',
                iconURL: interaction.guild.iconURL({ dynamic: true })
            })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('Vortex_set_start')
                .setLabel('Iniciar set')
                .setEmoji('📝')
                .setStyle(ButtonStyle.Success)
        );

        await safeReply(interaction, buildThemedPanelPayload('set', embed, { components: [row] }));
    }
};
