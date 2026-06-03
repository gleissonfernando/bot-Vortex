import { Client, Events, GatewayIntentBits } from 'discord.js';
import { postToApi } from './api.js';
import { registerCommands } from './commands.js';
import { env } from './env.js';
import { mapMember } from './memberMapper.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

async function syncGuildMembers() {
  const guild = await client.guilds.fetch(env.discordGuildId);
  const members = await guild.members.fetch();
  const payload = await Promise.all(members
    .filter((member) => !member.user.bot)
    .map(mapMember));

  const chunkSize = 100;
  for (let index = 0; index < payload.length; index += chunkSize) {
    const chunk = payload.slice(index, index + chunkSize);
    await postToApi('/ingest/members', { members: chunk });
  }
  return payload.length;
}

client.once(Events.ClientReady, async () => {
  console.log(`Frequency bot online as ${client.user?.tag}`);
  await registerCommands();
  const count = await syncGuildMembers();
  console.log(`Synced ${count} Discord members`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'sync-membros') {
    await interaction.deferReply({ ephemeral: true });
    const count = await syncGuildMembers();
    await interaction.editReply(`Sincronizacao concluida: ${count} membros.`);
    return;
  }
});

client.on(Events.PresenceUpdate, async (_oldPresence, newPresence) => {
  if (!newPresence.guild || !newPresence.userId) return;
  await postToApi('/ingest/presence', {
    guildId: newPresence.guild.id,
    discordUserId: newPresence.userId,
    seenAt: new Date().toISOString()
  }).catch(() => null);
});

await client.login(env.discordToken);
