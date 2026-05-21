import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { env } from './env.js';

export async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('ponto')
      .setDescription('Registra entrada ou saida de ponto')
      .addStringOption((option) =>
        option
          .setName('acao')
          .setDescription('Escolha a acao')
          .setRequired(true)
          .addChoices(
            { name: 'Entrada', value: 'open' },
            { name: 'Saida', value: 'close' }
          )
      )
      .addStringOption((option) =>
        option
          .setName('observacao')
          .setDescription('Observacao opcional')
          .setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName('sync-membros')
      .setDescription('Sincroniza membros do Discord com o painel')
  ].map((command) => command.toJSON());

  const rest = new REST({ version: '10' }).setToken(env.discordToken);
  await rest.put(Routes.applicationGuildCommands(env.discordClientId, env.discordGuildId), { body: commands });
}
