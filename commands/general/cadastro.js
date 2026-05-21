const { SlashCommandBuilder } = require('discord.js');
const { executeCadastroCommand } = require('../../utils/chatCadastroManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cadastro')
    .setDescription('Liga ou desliga o modo de cadastro de perfis por mensagem.')
    .addStringOption((option) =>
      option
        .setName('acao')
        .setDescription('O que fazer com o modo cadastro neste canal')
        .setRequired(false)
        .addChoices(
          { name: 'Ligar', value: 'ligar' },
          { name: 'Desligar', value: 'desligar' },
          { name: 'Status', value: 'status' },
        )),

  async execute(interaction) {
    return executeCadastroCommand(interaction);
  },
};
