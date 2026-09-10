// backend/src/controllers/NutrientesController.js
//
// CATÁLOGO MISTO desde 2026-09-09 (migration `20261004000000`): `empresaId` nulo é o
// nutriente GLOBAL do sistema (todos leem, só o ADMIN escreve) e `empresaId` setado é o
// que a clínica cadastrou — dela, e só dela. Quem filtra a LEITURA é o RLS; o que mora
// aqui é a resposta legível de quem tenta escrever no que não é seu.

const prisma = require('../lib/prisma').default;
const { registrarAuditoria } = require('../lib/auditoria');
const {
  empresaDoNovoItem, noEscopoDeEscrita, bloqueioDeEscrita, bloqueioDeUso,
  marcarOrigem, marcarOrigemEmLista, EXIGE_EMPRESA,
} = require('../lib/catalogoNutricional');

class NutrientesController {
  async listar(req, res) {
    try {
      // O RLS já entrega global + próprio. `doSistema` é o que a tela usa para não
      // oferecer editar/excluir naquilo que ela não pode alterar (antipadrão 28-d).
      const nutrientes = await prisma.nutriente.findMany({ orderBy: { nome: 'asc' } });
      res.json(marcarOrigemEmLista(nutrientes));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao listar nutrientes' });
    }
  }

  async obterPorId(req, res) {
    const { id } = req.params;
    try {
      const nutriente = await prisma.nutriente.findUnique({ where: { id: Number(id) } });
      if (!nutriente) return res.status(404).json({ error: 'Nutriente não encontrado' });
      res.json(marcarOrigem(nutriente));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao buscar nutriente' });
    }
  }

  async criar(req, res) {
    const { nome, categoria, unidadePadrao } = req.body;

    if (!String(nome ?? '').trim())          return res.status(400).json({ error: 'Nome é obrigatório' });
    if (!String(categoria ?? '').trim())     return res.status(400).json({ error: 'Categoria é obrigatória' });
    if (!String(unidadePadrao ?? '').trim()) return res.status(400).json({ error: 'Unidade padrão é obrigatória' });

    // ADMIN da plataforma cria no catálogo GLOBAL; a clínica cria o nutriente DELA.
    const empresaId = empresaDoNovoItem(req);
    if (empresaId === undefined) return res.status(EXIGE_EMPRESA.status).json(EXIGE_EMPRESA.corpo);

    try {
      const nutriente = await noEscopoDeEscrita(req, empresaId == null, () =>
        prisma.nutriente.create({
          data: {
            nome:          String(nome).trim(),
            categoria:     String(categoria).trim(),
            unidadePadrao: String(unidadePadrao).trim(),
            empresaId,
          },
        }));
      res.status(201).json(marcarOrigem(nutriente));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao criar nutriente' });
    }
  }

  async atualizar(req, res) {
    const { id } = req.params;
    const { nome, categoria, unidadePadrao } = req.body;
    try {
      const existe = await prisma.nutriente.findUnique({ where: { id: Number(id) } });
      if (!existe) return res.status(404).json({ error: 'Nutriente não encontrado' });

      const barrado = bloqueioDeEscrita(req, existe, 'nutriente');
      if (barrado) return res.status(barrado.status).json({ ...barrado.corpo, error: barrado.corpo.mensagem });

      const nutriente = await noEscopoDeEscrita(req, existe.empresaId == null, () =>
        prisma.nutriente.update({
          where: { id: Number(id) },
          data: { nome, categoria, unidadePadrao },
        }));
      res.json(marcarOrigem(nutriente));
    } catch (error) {
      if (error.code === 'P2025') return res.status(404).json({ error: 'Nutriente não encontrado' });
      console.error(error);
      res.status(500).json({ error: 'Erro ao atualizar nutriente' });
    }
  }

  // 🔴 EXCLUSÃO DE VERDADE — o nutriente sai do banco (decisão de 2026-09-09).
  //
  // ⚠️ Aqui a COMPOSIÇÃO conta como USO e BLOQUEIA, ao contrário do que acontece em
  // `AlimentoController.excluir`, onde ela é apagada junto. A diferença não é
  // arbitrária: a composição pertence ao ALIMENTO ("quanto deste nutriente há neste
  // alimento") e some com ele; em relação ao NUTRIENTE ela é referência de terceiros —
  // apagá-la em cascata tiraria, em silêncio, um nutriente da ficha de N alimentos que
  // podem nem ser desta clínica.
  async excluir(req, res) {
    const { id } = req.params;
    const { motivo } = req.body ?? {};
    if (!motivo?.trim()) {
      return res.status(400).json({ error: 'É obrigatório informar o motivo da exclusão' });
    }

    try {
      const existe = await prisma.nutriente.findUnique({ where: { id: Number(id) } });
      if (!existe) return res.status(404).json({ error: 'Nutriente não encontrado' });

      const barrado = bloqueioDeEscrita(req, existe, 'nutriente');
      if (barrado) return res.status(barrado.status).json({ ...barrado.corpo, error: barrado.corpo.mensagem });

      const [emComposicoes, emExames, emExigencias] = await Promise.all([
        prisma.composicaoAlimento.count({ where: { nutrienteId: Number(id) } }),
        prisma.exameNutricional.count({ where: { nutrienteId: Number(id) } }),
        prisma.exigenciasNRC.count({ where: { nutrienteId: Number(id) } }),
      ]);

      const emUso = bloqueioDeUso([
        { quantidade: emComposicoes, singular: 'composição de alimento', plural: 'composições de alimento' },
        { quantidade: emExames,      singular: 'exame nutricional',      plural: 'exames nutricionais' },
        { quantidade: emExigencias,  singular: 'exigência NRC',          plural: 'exigências NRC' },
      ], 'nutriente');
      if (emUso) return res.status(emUso.status).json({ ...emUso.corpo, error: emUso.corpo.mensagem });

      await noEscopoDeEscrita(req, existe.empresaId == null, () =>
        prisma.nutriente.delete({ where: { id: Number(id) } }));

      await registrarAuditoria(null, req, {
        categoria:  'EXCLUSAO',
        entidade:   'NUTRIENTE',
        entidadeId: Number(id),
        motivo,
        detalhes:   existe.nome ?? null,
      });

      res.json({ message: 'Nutriente excluído com sucesso' });
    } catch (error) {
      if (error.code === 'P2025') return res.status(404).json({ error: 'Nutriente não encontrado' });
      console.error(error);
      res.status(500).json({ error: 'Erro ao excluir nutriente' });
    }
  }
}

module.exports = new NutrientesController();
