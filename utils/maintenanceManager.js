const fs   = require('fs');
const path = require('path');

const MAINTENANCE_PATH = path.join(__dirname, '..', 'commands', 'config.json');

// ─── Cargos que recebem DM e são mencionados no log ───────────────────────────
const STAFF_ROLE_IDS = [
    '1497703127074345040'
];

// Canal de logs principal
const LOG_CHANNEL_ID = '1497685822525149337';

// ─── Helpers de config ────────────────────────────────────────────────────────
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

// ─── Estado de manutenção ─────────────────────────────────────────────────────
function isMaintenanceMode() {
    return loadConfig().MAINTENANCE_MODE === true;
}

function enableMaintenance(activatedBy = null) {
    const config = loadConfig();
    config.MAINTENANCE_MODE          = true;
    config.MAINTENANCE_ACTIVATED_BY  = activatedBy;
    config.MAINTENANCE_ACTIVATED_AT  = new Date().toISOString();
    saveConfig(config);
}

function disableMaintenance(deactivatedBy = null) {
    const config = loadConfig();
    config.MAINTENANCE_MODE            = false;
    config.MAINTENANCE_DEACTIVATED_BY  = deactivatedBy;
    config.MAINTENANCE_DEACTIVATED_AT  = new Date().toISOString();
    saveConfig(config);
}

/**
 * Verifica se um membro possui pelo menos um dos cargos de staff.
 * Usado para liberar o uso do bot durante a manutenção.
 */
function isStaffMember(member) {
    if (!member) return false;
    return STAFF_ROLE_IDS.some(roleId => member.roles.cache.has(roleId));
}

// ─── Notificações ─────────────────────────────────────────────────────────────

/**
 * Envia DM para TODOS os membros do servidor que possuem pelo menos um dos
 * cargos de staff definidos em STAFF_ROLE_IDS.
 * Retorna { enviados, falhas }
 */
async function notifyAllStaffMembers(client, guild, responsavelId, ativando = true) {
    const { EmbedBuilder } = require('discord.js');

    // Força o fetch completo dos membros
    let members;
    try {
        members = await guild.members.fetch();
    } catch (err) {
        console.error('[Maintenance] Erro ao buscar membros:', err);
        return { enviados: 0, falhas: 0 };
    }

    // Filtra apenas membros (não bots) que possuem pelo menos um cargo de staff
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

    const cor = ativando ? 0xED4245 : 0x57F287;

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
                .setThumbnail(guild.iconURL({ dynamic: true }) || 'https://cdn-icons-png.flaticon.com/512/2920/2920349.png')
                .setFooter({ text: 'Vortex Management System • Alerta de Manutenção' })
                .setTimestamp();

            await member.send({ embeds: [embed] });
            enviados++;
        } catch {
            falhas++;
        }
    }

    console.log(`[Maintenance] DMs enviadas: ${enviados} sucesso, ${falhas} falha(s).`);
    return { enviados, falhas };
}

/**
 * Envia log detalhado no canal de logs com menção a TODOS os cargos de staff.
 */
async function sendMaintenanceLog(client, guild, responsavelId, ativando = true) {
    const { EmbedBuilder } = require('discord.js');

    try {
        const canal = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
        if (!canal) {
            console.warn('[Maintenance] Canal de log não encontrado:', LOG_CHANNEL_ID);
            return;
        }

        const titulo = ativando
            ? '🔧 Modo Manutenção ATIVADO'
            : '✅ Modo Manutenção DESATIVADO';

        const cor = ativando ? 0xED4245 : 0x57F287;

        const embed = new EmbedBuilder()
            .setColor(cor)
            .setTitle(titulo)
            .setDescription(
                ativando
                    ? `O modo de manutenção foi **ativado** no servidor **${guild.name}**.\n\n` +
                      `> ⚠️ Todos os comandos e botões estão **bloqueados** para usuários sem cargo de staff até que a manutenção seja desativada.`
                    : `O modo de manutenção foi **desativado** no servidor **${guild.name}**.\n\n` +
                      `> ✅ O bot voltou a operar normalmente para todos os usuários.`
            )
            .addFields(
                { name: '👤 Responsável', value: `<@${responsavelId}> (\`${responsavelId}\`)`, inline: true },
                { name: '🕐 Horário',     value: `<t:${Math.floor(Date.now() / 1000)}:F>`,      inline: true },
                { name: '🏠 Servidor',    value: guild.name,                                    inline: true }
            )
            .setFooter({ text: 'Vortex Management System • Log de Manutenção' })
            .setTimestamp();

        // Monta a string de menções de todos os cargos de staff
        const mencoes = STAFF_ROLE_IDS.map(id => `<@&${id}>`).join(' ');

        const avisoTexto = ativando
            ? `${mencoes}\n⚠️ **ATENÇÃO: O bot está em manutenção! Comandos e botões bloqueados para usuários comuns.**`
            : `${mencoes}\n✅ **O bot voltou ao normal! Todos os comandos estão disponíveis.**`;

        await canal.send({ content: avisoTexto, embeds: [embed] });
    } catch (err) {
        console.error('[Maintenance] Erro ao enviar log:', err);
    }
}

/**
 * Envia alerta manual para os devs via DM (botão "Enviar Alerta para Devs" no painel).
 */
async function sendMaintenanceAlert(client, responsavelId, message = null) {
    const { EmbedBuilder } = require('discord.js');
    const alertMsg = message || `⚠️ O modo de manutenção foi **ativado** por <@${responsavelId}>.`;

    // Notifica todos os membros com cargo de staff via DM (reutiliza a função principal)
    // Esta função é chamada apenas para alertas manuais, sem guild disponível
    // Então notificamos apenas os devs fixos
    const DEV_IDS = ['289227932432334869', '761011766440230932', '1426287249020158018'];
    for (const userId of DEV_IDS) {
        try {
            const user = await client.users.fetch(userId).catch(() => null);
            if (!user) continue;
            const embed = new EmbedBuilder()
                .setColor('#FF6B00')
                .setTitle('🚨 Alerta de Manutenção')
                .setDescription(alertMsg)
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
    STAFF_ROLE_IDS,
    LOG_CHANNEL_ID
};
