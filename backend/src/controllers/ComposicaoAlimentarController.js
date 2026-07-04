const prisma = require('../lib/prisma').default;

// Normaliza nome de nutriente: sem acentos + Title Case por palavra
// Ex: "selênio" → "Selenio" | "proteína bruta" → "Proteina Bruta"
const normalizarNomeNutriente = (nome) =>
  String(nome || '')
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

// Remove o sufixo "/kg" ou "/g" da unidade — armazena só a grandeza
const normalizarUnidade = (unidade) => {
  return String(unidade || 'g')
    .trim()
    .replace(/\/(kg|g)$/i, '')
    .trim() || 'g';
};

// Converte valor entre unidades de massa (g, mg, mcg/µg).
// Unidades desconhecidas retornam o valor original sem conversão.
const FATOR_PARA_G = { g: 1, mg: 1e-3, mcg: 1e-6, 'µg': 1e-6 };

const converterUnidade = (valor, unidadeOrigem, unidadeDestino) => {
  const orig = String(unidadeOrigem || '').toLowerCase().trim();
  const dest = String(unidadeDestino || '').toLowerCase().trim();
  if (orig === dest) return valor;
  const fo = FATOR_PARA_G[orig];
  const fd = FATOR_PARA_G[dest];
  if (!fo || !fd) return valor;
  return (Number(valor) * fo) / fd;
};

// =====================================================================
// CONVERSÃO DE UNIDADES → g/g (base interna do banco)
// =====================================================================
const converterParaGramasPorGrama = (valorOriginal, unidadeOriginal) => {
  const valor = Number(valorOriginal);
  const unidade = String(unidadeOriginal || '').trim().toLowerCase();

  if (isNaN(valor)) return valorOriginal;
  if (unidade === 'ufc/g') return valor;

  let valorFinal = valor;
  if (unidade === 'g')   valorFinal = valor / 1000;
  if (unidade === 'mg')  valorFinal = valor / 1_000_000;
  if (unidade === 'mcg') valorFinal = valor / 1_000_000_000;

  return valorFinal;
};

// =====================================================================
// CONTROLLER
// =====================================================================

const ComposicaoAlimentarController = {

  // -------------------------------------------------------------------
  // LISTAR — com filtro opcional por espécie
  // -------------------------------------------------------------------
  listar: async (req, res) => {
    try {
      const { especieId } = req.query;

      const composicoes = await prisma.composicaoAlimento.findMany({
        where: especieId ? { especieId: Number(especieId) } : undefined,
        include: {
          alimento: true,
          nutriente: true,
          especie: { select: { id: true, nome: true } },
        },
        orderBy: [{ alimento: { nome: 'asc' } }, { nutriente: { nome: 'asc' } }],
      });

      res.json({ sucesso: true, dados: composicoes });
    } catch (error) {
      console.error('Erro ao listar composições:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao listar composições' });
    }
  },

  // -------------------------------------------------------------------
  // OBTER POR ID
  // -------------------------------------------------------------------
  obterPorId: async (req, res) => {
    const { id } = req.params;
    try {
      const item = await prisma.composicaoAlimento.findUnique({
        where: { id: Number(id) },
        include: {
          alimento: true,
          nutriente: true,
          especie: { select: { id: true, nome: true } },
        },
      });
      if (!item) {
        return res.status(404).json({ sucesso: false, mensagem: 'Composição não encontrada' });
      }
      res.json({ sucesso: true, dados: item });
    } catch (error) {
      console.error('Erro ao buscar composição:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao buscar composição' });
    }
  },

  // -------------------------------------------------------------------
  // CRIAR — composição avulsa (edição inline na listagem)
  // -------------------------------------------------------------------
  criar: async (req, res) => {
    const { alimentoId, nutrienteId, valorPorKg, base, especieId } = req.body;

    if (!alimentoId || !nutrienteId || valorPorKg === undefined || valorPorKg === null) {
      return res.status(400).json({
        sucesso: false,
        mensagem: 'alimentoId, nutrienteId e valorPorKg são obrigatórios',
      });
    }
    if (isNaN(Number(valorPorKg)) || Number(valorPorKg) < 0) {
      return res.status(400).json({ sucesso: false, mensagem: 'valorPorKg deve ser um número positivo' });
    }

    try {
      // Check explícito com mensagem descritiva — antes de depender do P2002
      const existente = await prisma.composicaoAlimento.findFirst({
        where: {
          alimentoId: Number(alimentoId),
          nutrienteId: Number(nutrienteId),
        },
        include: {
          alimento: { select: { nome: true } },
          nutriente: { select: { nome: true } },
        },
      });

      if (existente) {
        return res.status(409).json({
          sucesso: false,
          mensagem: `"${existente.nutriente?.nome}" já está cadastrado para "${existente.alimento?.nome}" com o valor ${existente.valorPorKg}. Use a edição para alterar o valor.`,
        });
      }

      const item = await prisma.composicaoAlimento.create({
        data: {
          alimentoId: Number(alimentoId),
          nutrienteId: Number(nutrienteId),
          valorPorKg: Number(valorPorKg),
          base: base || 'Seca',
          ...(especieId ? { especieId: Number(especieId) } : {}),
        },
        include: {
          alimento: { select: { id: true, nome: true } },
          nutriente: { select: { id: true, nome: true, unidadePadrao: true } },
          especie: { select: { id: true, nome: true } },
        },
      });

      res.status(201).json({ sucesso: true, dados: item });
    } catch (error) {
      if (error.code === 'P2002') {
        return res.status(409).json({
          sucesso: false,
          mensagem: 'Este nutriente já está cadastrado para o alimento.',
        });
      }
      console.error('Erro ao criar composição:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao criar composição' });
    }
  },

  // -------------------------------------------------------------------
  // ATUALIZAR — edição inline na listagem
  // -------------------------------------------------------------------
  atualizar: async (req, res) => {
    const { id } = req.params;
    const { valorPorKg } = req.body;

    if (valorPorKg === undefined || valorPorKg === null || isNaN(Number(valorPorKg))) {
      return res.status(400).json({ sucesso: false, mensagem: 'valorPorKg é obrigatório e deve ser número' });
    }

    try {
      const existe = await prisma.composicaoAlimento.findUnique({ where: { id: Number(id) } });
      if (!existe) {
        return res.status(404).json({ sucesso: false, mensagem: 'Composição não encontrada' });
      }

      const item = await prisma.composicaoAlimento.update({
        where: { id: Number(id) },
        data: { valorPorKg: Number(valorPorKg) },
    });

      res.json({ sucesso: true, dados: item });
    } catch (error) {
      if (error.code === 'P2002') {
        return res.status(409).json({
          sucesso: false,
          mensagem: 'Esta combinação de alimento e nutriente já existe em outro registro.',
        });
      }
      if (error.code === 'P2025') {
        return res.status(404).json({ sucesso: false, mensagem: 'Composição não encontrada' });
      }
      console.error('Erro ao atualizar composição:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao atualizar composição' });
    }
  },

  // -------------------------------------------------------------------
  // EXCLUIR
  // -------------------------------------------------------------------
  excluir: async (req, res) => {
    const { id } = req.params;
    try {
      await prisma.composicaoAlimento.delete({ where: { id: Number(id) } });
      res.json({ sucesso: true, mensagem: 'Composição excluída com sucesso' });
    } catch (error) {
      if (error.code === 'P2025') {
        return res.status(404).json({ sucesso: false, mensagem: 'Composição não encontrada' });
      }
      console.error('Erro ao excluir composição:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao excluir composição' });
    }
  },

  // -------------------------------------------------------------------
  // ANALISAR LLM — lê o rótulo e retorna JSON (não salva nada)
  // -------------------------------------------------------------------
  analisarLLM: async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ sucesso: false, mensagem: 'Nenhum arquivo enviado' });
    }

    try {
      const parser = require('../services/composicaoParserService');
      const resultado = await parser.processarArquivo(req.file.path, req.file.mimetype);
      res.json({ sucesso: true, dados: resultado });
    } catch (error) {
      console.error('Erro na análise LLM de composição:', error);
      res.status(500).json({
        sucesso: false,
        mensagem: error.message || 'Erro ao processar arquivo com IA',
      });
    }
  },

  // -------------------------------------------------------------------
  // IMPORTAR COMPLETO — cria alimento + nutrientes + composições
  //
  // Payload esperado:
  // {
  //   nomeAlimento: string,          ← obrigatório, digitado pelo usuário
  //   especieId?: number | null,
  //   composicoes: [
  //     { nutrienteNome, unidade, valorPorKg, base }
  //   ]
  // }
  // -------------------------------------------------------------------
  importarCompleto: async (req, res) => {
    const { nomeAlimento, categoriaAlimento, especieId, composicoes } = req.body;

    if (!nomeAlimento?.trim()) {
      return res.status(400).json({ sucesso: false, mensagem: 'Nome do alimento é obrigatório' });
    }
    if (!composicoes || composicoes.length === 0) {
      return res.status(400).json({ sucesso: false, mensagem: 'Nenhuma composição para salvar' });
    }

    // ── 1. Verifica se o alimento já existe ──────────────────────────
    const alimentoExistente = await prisma.alimento.findFirst({
      where: { nome: nomeAlimento.trim() },
    });

    if (alimentoExistente) {
      return res.status(409).json({
        sucesso: false,
        mensagem: `O alimento "${nomeAlimento}" já está cadastrado. Para adicionar nutrientes, use a tela de edição de composições.`,
      });
    }

    try {
      // ── 2. Cria o alimento ─────────────────────────────────────────
      const alimento = await prisma.alimento.create({
        data: {
          nome: nomeAlimento.trim(),
          categoria: categoriaAlimento || 'Importado',
        },
      });

      // ── 3. Para cada composição: encontra ou cria o nutriente ──────
      let totalSalvos = 0;
      let totalIgnorados = 0;

      for (const comp of composicoes) {
        if (!comp.nutrienteNome?.trim() || comp.valorPorKg === null || comp.valorPorKg === undefined) {
          totalIgnorados++;
          continue;
        }

        // Busca nutriente pelo nome (sem acentos)
        const unidadeComp = normalizarUnidade(comp.unidade);
        const nomeSemAcento = normalizarNomeNutriente(comp.nutrienteNome.trim());

        // 1ª tentativa: match exato por nome + unidade
        let nutriente = await prisma.nutriente.findFirst({
          where: { nome: nomeSemAcento, unidadePadrao: unidadeComp },
        });

        // Valor final — pode ser convertido se houver conflito de unidade
        let valorFinal = Number(comp.valorPorKg);

        if (!nutriente) {
          // 2ª tentativa: mesmo nome com unidade diferente (nutriente canônico mais antigo)
          const nutrienteMesmoNome = await prisma.nutriente.findFirst({
            where: { nome: nomeSemAcento },
            orderBy: { id: 'asc' }, // o mais antigo é o canônico
          });

          if (nutrienteMesmoNome) {
            // Converte o valor para a unidade do nutriente canônico e reutiliza o registro
            valorFinal = converterUnidade(valorFinal, unidadeComp, nutrienteMesmoNome.unidadePadrao);
            nutriente = nutrienteMesmoNome;
          } else {
            // Nutriente genuinamente novo — cria
            nutriente = await prisma.nutriente.create({
              data: {
                nome: nomeSemAcento,
                categoria: 'Importado',
                unidadePadrao: unidadeComp,
              },
            });
          }
        }

        try {
          await prisma.composicaoAlimento.create({
            data: {
              alimentoId: alimento.id,
              nutrienteId: nutriente.id,
              valorPorKg: valorFinal,
              base: comp.base || 'Seca',
              ...(especieId ? { especieId: Number(especieId) } : {}),
            },
          });
          totalSalvos++;
        } catch (err) {
          // P2002 = unique constraint — mesmo nutriente duplicado no payload, ignora
          if (err.code === 'P2002') {
            totalIgnorados++;
          } else {
            throw err;
          }
        }
      }

      res.status(201).json({
        sucesso: true,
        dados: { alimentoId: alimento.id, nomeAlimento: alimento.nome, totalSalvos, totalIgnorados },
        mensagem: `Alimento criado com ${totalSalvos} composições.${totalIgnorados > 0 ? ` ${totalIgnorados} nutriente(s) ignorado(s) por dados inválidos ou duplicados.` : ''}`,
      });
    } catch (error) {
      console.error('Erro ao importar composição completa:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao salvar composição' });
    }
  },

};

module.exports = ComposicaoAlimentarController;