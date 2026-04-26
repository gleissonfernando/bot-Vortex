require('dotenv').config();

module.exports = {
    token: process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN,
    clientId: process.env.VITE_DISCORD_CLIENT_ID || process.env.DISCORD_CLIENT_ID || '',
    guildId: process.env.VITE_DISCORD_GUILD_ID || process.env.DISCORD_GUILD_ID || '',
    staffChannelId: process.env.STAFF_CHANNEL_ID || '1497685822525149337',
    logsChannelId: process.env.LOGS_CHANNEL_ID || '1497380031016599603',
    categoryId: process.env.CATEGORY_ID || '1497684838352949319',
    roles: {
        morador: process.env.ROLE_MORADOR_ID || 'ID_DO_CARGO_MORADOR',
        membro: process.env.ROLE_MEMBRO_ID || 'ID_DO_CARGO_MEMBRO'
    },
    staffRoles: [
        1497703127074345040,
  
    ],
    authorizedUserIds: [
        '289227932432334869',
        '761011766440230932',
        '1497703127074345040',
        '1201238799494152344'
        

        ...(process.env.AUTHORIZED_USER_IDS || '').split(',').map(v => v.trim()).filter(Boolean)
    ],
    registeredRoleIds: [
        ...((process.env.REGISTERED_ROLE_IDS || '')
            .split(',')
            .map(v => v.trim())
            .filter(Boolean)),
        '1201238413676924979'
    ],
    gerenciaRoleIds: [
        ...((process.env.GERENCIA_ROLE_IDS || '')
            .split(',')
            .map(v => v.trim())
            .filter(Boolean)),
        '1201238413676924979'
    ]
};
