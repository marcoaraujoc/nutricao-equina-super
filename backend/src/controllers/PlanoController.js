// backend/src/controllers/PlanoController.js
//
// CRUD dos PLANOS do SaaS (tb_planos) — catálogo GLOBAL da plataforma, gerido só pelo
// ADMIN. Não é de empresa nenhuma (SEM RLS), então roda com o prisma normal.
//
// Um plano tem: nome, VALOR (precoMensal), LIMITE de usuários (assentos) e VALIDADE em
// dias. O limite é o que separa os três níveis pedidos:
//   "Até 3 pessoas"     → limiteUsuarios = 3
//   "Até 10 pessoas"    → limiteUsuarios = 10
//   "Mais que 10"       → limiteUsuarios = null (ilimitado)  ⚠️ null = ILIMITADO, não zero.
'use strict';

const prisma = require('../lib/prisma').default;

// slug estável a partir do nome (o schema exige slug único). Só para a chave interna —
// a tela mostra o `nome`.
function gerarSlug(nome) {
  return String(nome).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'plano';
}

// Normaliza a entrada: valor/limite/validade aceitam vazio (null). Limite e validade,
// quando informados, são inteiros ≥ 0/≥ 1.
function normalizar(body) {
  const nome = String(body.nome ?? '').trim();
  if (!nome) return { erro: 'Nome do plano é obrigatório.' };

  const numOuNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
  const precoMensal = numOuNull(body.precoMensal ?? body.valor);
  const limiteUsuarios = numOuNull(body.limiteUsuarios);
  const validadeDias = numOuNull(body.validadeDias ?? body.validade);

  if (precoMensal !== null && (!Number.isFinite(precoMensal) || precoMensal < 0))
    return { erro: 'Valor inválido.' };
  if (limiteUsuarios !== null && (!Number.isInteger(limiteUsuarios) || limiteUsuarios < 0))
    return { erro: 'Limite de usuários inválido (use um inteiro ≥ 0, ou deixe vazio para ilimitado).' };
  if (validadeDias !== null && (!Number.isInteger(validadeDias) || validadeDias < 1))
    return { erro: 'Validade inválida (use dias ≥ 1, ou deixe vazio para sem validade).' };

  return {
    dados: {
      nome,
      precoMensal,
      limiteUsuarios,
      validadeDias,
      ativo: body.ativo === undefined ? true : Boolean(body.ativo),
      ordem: Number.isInteger(Number(body.ordem)) ? Number(body.ordem) : 0,
    },
  };
}

const SELECT = {
  id: true, slug: true, nome: true, precoMensal: true,
  limiteUsuarios: true, limiteAnimais: true, validadeDias: true, ativo: true, ordem: true,
};

const PlanoController = {
  // GET /api/planos  — ADMIN vê todos; ?ativos=1 filtra os ativos (para o seletor da empresa)
  listar: async (req, res) => {
    try {
      const where = req.query.ativos === '1' ? { ativo: true } : {};
      const planos = await prisma.plano.findMany({ where, orderBy: [{ ordem: 'asc' }, { id: 'asc' }], select: SELECT });
      res.json({ sucesso: true, dados: planos });
    } catch (err) {
      console.error('[PlanoController.listar]', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao listar planos' });
    }
  },

  // POST /api/planos  — ADMIN cria
  criar: async (req, res) => {
    try {
      const { erro, dados } = normalizar(req.body);
      if (erro) return res.status(400).json({ sucesso: false, mensagem: erro });

      // slug único: se colidir, sufixa. Nome pode repetir; slug não.
      let slug = gerarSlug(dados.nome);
      if (await prisma.plano.findUnique({ where: { slug } })) slug = `${slug}-${Date.now().toString(36)}`;

      const plano = await prisma.plano.create({ data: { ...dados, slug }, select: SELECT });
      res.status(201).json({ sucesso: true, dados: plano });
    } catch (err) {
      console.error('[PlanoController.criar]', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao criar plano' });
    }
  },

  // PUT /api/planos/:id  — ADMIN edita
  atualizar: async (req, res) => {
    try {
      const id = Number(req.params.id);
      const existe = await prisma.plano.findUnique({ where: { id }, select: { id: true } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Plano não encontrado' });

      const { erro, dados } = normalizar(req.body);
      if (erro) return res.status(400).json({ sucesso: false, mensagem: erro });

      const plano = await prisma.plano.update({ where: { id }, data: dados, select: SELECT });
      res.json({ sucesso: true, dados: plano });
    } catch (err) {
      console.error('[PlanoController.atualizar]', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao atualizar plano' });
    }
  },

  // PATCH /api/planos/:id/toggle  — ativa/inativa o plano no catálogo
  toggle: async (req, res) => {
    try {
      const id = Number(req.params.id);
      const p = await prisma.plano.findUnique({ where: { id }, select: { ativo: true } });
      if (!p) return res.status(404).json({ sucesso: false, mensagem: 'Plano não encontrado' });
      const plano = await prisma.plano.update({ where: { id }, data: { ativo: !p.ativo }, select: SELECT });
      res.json({ sucesso: true, dados: plano });
    } catch (err) {
      console.error('[PlanoController.toggle]', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao alterar o plano' });
    }
  },
};

module.exports = PlanoController;
