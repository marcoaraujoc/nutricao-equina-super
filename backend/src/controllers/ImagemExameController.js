'use strict';
// Catálogo de exames de diagnóstico por imagem — endpoints autenticados
//
// 🔴 DUAS FONTES CONVIVEM AQUI (2026-09-09), e é deliberado:
//
//   1. `tb_procedimentos_vet` (tipoProcedimento = 'IMAGEM') — a fonte NOVA. É onde o
//      exame de imagem ganha preço por empresa, prestador com os dois valores, combo
//      e orçamento, porque tudo isso já existe para procedimento.
//   2. `tb_imagem_exame_grupos`/`_itens` — a fonte ANTIGA, que continua respondendo
//      enquanto a base não tiver rodado `seeds/005_procedimentos_imagem.seed.js`.
//
// ⚠️ A bandeira `recursos.porProcedimento` diz qual das duas a tela deve usar. Sem
// ela, uma base ainda não semeada abriria a aba Imagem VAZIA — e o vet concluiria
// que o catálogo sumiu, não que falta rodar um seed. Mesmo padrão do
// `recursos.comboPrestador` no cadastro de procedimentos.

const prisma = require('../lib/prisma').default;
const vinculoPrestador = require('../lib/procedimentoPrestador');
const {
  CATEGORIAS_IMAGEM, TIPO_IMAGEM,
} = require('../seeds/005_procedimentos_imagem.seed');

/**
 * O catálogo já foi projetado em `tb_procedimentos_vet`?
 *
 * ⚠️ Sem cache de propósito: é uma contagem barata com `LIMIT 1`, e um cache de
 * processo faria a tela continuar no catálogo antigo até alguém reiniciar o backend
 * depois de rodar o seed — exatamente o momento em que a resposta precisa mudar.
 */
async function catalogoUnificado() {
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM schs2vet.tb_procedimentos_vet
        WHERE "tipoProcedimento" = $1 AND ativo = true LIMIT 1`,
      TIPO_IMAGEM,
    );
    return rows.length > 0;
  } catch { return false; }
}

/** Exame de imagem é compatível com a espécie do paciente? */
function serveAEspecie(especieProc, especieAnimal) {
  if (!especieAnimal) return true;
  if (!especieProc) return true;
  const e = String(especieProc).trim().toLowerCase();
  if (e === 'ambas' || e === 'ambos') return true;
  return e.includes(String(especieAnimal).trim().toLowerCase());
}

const ImagemExameController = {

  // GET /api/clinica/imagem-exames/categorias
  // As categorias maiores (Radiografia, Ultrassonografia, Endoscopia, Termografia,
  // Tomografia e Ressonância, Laparoscopia) + a bandeira de qual catálogo vale.
  listarCategorias: async (_req, res) => {
    try {
      const porProcedimento = await catalogoUnificado();
      return res.json({
        dados: porProcedimento ? CATEGORIAS_IMAGEM : [],
        recursos: { porProcedimento },
      });
    } catch (err) {
      console.error('ImagemExameController.listarCategorias:', err);
      return res.status(500).json({ error: 'Erro ao listar categorias de imagem.' });
    }
  },

  // GET /api/clinica/imagem-exames/prestadores?categoria=NOME
  // Prestadores ATIVOS da empresa, marcando quais já têm vínculo (e portanto valor)
  // em algum exame DAQUELA categoria.
  //
  // ⚠️ Lista TODOS os ativos, não só os vinculados: o vínculo é configuração do
  // GESTOR e pode não existir ainda; oferecer apenas os vinculados travaria o pedido
  // do exame por causa de um cadastro que talvez ninguém tenha feito. Quem não tem
  // vínculo vem com `temValor: false`, e a tela avisa em vez de esconder.
  //
  // ⚠️ Escopado por `req.empresaId` — `tb_prestadores` é TENANT DIRETO sob RLS, e o
  // filtro explícito faz a resposta ser a mesma com e sem o carimbo.
  listarPrestadores: async (req, res) => {
    try {
      if (!req.empresaId) return res.json({ dados: [] });
      const categoria = String(req.query.categoria ?? '').trim();

      const prestadores = await prisma.prestador.findMany({
        where:  { empresaId: req.empresaId, ativo: true },
        select: {
          id: true, nome: true, tipoServico: true,
          tipoPagamento: true, formaPagamento: true, valorPagamento: true,
        },
        orderBy: { nome: 'asc' },
      });
      if (prestadores.length === 0) return res.json({ dados: [] });

      // Quem tem vínculo em algum exame desta categoria — é o que distingue
      // "executa isto aqui" de "está cadastrado na clínica".
      let comVinculo = new Set();
      if (categoria) {
        try {
          const rows = await prisma.$queryRawUnsafe(
            `SELECT DISTINCT pp.prestador_id
               FROM schs2vet.tb_procedimento_prestadores pp
               JOIN schs2vet.tb_procedimentos_vet pv ON pv.id = pp.procedimento_id
              WHERE pp.empresa_id = $1 AND pp.ativo = true
                AND pv."tipoProcedimento" = $2
                AND lower(btrim(pv.categoria)) = lower(btrim($3))`,
            req.empresaId, TIPO_IMAGEM, categoria,
          );
          comVinculo = new Set(rows.map(r => r.prestador_id));
        } catch { /* base sem a tabela de vínculo — todos saem como sem valor */ }
      }

      return res.json({
        dados: prestadores.map(p => ({ ...p, temValor: comVinculo.has(p.id) })),
      });
    } catch (err) {
      console.error('ImagemExameController.listarPrestadores:', err);
      return res.status(500).json({ error: 'Erro ao listar prestadores.' });
    }
  },

  // GET /api/clinica/imagem-exames/exames?categoria=NOME&prestadorId=&especie=
  // Exames da categoria, com o valor que a clínica cobra por cada um.
  listarExamesPorCategoria: async (req, res) => {
    try {
      const categoria   = String(req.query.categoria ?? '').trim();
      const especie     = String(req.query.especie ?? '').trim();
      const prestadorId = Number(req.query.prestadorId) || null;
      if (!categoria) return res.json({ dados: [] });

      // Catálogo global + os exames que a PRÓPRIA empresa cadastrou (catálogo misto).
      // ⚠️ `empresaId: null` sozinho esconderia o exame que a clínica criou; o
      // `req.empresaId` sozinho esconderia os 119 do catálogo. Precisa dos dois.
      let exames = await prisma.procedimentoVeterinario.findMany({
        where: {
          ativo: true,
          tipoProcedimento: TIPO_IMAGEM,
          categoria: { equals: categoria, mode: 'insensitive' },
          OR: [{ empresaId: null }, ...(req.empresaId ? [{ empresaId: req.empresaId }] : [])],
        },
        select: {
          id: true, codigo: true, nome: true, nomeAbreviado: true,
          subcategoria: true, especie: true, valorVenda: true, empresaId: true,
        },
        orderBy: [{ subcategoria: 'asc' }, { nome: 'asc' }],
      });

      // Só o que serve ao paciente em atendimento — exame de bovino não tem o que
      // fazer na lista de um equino.
      if (especie) exames = exames.filter(e => serveAEspecie(e.especie, especie));
      if (exames.length === 0) return res.json({ dados: [] });

      const ids = exames.map(e => e.id);

      // Valor PADRÃO da empresa (o que vale quando quem executa é a própria equipe).
      let padrao = new Map();
      if (req.empresaId) {
        const rows = await prisma.procedimentoValorEmpresa.findMany({
          where:  { empresaId: req.empresaId, procedimentoId: { in: ids } },
          select: { procedimentoId: true, valor: true },
        });
        padrao = new Map(rows.map(r => [r.procedimentoId, r.valor]));
      }

      // Vínculos do prestador escolhido — em BLOCO, nunca um por exame: a categoria
      // Radiografia tem 60 itens e uma ida ao banco por linha derrubaria a tela.
      const vinculos = req.empresaId
        ? await vinculoPrestador.vinculosPorProcedimento(req.empresaId, ids)
        : new Map();

      return res.json({
        dados: exames.map(e => {
          const doPrestador = prestadorId
            ? (vinculos.get(e.id) ?? []).find(v => v.prestadorId === prestadorId) ?? null
            : null;
          const valorPadrao = padrao.get(e.id) ?? null;
          return {
            ...e,
            valorPadrao,
            // ⚠️ `valorCliente` NULO no vínculo significa "usa o padrão da empresa",
            // NÃO zero — é a mesma semântica do cadastro de procedimentos.
            valorCliente:   doPrestador ? (doPrestador.valorCliente ?? valorPadrao) : valorPadrao,
            valorPrestador: doPrestador?.valorPrestador ?? null,
            // Diz se o prestador escolhido tem vínculo NESTE exame: é o que permite a
            // tela avisar "sem valor cadastrado" antes de o item sair por R$ 0,00.
            temVinculo: Boolean(doPrestador),
          };
        }),
      });
    } catch (err) {
      console.error('ImagemExameController.listarExamesPorCategoria:', err);
      return res.status(500).json({ error: 'Erro ao listar exames de imagem.' });
    }
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Catálogo ANTIGO (tb_imagem_exame_*) — atende a base que ainda não rodou o seed
  // 005. Não remover enquanto a bandeira `porProcedimento` puder vir `false`.
  // ───────────────────────────────────────────────────────────────────────────

  // GET /api/clinica/imagem-exames/grupos
  listarGrupos: async (req, res) => {
    try {
      const grupos = await prisma.imagemExameGrupo.findMany({
        where:   { ativo: true },
        select:  { id: true, nome: true, categoria: true, ordem: true },
        orderBy: { ordem: 'asc' },
      });
      res.json({ dados: grupos });
    } catch (err) {
      console.error('Erro ao listar grupos de imagem:', err);
      res.status(500).json({ error: 'Erro ao listar grupos' });
    }
  },

  // GET /api/clinica/imagem-exames/grupos/:grupoId/itens
  listarItensPorGrupo: async (req, res) => {
    try {
      const grupoId = Number(req.params.grupoId);
      const itens = await prisma.imagemExameItem.findMany({
        where:   { grupoId, ativo: true },
        select:  { id: true, codigo: true, nome: true, sigla: true, especie: true },
        orderBy: { nome: 'asc' },
      });
      res.json({ dados: itens });
    } catch (err) {
      console.error('Erro ao listar itens de imagem:', err);
      res.status(500).json({ error: 'Erro ao listar itens' });
    }
  },
};

module.exports = ImagemExameController;
