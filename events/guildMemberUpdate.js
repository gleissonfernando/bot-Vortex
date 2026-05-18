const { Events } = require('discord.js');
const {
  hasRelevantFactionHierarchyRoleChange,
  updateFactionHierarchyPanel,
} = require('../utils/factionHierarchy');

const pendingUpdates = new Map();

function scheduleFactionHierarchyUpdate(client, guildId) {
  const key = String(guildId);
  const current = pendingUpdates.get(key);
  if (current) clearTimeout(current);

  const timeout = setTimeout(() => {
    pendingUpdates.delete(key);
    updateFactionHierarchyPanel(client, key).catch(() => null);
  }, 3000);

  pendingUpdates.set(key, timeout);
}

module.exports = {
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember) {
    if (!hasRelevantFactionHierarchyRoleChange(oldMember, newMember)) return;
    scheduleFactionHierarchyUpdate(newMember.client, newMember.guild.id);
  },
};
