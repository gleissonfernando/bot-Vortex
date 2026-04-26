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

module.exports = {
    data: new SlashCommandBuilder()
        .setName('set')
        .setDescription('🎯 Abre o sistema de recrutamento Vortex'),

    async execute(interaction) {
        // Nome do arquivo de banner
        const fileName = 'IMG_4234.png';
        const bannerPath = path.join(__dirname, '../../foto/', fileName);

        if (!fs.existsSync(bannerPath)) {
            await interaction.reply({
                content: `❌ **Erro:** Banner oficial não encontrado. Por favor, verifique a pasta \`foto\`.`,
                ephemeral: true
            });
            return;
        }

        const embed = new EmbedBuilder()
            .setColor('#D4AF37') // Cor Dourada para combinar com a logo
            .setAuthor({
                name: 'Vortex MANAGEMENT • RECRUTAMENTO',
                iconURL: interaction.guild.iconURL({ dynamic: true })
            })
            .setTitle('✨ Seja bem-vindo à nossa seletiva!')
            .setDescription(
                '### 📋 Informações Importantes\n' +
                'Olá, **candidato**! Você está prestes a iniciar o processo de recrutamento oficial da **Vortex**. Buscamos membros comprometidos e prontos para somar com nossa equipe.\n\n' +
                '**📌 Requisitos Básicos:**\n' +
                '> • Ter microfone de boa qualidade\n' +
                '> • Respeitar as regras da organização\n' +
                '> • Disponibilidade e compromisso'
            )
            .setImage(`attachment://${fileName}`)
            .addFields(
                {
                    name: '🚀 Como funciona?',
                    value: '`1.` Clique no botão abaixo para iniciar\n' +
                           '`2.` Preencha o formulário com seus dados\n' +
                           '`3.` Aguarde a análise da nossa Staff',
                    inline: false
                },
                {
                    name: '⏳ Tempo de Resposta',
                    value: '> 📥 **Análise:** Até 24h\n> 📬 **Resultado:** Via DM',
                    inline: true
                },
                {
                    name: '🛡️ Segurança',
                    value: '> 🔒 Dados Protegidos\n> ✅ Sistema Oficial',
                    inline: true
                }
            )
            .setFooter({
                text: '© 2026 Vortex Recruitment System • Qualidade & Compromisso',
                iconURL: interaction.guild.iconURL({ dynamic: true })
            })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('Vortex_set_start')
                .setLabel('Iniciar Recrutamento')
                .setEmoji('🎮')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('Vortex_set_info')
                .setLabel('Ver Regras')
                .setEmoji('📜')
                .setStyle(ButtonStyle.Secondary)
        );

        const bannerAttachment = new AttachmentBuilder(bannerPath);

        try {
            await interaction.reply({
                embeds: [embed],
                components: [row],
                files: [bannerAttachment]
            });
        } catch (error) {
            console.error('[set] Erro ao enviar embed de recrutamento:', error);

            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ **Erro:** Não foi possível carregar o sistema de recrutamento.',
                    ephemeral: true
                });
            }
        }
    }
};
