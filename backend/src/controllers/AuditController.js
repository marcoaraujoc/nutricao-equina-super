const prisma = require('../lib/prisma').default;
const { aplicarVinculoEmLista } = require('../lib/usuarioEmpresa');

// De qual cadastro sai o NOME do registro que a ação atingiu. `AuditLog.entidadeId`
// é solto (sem FK — o log sobrevive à exclusão do registro), então não há include a
// fazer: resolve-se por tipo, com os ids DA PÁGINA, do mesmo jeito que `animalNome`.
// ⚠️ Entidade que não está aqui devolve `alvoNome: null` e a tela não mostra nada —
// nunca um palpite. Entidade nova (um cadastro novo, por exemplo) entra nesta tabela.
const FONTE_DO_ALVO = {
  USUARIO:      'user',
  PROPRIETARIO: 'user',
  FORNECEDOR:   'fornecedor',
  PRESTADOR:    'prestador',
  TRATADOR:     'tratador',
  ANIMAL:       'animal',
};

class AuditController {
  // ⚠️ `registrar` REMOVIDO em 2026-08-05 junto com a rota pública `POST /api/audit/log`.
  // Ele aceitava usuário, ação e empresa do CORPO da requisição, sem autenticação — ou
  // seja, permitia forjar auditoria. Quem grava LOGIN/LOGOUT agora é o servidor, via
  // `registrarAcesso` (lib/auditoria.js). Não recriar: escrita de auditoria não vem do
  // cliente. Ver docs/MULTI-TENANCY-PLANO.md §10.7.

  // GET /api/audit/logs — tela de Auditoria (módulo Geral)
  // ADMIN: todos os logs (filtro ?empresaId= opcional).
  // GESTOR/dono de empresa: apenas os logs da empresa ativa (req.empresaId).
  // Demais perfis: 403.
  // Filtros: ?categoria=EXCLUSAO|CANCELAMENTO|INATIVACAO|ATIVACAO|AJUSTE|CONFIGURACAO|TRANSFERENCIA|ALTERACAO|CRIACAO|EXECUCAO|ACESSO_NEGADO,
  //          ?entidade=, ?busca=, ?dataInicio=, ?dataFim=, ?page=, ?limit=
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

      // Busca por NOME DO PACIENTE: `AuditLog.animalId` é solto (sem FK), então não dá
      // para filtrar por relação. Resolve-se antes — os ids dos animais cujo nome casa
      // com o termo — e o resultado entra no OR junto dos campos de texto.
      // Escopado à empresa quando há uma (o ADMIN sem `empresaId` busca em todas), senão
      // um nome comum traria o animal de outra clínica para dentro do filtro.
      let animalIdsBusca = [];
      if (busca) {
        const animaisEncontrados = await prisma.animal.findMany({
          where: {
            nome: { contains: String(busca), mode: 'insensitive' },
            ...(empresaScope !== undefined && { empresaId: empresaScope }),
          },
          select: { id: true },
          take: 500,
        });
        animalIdsBusca = animaisEncontrados.map(a => a.id);
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
            ...(animalIdsBusca.length > 0 ? [{ animalId: { in: animalIdsBusca } }] : []),
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

      // Nome do paciente para a tela: `AuditLog.animalId` é solto (sem FK — o log
      // sobrevive à exclusão do animal), então não há include a fazer. Uma consulta
      // extra pelos ids DA PÁGINA resolve, em vez de uma por linha.
      // O animal excluído de vez fica sem nome: `animalNome` vem null e a tela cai no
      // id — perder a referência seria pior do que mostrá-la crua.
      const animalIds = [...new Set(logs.map(l => l.animalId).filter(id => id != null))];
      const animais = animalIds.length > 0
        ? await prisma.animal.findMany({ where: { id: { in: animalIds } }, select: { id: true, nome: true } })
        : [];
      const nomePorId = new Map(animais.map(a => [a.id, a.nome]));

      // Nome do REGISTRO ALVO — QUEM/O QUE a ação atingiu. Sem isto a linha dizia só
      // quem executou (coluna Usuário): "Fulana inativou" sem dizer inativou quem.
      // O texto de `detalhes` já trazia o nome, mas ele só aparece no modal Visualizar.
      const idsPorFonte = new Map();
      for (const l of logs) {
        const fonte = l.entidade ? FONTE_DO_ALVO[l.entidade] : null;
        if (!fonte || l.entidadeId == null) continue;
        if (!idsPorFonte.has(fonte)) idsPorFonte.set(fonte, new Set());
        idsPorFonte.get(fonte).add(l.entidadeId);
      }

      // Chave `fonte:id` — o mesmo id existe em cadastros diferentes, e um mapa só
      // por id faria o tratador nº 7 aparecer como nome do fornecedor nº 7.
      const alvoPorChave = new Map();
      await Promise.all([...idsPorFonte].map(async ([fonte, set]) => {
        const ids = [...set];
        if (fonte === 'user') {
          // §36: o nome do usuário é POR EMPRESA — lê-se o vínculo da empresa do
          // escopo, nunca o `users.fullName` cru (que é a cópia da criação da conta).
          // O ADMIN da plataforma não tem empresa no escopo e cai no cadastro global.
          const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, ativo: true } });
          const comVinculo = empresaScope !== undefined ? await aplicarVinculoEmLista(users, empresaScope) : users;
          for (const u of comVinculo) alvoPorChave.set(`user:${u.id}`, u.fullName || null);
          return;
        }
        const registros = await prisma[fonte].findMany({ where: { id: { in: ids } }, select: { id: true, nome: true } });
        for (const r of registros) alvoPorChave.set(`${fonte}:${r.id}`, r.nome || null);
      }));

      const dados = logs.map(l => {
        const fonte = l.entidade ? FONTE_DO_ALVO[l.entidade] : null;
        return {
          ...l,
          animalNome: l.animalId != null ? (nomePorId.get(l.animalId) ?? null) : null,
          // Registro já excluído de vez fica sem nome: a tela mostra "excluído" em vez
          // de deixar a linha muda sobre quem foi atingido.
          alvoNome: fonte && l.entidadeId != null
            ? (alvoPorChave.get(`${fonte}:${l.entidadeId}`) ?? null)
            : null,
        };
      });

      res.json({ dados, meta: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) } });
    } catch (error) {
      console.error('AuditController.listar:', error);
      res.status(500).json({ error: 'Erro ao listar auditoria' });
    }
  }
}

module.exports = new AuditController();
