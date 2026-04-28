/**
 * Scheduler — Sistema de Mensagens Automáticas
 *
 * Suporta:
 *  - Mensagens fixas (bom dia 08h, todo mundo on 18h seg-sex)
 *  - Mensagens personalizadas salvas em scheduled_messages.json
 *
 * Horários em BRT (UTC-3). Verificação a cada 30 segundos.
 */

const fs   = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');

// ─── Constantes fixas ─────────────────────────────────────────────────────────
const CANAL_AUTO_ID    = '11481598629365022800';
const CARGO_MENCAO_ID  = '1497703127074345040'; // cargo para @mencionar nas mensagens fixas
const CARGO_BOM_DIA_ID = '997907219096010874'; // cargo para bom dia
const CARGO_DEV_ID     = '761011766440230932'; // único cargo que pode gerenciar mensagens auto

// Arquivo de persistência das mensagens personalizadas
const MSGS_PATH = path.join(__dirname, '..', 'commands', 'scheduled_messages.json');

// Controle de estado
let schedulerInterval = null;
let lastSentMap = {}; // { "msgId_YYYY-MM-DD_HH:MM": true }

// ─── Helpers de persistência ──────────────────────────────────────────────────
function loadScheduledMessages() {
    try {
        if (fs.existsSync(MSGS_PATH)) {
            return JSON.parse(fs.readFileSync(MSGS_PATH, 'utf8'));
        }
    } catch (err) {
        console.error('[Scheduler] Erro ao carregar mensagens agendadas:', err);
    }
    return { ativo: true, mensagens: [] };
}

function saveScheduledMessages(data) {
    try {
        fs.writeFileSync(MSGS_PATH, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('[Scheduler] Erro ao salvar mensagens agendadas:', err);
    }
}

function isSchedulerAtivo() {
    return loadScheduledMessages().ativo !== false;
}

function setSchedulerAtivo(ativo) {
    const data = loadScheduledMessages();
    data.ativo = ativo;
    saveScheduledMessages(data);
}

/**
 * Adiciona uma nova mensagem agendada personalizada.
 * @param {Object} msg - { id, canal_id, texto, hora, dias, criado_por }
 *   dias: array de números 0-6 (0=Dom, 1=Seg, ..., 6=Sab) ou ["todos"]
 */
function addScheduledMessage(msg) {
    const data = loadScheduledMessages();
    if (!Array.isArray(data.mensagens)) data.mensagens = [];
    data.mensagens.push(msg);
    saveScheduledMessages(data);
}

function removeScheduledMessage(id) {
    const data = loadScheduledMessages();
    data.mensagens = (data.mensagens || []).filter(m => m.id !== id);
    saveScheduledMessages(data);
}

function listScheduledMessages() {
    return loadScheduledMessages().mensagens || [];
}

const TIME_ZONE = 'America/Sao_Paulo';

function capitalize(value) {
    const text = String(value || '');
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function getDisplayDateTime(date = new Date()) {
    return {
        hora: date.toLocaleTimeString('pt-BR', {
            timeZone: TIME_ZONE,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        }),
        data: capitalize(date.toLocaleDateString('pt-BR', {
            timeZone: TIME_ZONE,
            weekday: 'long',
            day: '2-digit',
            month: 'long',
            year: 'numeric',
        })),
    };
}

// ─── Utilitários de tempo ─────────────────────────────────────────────────────
/** Retorna hora e minuto atuais em America/Sao_Paulo */
function getBRTTime() {
    const now = new Date();
    // BRT = UTC - 3h
    const brtMs = now.getTime() - 3 * 60 * 60 * 1000;
    const brt   = new Date(brtMs);
    return {
        hour:    brt.getUTCHours(),
        minute:  brt.getUTCMinutes(),
        weekday: brt.getUTCDay(),   // 0=Dom, 1=Seg, ..., 6=Sab
        dateStr: brt.toISOString().split('T')[0]  // YYYY-MM-DD
    };
}

/** Chave única para controle de envio (evita duplicatas) */
function sentKey(id, dateStr, hora) {
    return `${id}_${dateStr}_${hora}`;
}

/** Verifica se já foi enviado hoje nesse horário */
function alreadySent(id, dateStr, hora) {
    return lastSentMap[sentKey(id, dateStr, hora)] === true;
}

function markSent(id, dateStr, hora) {
    lastSentMap[sentKey(id, dateStr, hora)] = true;
    // Limpa entradas antigas (mantém só os últimos 2 dias)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 2);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    for (const key of Object.keys(lastSentMap)) {
        const parts = key.split('_');
        if (parts[1] && parts[1] < cutoffStr) delete lastSentMap[key];
    }
}

// ─── Embeds fixos ─────────────────────────────────────────────────────────────
function buildBomdiaEmbed() {
    const { hora, data } = getDisplayDateTime(new Date());

    const saudacoes = [
        'Que hoje seja um dia incrível para toda a família **Vortex**! 🌟',
        'Comece o dia com energia e disposição! A **Vortex** conta com você! 💪',
        'Mais um dia para brilhar com a família **Vortex**! ✨',
        'Que esse dia traga muitas conquistas para todos nós! 🏆',
        'Bom dia, família **Vortex**! Vamos fazer desse dia algo especial! 🎯'
    ];
    const saudacao = saudacoes[Math.floor(Math.random() * saudacoes.length)];

    return new EmbedBuilder()
        .setTitle('🌅  Olá, Vortex!')
        .setColor(0xFEE75C)
        .setDescription(
            `### ☀️ Bom dia a todos!\n\n` +
            `> ${saudacao}\n\n` +
            `📅 **${data}** — 🕐 ${hora}\n\n` +
            `<@&${CARGO_BOM_DIA_ID}> — Bom dia a todos os membros! 🎉`
        )
        .setFooter({ text: 'Vortex — Mensagem Automática de Bom Dia' })
        .setTimestamp();
}

function buildTodoMundoOnEmbed() {
    const { hora, data } = getDisplayDateTime(new Date());

    const frases = [
        'Chegou a hora! Vamos reunir a galera e mostrar do que a **Vortex** é capaz! 🔥',
        'É hora de juntar o time! Bora fazer acontecer hoje! 💥',
        'A **Vortex** está online! Venha fazer parte dessa família! 🎮',
        'Hora de reunir a equipe e dominar! Quem está pronto? 🏆',
        'Chamada geral! A **Vortex** está convocando todos para a ação! ⚡'
    ];
    const frase = frases[Math.floor(Math.random() * frases.length)];

    return new EmbedBuilder()
        .setTitle('🟢  Todo Mundo On — Vortex!')
        .setColor(0x57F287)
        .setDescription(
            `### 🎮 Hora de reunir o time!\n\n` +
            `> ${frase}\n\n` +
            `📅 **${data}** — 🕐 ${hora}\n\n` +
            `<@&${CARGO_MENCAO_ID}> — ta na hora de mostrar quem manda na cidade! 🚀`
        )
        .setFooter({ text: 'vamos logar' })
        .setTimestamp();
}

// ─── Envio de mensagens ───────────────────────────────────────────────────────
async function sendToChannel(client, canalId, payload) {
    try {
        const canal = await client.channels.fetch(canalId).catch(() => null);
        if (!canal) {
            console.error(`[Scheduler] Canal ${canalId} não encontrado.`);
            return false;
        }
        await canal.send(payload);
        return true;
    } catch (err) {
        console.error(`[Scheduler] Erro ao enviar no canal ${canalId}:`, err);
        return false;
    }
}

/** Envia a mensagem de bom dia (pode ser chamada manualmente pelo painel) */
async function sendBomdiaMessage(client) {
    const embed = buildBomdiaEmbed();
    return sendToChannel(client, CANAL_AUTO_ID, { embeds: [embed] });
}

/** Envia a mensagem de todo mundo on (pode ser chamada manualmente pelo painel) */
async function sendTodoMundoOnMessage(client) {
    const embed = buildTodoMundoOnEmbed();
    return sendToChannel(client, CANAL_AUTO_ID, { embeds: [embed] });
}

// ─── Loop principal do agendador ──────────────────────────────────────────────
async function runSchedulerTick(client) {
    if (!isSchedulerAtivo()) return;

    const { hour, minute, weekday, dateStr } = getBRTTime();

    // ── Mensagem de Bom Dia — 08:00 BRT todos os dias ──
    if (hour === 8 && minute === 0) {
        const key = 'bomdia';
        if (!alreadySent(key, dateStr, '08:00')) {
            const ok = await sendBomdiaMessage(client);
            if (ok) {
                markSent(key, dateStr, '08:00');
                console.log(`[Scheduler] ✅ Bom dia enviado (${dateStr})`);
            }
        }
    }

    // ── Mensagem Todo Mundo On — 18:00 BRT seg-sex (1-5) ──
    if (hour === 18 && minute === 0 && weekday >= 1 && weekday <= 5) {
        const key = 'todoMundoOn';
        if (!alreadySent(key, dateStr, '18:00')) {
            const ok = await sendTodoMundoOnMessage(client);
            if (ok) {
                markSent(key, dateStr, '18:00');
                console.log(`[Scheduler] ✅ Todo mundo on enviado (${dateStr})`);
            }
        }
    }

    // ── Mensagens personalizadas ──
    const msgs = listScheduledMessages();
    for (const msg of msgs) {
        if (!msg.id || !msg.canal_id || !msg.texto || !msg.hora) continue;

        const [msgHour, msgMin] = msg.hora.split(':').map(Number);
        if (isNaN(msgHour) || isNaN(msgMin)) continue;
        if (hour !== msgHour || minute !== msgMin) continue;

        // Verifica dias da semana
        const diasValidos = Array.isArray(msg.dias) ? msg.dias : [0, 1, 2, 3, 4, 5, 6];
        const todosOsDias = diasValidos.includes('todos') || diasValidos.length === 7;
        if (!todosOsDias && !diasValidos.includes(weekday)) continue;

        const horaKey = msg.hora;
        if (alreadySent(msg.id, dateStr, horaKey)) continue;

        // Monta o payload
        let payload;
        if (msg.embed) {
            const embed = new EmbedBuilder()
                .setColor(msg.cor ? parseInt(msg.cor.replace('#', ''), 16) : 0x5865F2)
                .setDescription(msg.texto)
                .setFooter({ text: 'Vortex — Mensagem Automática' })
                .setTimestamp();
            payload = { embeds: [embed] };
        } else {
            payload = { content: msg.texto };
        }

        const ok = await sendToChannel(client, msg.canal_id, payload);
        if (ok) {
            markSent(msg.id, dateStr, horaKey);
            console.log(`[Scheduler] ✅ Mensagem personalizada "${msg.id}" enviada (${dateStr} ${horaKey})`);
        }
    }
}

// ─── Inicialização ────────────────────────────────────────────────────────────
function startScheduler(client) {
    if (schedulerInterval) clearInterval(schedulerInterval);

    // Garante que o arquivo de mensagens existe
    if (!fs.existsSync(MSGS_PATH)) {
        saveScheduledMessages({ ativo: true, mensagens: [] });
    }

    console.log('[Scheduler] ✅ Agendador iniciado.');
    console.log('[Scheduler] Bom dia: 08:00 BRT | Todo mundo on: 18:00 BRT (seg-sex)');

    schedulerInterval = setInterval(() => runSchedulerTick(client), 30 * 1000);
    return schedulerInterval;
}

function stopScheduler() {
    if (schedulerInterval) {
        clearInterval(schedulerInterval);
        schedulerInterval = null;
        console.log('[Scheduler] Parado.');
    }
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
    startScheduler,
    stopScheduler,
    sendBomdiaMessage,
    sendTodoMundoOnMessage,
    buildBomdiaEmbed,
    buildTodoMundoOnEmbed,
    addScheduledMessage,
    removeScheduledMessage,
    listScheduledMessages,
    isSchedulerAtivo,
    setSchedulerAtivo,
    CANAL_AUTO_ID,
    CARGO_MENCAO_ID,
    CARGO_BOM_DIA_ID,
    CARGO_DEV_ID
};
