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
    const humanMembers = members.filter((member) => !member.user.bot);
    const presentDiscordUserIds = humanMembers.map((member) => member.user.id);
    const payload = await Promise.all(humanMembers.map(mapMember));
    const chunkSize = 100;
    for (let index = 0; index < payload.length; index += chunkSize) {
        const chunk = payload.slice(index, index + chunkSize);
        await postToApi('/ingest/members', { members: chunk });
    }
    const prune = presentDiscordUserIds.length
        ? await postToApi('/ingest/members/prune', {
            guildId: guild.id,
            presentDiscordUserIds
        })
        : { removedMembers: 0 };
    return {
        synced: payload.length,
        present: presentDiscordUserIds.length,
        removed: Number(prune?.removedMembers || 0)
    };
}
client.once(Events.ClientReady, async () => {
    console.log(`Frequency bot online as ${client.user?.tag}`);
    await registerCommands();
    const result = await syncGuildMembers();
    console.log(`Synced ${result.synced} Discord members; removed ${result.removed} missing dashboard records`);
});
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand())
        return;
    if (interaction.commandName === 'sync-membros') {
        await interaction.deferReply({ ephemeral: true });
        const result = await syncGuildMembers();
        await interaction.editReply(`Sincronizacao concluida: ${result.synced} membros. Removidos do painel: ${result.removed}.`);
        return;
    }
});
client.on(Events.PresenceUpdate, async (_oldPresence, newPresence) => {
    if (!newPresence.guild || !newPresence.userId)
        return;
    await postToApi('/ingest/presence', {
        guildId: newPresence.guild.id,
        discordUserId: newPresence.userId,
        seenAt: new Date().toISOString()
    }).catch(() => null);
});
await client.login(env.discordToken);
