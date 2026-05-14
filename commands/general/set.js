const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    AttachmentBuilder
} = require('discord.js');
const path = require('path');
const fs = require('fs');
const { isRegisteredUser, hasCommandRole, denyNotRegistered } = require('../../utils/permissions');
const { safeReply } = require('../../utils/safeReply');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('set')
        .setDescription('🎯 Abre o sistema de recrutamento Vortex'),

    async execute(interaction) {
        // 1. Verificar autorização
        if (!isRegisteredUser(interaction) && !hasCommandRole(interaction.member, 'set')) {
            return denyNotRegistered(interaction);
        }

        const fileName = 'IMG_4234.png';
        const bannerPath = path.join(__dirname, '../../foto/', fileName);

        const embed = new EmbedBuilder()
            .setColor('#D4AF37')
            .setAuthor({
                name: 'Vortex MANAGEMENT • RECRUTAMENTO',
                iconURL: interaction.guild.iconURL({ dynamic: true })
            })
            .setTitle('✨ Seja bem-vindo à nossa seletiva!')
            .setDescription(
                '### 📋 Informações Importantes\n' +
                'Olá, **candidato**! Você está prestes a iniciar o processo de recrutamento oficial da **Vortex**.\n\n' +
                '**📌 Requisitos Básicos:**\n' +
                '> • Ter microfone de boa qualidade\n' +
                '> • Respeitar as regras da organização\n' +
                '> • Disponibilidade e compromisso'
            )
            .addFields(
                {
                    name: '🚀 Como funciona?',
                    value: '`1.` Clique no botão abaixo para iniciar\n' +
                           '`2.` Selecione o tipo de set (Morador ou Membro)\n' +
                           '`3.` Informe ID, nome e número em game\n' +
                           '`4.` Aguarde a análise da Staff',
                    inline: false
                }
            )
            .setFooter({
                text: '© 2026 Vortex Recruitment System',
                iconURL: interaction.guild.iconURL({ dynamic: true })
            })
            .setTimestamp();

        if (fs.existsSync(bannerPath)) {
            embed.setImage(`attachment://${fileName}`);
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('Vortex_set_start')
                .setLabel('Pedir Set / Recrutamento')
                .setEmoji('📝')
                .setStyle(ButtonStyle.Success)
        );

        const options = { embeds: [embed], components: [row] };
        if (fs.existsSync(bannerPath)) {
            options.files = [new AttachmentBuilder(bannerPath)];
        }

        await safeReply(interaction, options);
    }
};
