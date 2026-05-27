import { Router } from 'express';
import { listAbsences } from '../services/absences.js';
import { toCsv } from '../services/reports.js';

export const absencesRouter = Router();

function readQuery(req: any) {
  return {
    guildId: String(req.query.guildId || ''),
    status: String(req.query.status || 'all'),
    search: String(req.query.search || ''),
    from: String(req.query.from || ''),
    to: String(req.query.to || ''),
    limit: Number(req.query.limit || 200)
  };
}

absencesRouter.get('/export', async (req, res) => {
  try {
    const data = await listAbsences({ ...readQuery(req), limit: 500 });
    const rows = data.records.map((absence) => ({
      membro: absence.member_name,
      discord_id: absence.discord_user_id,
      status: absence.status,
      inicio: absence.starts_at || '',
      retorno: absence.ends_at || '',
      dias: absence.period_days,
      motivo: absence.reason || '',
      solicitado_em: absence.created_at || '',
      aceito_por: absence.approved_by_name || absence.approved_by_id || '',
      aceito_em: absence.approved_at || '',
      recusado_por: absence.rejected_by_name || absence.rejected_by_id || '',
      recusado_em: absence.rejected_at || '',
      finalizado_em: absence.finished_at || absence.removed_at || ''
    }));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="ausencias.csv"');
    return res.send(toCsv(rows));
  } catch (error) {
    console.warn('[frequency-api] Exportacao de ausencias indisponivel:', error);
    return res.status(503).send('');
  }
});

absencesRouter.get('/', async (req, res) => {
  try {
    const data = await listAbsences(readQuery(req));
    return res.json({ ok: true, ...data });
  } catch (error) {
    console.warn('[frequency-api] Lista de ausencias indisponivel:', error);
    return res.json({
      ok: true,
      metrics: { total: 0, active: 0, scheduled: 0, pending: 0, approved: 0 },
      active: [],
      records: []
    });
  }
});
