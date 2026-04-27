const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { sendVortexLog } = require('../../utils/notifications');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Apaga uma quantidade de mensagens do canal atual.')
    .addIntegerOption(option =>
      option
        .setName('quantidade')
        .setDescription('Quantidade de mensagens para apagar, de 1 a 100.')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)),

  async execute(interaction) {
    if (!interaction.guild || !interaction.channel?.bulkDelete) {
      return interaction.reply({ content: '❌ Este comando só pode ser usado em canal de texto do servidor.', ephemeral: true });
    }

    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return interaction.reply({ content: '❌ Você precisa da permissão Gerenciar Mensagens para usar este comando.', ephemeral: true });
    }

    const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
    const botPermissions = botMember ? interaction.channel.permissionsFor(botMember) : null;
    if (!botPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      return interaction.reply({ content: '❌ Eu preciso da permissão Gerenciar Mensagens neste canal.', ephemeral: true });
    }

    const amount = interaction.options.getInteger('quantidade', true);
    await interaction.deferReply({ ephemeral: true });

    const deleted = await interaction.channel.bulkDelete(amount, true).catch((error) => {
      console.error('[VORTEX] Erro ao limpar mensagens:', error);
      return null;
    });

    if (!deleted) {
      return interaction.editReply('❌ Não consegui apagar as mensagens. O Discord não permite apagar mensagens muito antigas.');
    }

    sendVortexLog(interaction.client, {
      title: 'Mensagens Limpas',
      description: [
        `**Usuario:** <@${interaction.user.id}> (${interaction.user.id})`,
        `**Canal:** <#${interaction.channel.id}> (${interaction.channel.id})`,
        `**Quantidade solicitada:** ${amount}`,
        `**Quantidade apagada:** ${deleted.size}`,
      ].join('\n'),
      color: '#FEE75C',
      type: 'MODERAÇÃO',
      userId: interaction.user.id,
    }).catch(() => {});

    return interaction.editReply(`✅ ${deleted.size} mensagens apagadas.`);
  },
};
