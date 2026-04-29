require('dotenv').config();

module.exports = {
    token: process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN,
    clientId: process.env.VITE_DISCORD_CLIENT_ID || process.env.DISCORD_CLIENT_ID || '',
    guildId: process.env.VITE_DISCORD_GUILD_ID || process.env.DISCORD_GUILD_ID || '1201193356810780773',
    twitchClientId: process.env.TWITCH_CLIENT_ID || '',
    twitchClientSecret: process.env.TWITCH_CLIENT_SECRET || '',
    
    // IDs Fixos Vortex
    pendingRoleId: '1449514118292967578',
    approvedRoleId: '1201235607549124639',
    logsChannelId: '1497685822525149337',
    recruitmentCategoryId: '1497749211775766538',

    authorizedUserIds: [
        '289227932432334869',
        '761011766440230932',
        '1497703127074345040',
        '1498884908028792942',
        '1201238799494152344',
        ...(process.env.AUTHORIZED_USER_IDS || '').split(',').map(v => v.trim()).filter(Boolean)
    ],
    
    registeredRoleIds: [
        '1201238413676924979',
        ...(process.env.REGISTERED_ROLE_IDS || '').split(',').map(v => v.trim()).filter(Boolean)
    ],
    
    gerenciaRoleIds: [
        '1497703127074345040', // Cargo específico que pode apagar/gerenciar
        '1498884908028792942',
        '1201238413676924979',
        ...(process.env.GERENCIA_ROLE_IDS || '').split(',').map(v => v.trim()).filter(Boolean)
    ]
};
