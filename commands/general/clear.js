const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { safeReply, safeEdit, safeDeferReply } = require('../../utils/safeReply');

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
      return safeReply(interaction, { content: '❌ Este comando só pode ser usado em canal de texto do servidor.', ephemeral: true });
    }

    const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
    const botPermissions = botMember ? interaction.channel.permissionsFor(botMember) : null;
    if (!botPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      return safeReply(interaction, { content: '❌ Eu preciso da permissão Gerenciar Mensagens neste canal.', ephemeral: true });
    }

    const amount = interaction.options.getInteger('quantidade', true);
    await safeDeferReply(interaction, { ephemeral: true });

    const messages = await interaction.channel.messages.fetch({ limit: amount }).catch((error) => {
      console.error('[VORTEX] Erro ao buscar mensagens para limpar:', error);
      return null;
    });

    if (!messages || messages.size === 0) {
      return safeEdit(interaction, { content: '❌ Não encontrei mensagens para apagar.' });
    }

    let deleted = 0;
    for (const message of messages.values()) {
      if (!message?.deletable) continue;
      try {
        await message.delete();
        deleted += 1;
      } catch (error) {
        console.error('[VORTEX] Erro ao deletar mensagem no clear:', error);
      }
    }

    if (deleted === 0) {
      return safeEdit(interaction, { content: '❌ Não consegui apagar as mensagens deste canal.' });
    }

    return safeEdit(interaction, { content: `✅ ${deleted} mensagens apagadas.` });
  },
};
