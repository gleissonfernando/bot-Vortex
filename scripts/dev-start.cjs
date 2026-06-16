process.env.NODE_ENV ||= 'development';
process.env.PORT ||= '3000';
process.env.INTERNAL_API_PORT ||= '4100';
process.env.WEB_INTERNAL_PORT ||= '3001';
process.env.START_DISCORD_BOT ||= 'false';
process.env.BUILD_API_ON_STARTUP ||= 'false';
process.env.BUILD_WEB_ON_STARTUP ||= 'false';
process.env.REQUIRE_BUILT_ASSETS ||= 'false';

require('../shardcloud-start');
