const fs   = require('fs');
const path = require('path');
const { sendStaffLog, sendUpdateLog } = require('./notifications');
const config = require('../config/config');

const MAINTENANCE_PATH = path.join(__dirname, '..', 'commands', 'config.json');

// Cargos que recebem DM e são mencionados no log
const STAFF_ROLE_IDS = [
    '1497703127074345040'
];

// Helpers de config
function loadConfig() {
    try {
        if (fs.existsSync(MAINTENANCE_PATH)) {
            return JSON.parse(fs.readFileSync(MAINTENANCE_PATH, 'utf8'));
        }
    } catch (err) {
        console.error('[Maintenance] Erro ao carregar config:', err);
    }
    return {};
}

function saveConfig(data) {
    try {
        fs.writeFileSync(MAINTENANCE_PATH, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('[Maintenance] Erro ao salvar config:', err);
    }
}

// Estado de manutenção
function isMaintenanceMode() {
    return loadConfig().MAINTENANCE_MODE === true;
}

function enableMaintenance(activatedBy = null) {
    const cfg = loadConfig();
    cfg.MAINTENANCE_MODE          = true;
    cfg.MAINTENANCE_ACTIVATED_BY  = activatedBy;
    cfg.MAINTENANCE_ACTIVATED_AT  = new Date().toISOString();
    saveConfig(cfg);
}

function disableMaintenance(deactivatedBy = null) {
    const cfg = loadConfig();
    cfg.MAINTENANCE_MODE            = false;
    cfg.MAINTENANCE_DEACTIVATED_BY  = deactivatedBy;
    cfg.MAINTENANCE_DEACTIVATED_AT  = new Date().toISOString();
    saveConfig(cfg);
}

/**
 * Verifica se um membro possui pelo menos um dos cargos de staff.
 */
function isStaffMember(member) {
    if (!member) return false;
    return STAFF_ROLE_IDS.some(roleId => member.roles.cache.has(roleId));
}

// Notificações

/**
 * Envia DM para membros da staff.
 */
async function notifyAllStaffMembers(client, guild, responsavelId, ativando = true) {
    const { EmbedBuilder } = require('discord.js');

    let members;
    try {
        members = await guild.members.fetch();
    } catch (err) {
        console.error('[Maintenance] Erro ao buscar membros:', err);
        return { enviados: 0, falhas: 0 };
    }

    const staffMembers = members.filter(m =>
        !m.user.bot &&
        STAFF_ROLE_IDS.some(roleId => m.roles.cache.has(roleId))
    );

    const titulo = ativando
        ? '🔧 Bot em Modo Manutenção — Vortex'
        : '✅ Bot Voltou ao Normal — Vortex';

    const descricao = ativando
        ? `O bot da **Vortex** foi colocado em **modo de manutenção** por <@${responsavelId}>.\n\n` +
          `> ⚠️ Todos os comandos e botões estão temporariamente **bloqueados** para usuários sem cargo de staff.\n\n` +
          `**Ativado em:** <t:${Math.floor(Date.now() / 1000)}:F>`
        : `O bot da **Vortex** voltou a operar **normalmente**. O modo de manutenção foi desativado por <@${responsavelId}>.\n\n` +
          `> ✅ Todos os comandos e botões estão disponíveis novamente.\n\n` +
          `**Desativado em:** <t:${Math.floor(Date.now() / 1000)}:F>`;

    const cor = ativando ? '#ED4245' : '#57F287';

    let enviados = 0;
    let falhas   = 0;

    for (const [, member] of staffMembers) {
        try {
            const embed = new EmbedBuilder()
                .setColor(cor)
                .setTitle(titulo)
                .setDescription(descricao)
                .addFields(
                    { name: '🏠 Servidor',   value: guild.name,              inline: true },
                    { name: '👤 Responsável', value: `<@${responsavelId}>`,  inline: true }
                )
                .setThumbnail(guild.iconURL({ dynamic: true }) || client.user.displayAvatarURL())
                .setFooter({ text: 'Vortex Management System • Alerta de Manutenção' })
                .setTimestamp();

            await member.send({ embeds: [embed] });
            enviados++;
        } catch {
            falhas++;
        }
    }

    return { enviados, falhas };
}

/**
 * Envia log detalhado no canal de logs usando a central Vortex.
 */
async function sendMaintenanceLog(client, guild, responsavelId, ativando = true) {
    const titulo = ativando ? 'Modo Manutenção ATIVADO' : 'Modo Manutenção DESATIVADO';
    const cor = ativando ? '#ED4245' : '#57F287';
    
    const mencoes = STAFF_ROLE_IDS.map(id => `<@&${id}>`).join(' ');
    const avisoTexto = ativando
        ? `${mencoes}\n⚠️ **ATENÇÃO: O bot está em manutenção! Comandos e botões bloqueados para usuários comuns.**`
        : `${mencoes}\n✅ **O bot voltou ao normal! Todos os comandos estão disponíveis.**`;

    const descricao = ativando
        ? `O modo de manutenção foi **ativado** no servidor **${guild.name}**.\n\n` +
          `**Responsável:** <@${responsavelId}>\n` +
          `**Horário:** <t:${Math.floor(Date.now() / 1000)}:F>\n\n` +
          `> ⚠️ Todos os comandos e botões estão **bloqueados** para usuários sem cargo de staff.`
        : `O modo de manutenção foi **desativado** no servidor **${guild.name}**.\n\n` +
          `**Responsável:** <@${responsavelId}>\n` +
          `**Horário:** <t:${Math.floor(Date.now() / 1000)}:F>\n\n` +
          `> ✅ O bot voltou a operar normalmente para todos os usuários.`;

    await sendStaffLog(client, titulo, avisoTexto + '\n\n' + descricao, cor);
}

/**
 * Envia alerta manual para os devs via DM.
 */
async function sendMaintenanceAlert(client, responsavelId, message = null) {
    const { EmbedBuilder } = require('discord.js');
    const alertMsg = message || `⚠️ O modo de manutenção foi **ativado** por <@${responsavelId}>.`;
    const DEV_IDS = ['289227932432334869', '761011766440230932', '1426287249020158018'];

    for (const userId of DEV_IDS) {
        try {
            const user = await client.users.fetch(userId).catch(() => null);
            if (!user) continue;
            const embed = new EmbedBuilder()
                .setColor('#FF6B00')
                .setTitle('🚨 Alerta de Manutenção — Vortex')
                .setDescription(alertMsg)
                .setFooter({ text: 'Vortex Management System' })
                .setTimestamp();
            await user.send({ embeds: [embed] });
        } catch {}
    }
}

module.exports = {
    isMaintenanceMode,
    enableMaintenance,
    disableMaintenance,
    isStaffMember,
    notifyAllStaffMembers,
    sendMaintenanceLog,
    sendMaintenanceAlert,
    STAFF_ROLE_IDS
};
