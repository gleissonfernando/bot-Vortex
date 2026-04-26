const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('calltemporaria')
        .setDescription('Cria uma call de voz temporária para você'),
    async execute(interaction) {
        if (!interaction.guild) {
            await interaction.reply({ content: '❌ Este comando só pode ser usado em servidor.', ephemeral: true });
            return;
        }

        const channelName = `call-${interaction.user.username.toLowerCase().replace(/\s+/g, '-').slice(0, 80)}`;

        const channel = await interaction.guild.channels.create({
            name: channelName,
            type: ChannelType.GuildVoice,
            permissionOverwrites: [
                {
                    id: interaction.guild.roles.everyone.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
                },
                {
                    id: interaction.user.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.ManageChannels]
                }
            ]
        });

        await interaction.reply({
            content: `✅ Call temporária criada: ${channel}`,
            ephemeral: true
        });
    },
};
