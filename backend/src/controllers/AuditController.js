const prisma = require('../lib/prisma').default;
const { ipDoRequest } = require('../lib/auditoria');

class AuditController {
  async registrar(req, res) {
    const { userId, userName, email, action, empresaId } = req.body;

    try {
      // IP derivado do request (respeita trust proxy) — nunca do corpo, evitando
      // spoofing. INSERT via SQL para funcionar mesmo antes do prisma generate.
      await prisma.$executeRawUnsafe(
        `INSERT INTO schs2vet.tb_audit_logs ("userId", "userName", "email", "action", "empresaId", "ip")
         VALUES ($1, $2, $3, $4, $5, $6)`,
        userId ?? null,
        userName ?? '',
        email ?? '',
        action ?? '',
        empresaId ? Number(empresaId) : null,
        ipDoRequest(req),
      );
      res.status(201).json({ sucesso: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao registrar auditoria' });
    }
  }

  // GET /api/audit/logs — tela de Auditoria (módulo Geral)
  // ADMIN: todos os logs (filtro ?empresaId= opcional).
  // GESTOR/dono de empresa: apenas os logs da empresa ativa (req.empresaId).
  // Demais perfis: 403.
  // Filtros: ?categoria=EXCLUSAO|CANCELAMENTO, ?entidade=, ?busca=, ?dataInicio=, ?dataFim=, ?page=, ?limit=
  async listar(req, res) {
    try {
      const user = req.user;
      const { categoria, entidade, busca, dataInicio, dataFim } = req.query;
      const page  = Math.max(1, parseInt(req.query.page ?? '1', 10) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit ?? '50', 10) || 50));

      let empresaScope;
      if (user.userType === 'ADMIN') {
        empresaScope = req.query.empresaId ? Number(req.query.empresaId) : undefined;
      } else {
        const empresaId = req.empresaId;
        if (!empresaId) return res.status(403).json({ error: 'Sem empresa ativa.' });
        const [dono, gestor] = await Promise.all([
          prisma.empresa.findFirst({ where: { id: empresaId, ownerId: user.id }, select: { id: true } }),
          prisma.membroEquipe.findFirst({
            where: { userId: user.id, cargo: 'GESTOR', equipe: { empresaId } },
            select: { id: true },
          }),
        ]);
        if (!dono && !gestor) {
          return res.status(403).json({ error: 'Apenas gestores podem visualizar a auditoria.' });
        }
        empresaScope = empresaId;
      }

      const where = {
        ...(empresaScope !== undefined && { empresaId: empresaScope }),
        ...(categoria && { categoria: String(categoria) }),
        ...(entidade  && { entidade:  String(entidade)  }),
        ...(busca && {
          OR: [
            { motivo:   { contains: String(busca), mode: 'insensitive' } },
            { detalhes: { contains: String(busca), mode: 'insensitive' } },
            { userName: { contains: String(busca), mode: 'insensitive' } },
            { action:   { contains: String(busca), mode: 'insensitive' } },
          ],
        }),
        ...((dataInicio || dataFim) && {
          timestamp: {
            ...(dataInicio && { gte: new Date(String(dataInicio)) }),
            ...(dataFim    && { lte: new Date(`${String(dataFim)}T23:59:59.999`) }),
          },
        }),
      };

      const [total, logs] = await Promise.all([
        prisma.auditLog.count({ where }),
        prisma.auditLog.findMany({
          where,
          orderBy: { timestamp: 'desc' },
          skip:    (page - 1) * limit,
          take:    limit,
        }),
      ]);

      res.json({ dados: logs, meta: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) } });
    } catch (error) {
      console.error('AuditController.listar:', error);
      res.status(500).json({ error: 'Erro ao listar auditoria' });
    }
  }
}

module.exports = new AuditController();
