// backend/src/controllers/ExameController.js
const prisma = require('../lib/prisma').default;
const { processarExame } = require('../services/exameParserService');
const { storage }        = require('../storage');
const { registrarAuditoria } = require('../lib/auditoria');

// Helper seguro para converter valor (aceita número ou string com vírgula)
const safeParseFloat = (val) => {
  if (val == null) return null;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return parseFloat(val.replace(',', '.'));
  return null;
};

exports.getExamesByAnimal = async (req, res) => {
  const { animalId } = req.params;
  try {
    const exames = await prisma.exameNutricional.findMany({
      where: { animalId: parseInt(animalId) },
      include: { nutriente: true, animal: true },
      orderBy: { dataExame: 'desc' }
    });
    res.json(exames);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar exames' });
  }
};

exports.create = async (req, res) => {
  try {
    const { animalId, nutrienteId, dataExame, valorEncontrado, unidade, valorMinRef, valorMaxRef, observacao } = req.body;
    const arquivoUrl = req.file ? await storage.upload(req.file, 'exames') : null;

    const exame = await prisma.exameNutricional.create({
      data: {
        animal: { connect: { id: parseInt(animalId) } },
        nutriente: { connect: { id: parseInt(nutrienteId) } },

        dataExame: new Date(dataExame),
        valorEncontrado: safeParseFloat(valorEncontrado),
        unidade: unidade ? String(unidade).trim() : '',
        valorMinRef: safeParseFloat(valorMinRef),
        valorMaxRef: safeParseFloat(valorMaxRef),
        observacao: observacao || null,
        arquivoUrl
      }
    });
    res.status(201).json(exame);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao criar exame' });
  }
};

// Normaliza e valida o resultado da LLM (laudo) — busca/cria nutrientes e filtra
// duplicatas (animalId + nutrienteId + dataExame). Compartilhado por analisarLLM
// (laboratorial, 1 arquivo) e analisarImagens (imagem, vários arquivos).
async function montarExamesDoLaudo(resultado, animalId) {
  // Normaliza campos: suporta o formato novo (nome/resultado/referencia_min) e o antigo (nomeNutriente/valorEncontrado/valorMinRef)
  const examesNormalizados = (resultado.exames ?? []).map(exame => ({
    nomeNutriente:  exame.nomeNutriente  ?? exame.nome      ?? '',
    valorEncontrado: safeParseFloat(exame.valorEncontrado ?? exame.resultado),
    unidade:        exame.unidade        ?? '',
    valorMinRef:    safeParseFloat(exame.valorMinRef    ?? exame.referencia_min),
    valorMaxRef:    safeParseFloat(exame.valorMaxRef    ?? exame.referencia_max),
    observacao:     exame.observacao     ?? exame.metodo    ?? null,
  }));

  // Data segura — fallback para hoje se inválida ou ausente
  const dataExameRaw = resultado.dataExame;
  const dataExameParsed = dataExameRaw ? new Date(dataExameRaw) : null;
  const dataExameValida = dataExameParsed && !isNaN(dataExameParsed.getTime())
    ? dataExameParsed
    : new Date();

  const examesValidados = await Promise.all(
    examesNormalizados.map(async (exame) => {
      if (!exame.nomeNutriente) return null;

      // Busca ou cria o nutriente
      let nutriente = await prisma.nutriente.findFirst({
        where: { nome: { contains: exame.nomeNutriente } }
      });

      if (!nutriente) {
        nutriente = await prisma.nutriente.create({
          data: {
            nome: exame.nomeNutriente,
            unidadePadrao: exame.unidade ? String(exame.unidade).trim() : '',
            categoria: "Bioquímica"
          }
        });
      }

      // ✅ Verifica duplicidade (animalId + nutrienteId + dataExame)
      const jaExiste = await prisma.exameNutricional.findFirst({
        where: {
          animalId: parseInt(animalId),
          nutrienteId: nutriente.id,
          dataExame: dataExameValida
        }
      });

      return {
        ...exame,
        nutrienteId: nutriente.id,
        nomeOficial: nutriente.nome,
        encontrado: !jaExiste,
        jaExiste: !!jaExiste
      };
    })
  );

  return {
    dataExame: dataExameValida.toISOString().split('T')[0],
    exames: examesValidados.filter(ex => ex && ex.encontrado),
  };
}

// 🔥 ANÁLISE COM LLM + FILTRO DE DUPLICIDADE
exports.analisarLLM = async (req, res) => {
  try {
    const { animalId } = req.body;   // ← agora recebe o animalId do frontend

    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    if (!animalId) return res.status(400).json({ error: 'animalId é obrigatório' });

    const resultado = await processarExame(req.file.path);
    const { dataExame, exames } = await montarExamesDoLaudo(resultado, animalId);

    res.json({ dataExame, exames });
  } catch (error) {
    console.error('Erro na análise LLM:', error);
    res.status(500).json({ error: error.message });
  }
};

// 🔥 Laudo + Imagens (página Resultado de Exame · Imagem) — vários arquivos.
// A LLM interpreta cada arquivo: se extraiu dados de exame → é LAUDO (as
// informações são carregadas fielmente, mesmo fluxo do analisar-llm); se não
// extraiu nada (radiografia, ultrassom, foto...) → é IMAGEM e é apenas
// ARMAZENADA (ExameImagemAnexo), sem criar linhas de exame.
exports.analisarImagens = async (req, res) => {
  try {
    const { animalId } = req.body;
    const arquivos = req.files ?? [];

    if (arquivos.length === 0) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    if (!animalId)             return res.status(400).json({ error: 'animalId é obrigatório' });

    let dataExameFinal = null;
    const examesTotais = [];
    const imagens      = [];

    for (const file of arquivos) {
      let resultado = null;
      try {
        resultado = await processarExame(file.path);
      } catch {
        resultado = null; // LLM não conseguiu interpretar → trata como imagem
      }

      const ehLaudo = Array.isArray(resultado?.exames) && resultado.exames.length > 0;
      if (ehLaudo) {
        const { dataExame, exames } = await montarExamesDoLaudo(resultado, animalId);
        if (!dataExameFinal) dataExameFinal = dataExame;
        examesTotais.push(...exames);
      } else {
        const arquivoUrl = await storage.upload(file, 'exames-imagens');
        const anexo = await prisma.exameImagemAnexo.create({
          data: {
            animalId:    Number(animalId),
            nome:        file.originalname ?? null,
            arquivoUrl,
            criadoPorId: req.user?.id ?? null,
          },
        });
        imagens.push({ id: anexo.id, nome: anexo.nome, arquivoUrl: anexo.arquivoUrl });
      }
    }

    res.json({
      dataExame: dataExameFinal ?? new Date().toISOString().split('T')[0],
      exames:    examesTotais,
      imagens,
    });
  } catch (error) {
    console.error('Erro na análise de laudo/imagens:', error);
    res.status(500).json({ error: error.message });
  }
};

// GET /exames/imagens/animal/:animalId — imagens armazenadas do animal
exports.listarImagens = async (req, res) => {
  try {
    const imagens = await prisma.exameImagemAnexo.findMany({
      where:   { animalId: Number(req.params.animalId), ativo: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ dados: imagens });
  } catch (error) {
    console.error('Erro ao listar imagens de exame:', error);
    res.status(500).json({ error: 'Erro ao listar imagens' });
  }
};

// 🔥 Adiciona TODOS os nutrientes faltantes de uma só vez
exports.bulkCreateNutrientes = async (req, res) => {
  const { nutrientes } = req.body;

  if (!nutrientes || !Array.isArray(nutrientes) || nutrientes.length === 0) {
    return res.status(400).json({ error: 'Envie um array de nutrientes' });
  }

  try {
    const data = nutrientes.map(n => ({
      nome: typeof n === 'string' ? n : n.nome,
      unidadePadrao: '',
      categoria: "Bioquímica"
    }));

    const result = await prisma.nutriente.createMany({
      data,
      skipDuplicates: true
    });

    res.json({
      success: true,
      created: result.count,
      message: `${result.count} nutrientes adicionados ao catálogo`
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao criar nutrientes em lote' });
  }
};

exports.delete = async (req, res) => {
  const { id } = req.params;
  const { motivo } = req.body ?? {};
  if (!motivo?.trim()) {
    return res.status(400).json({ error: 'É obrigatório informar o motivo da exclusão' });
  }
  try {
    const exame = await prisma.exameNutricional.delete({
      where: { id: Number(id) }
    });

    await registrarAuditoria(null, req, {
      categoria:  'EXCLUSAO',
      entidade:   'EXAME_NUTRICIONAL',
      entidadeId: Number(id),
      animalId:   exame.animalId ?? null,
      motivo,
      detalhes:   exame.observacao || null,
    });

    res.json({ message: 'Exame excluído com sucesso', exame });
  } catch (error) {
    console.error(error);
    res.status(404).json({ error: 'Exame não encontrado' });
  }
};


exports.update = async (req, res) => {
  const { id } = req.params;
  const { nutrienteId, dataExame, valorEncontrado, unidade, valorMinRef, valorMaxRef, observacao } = req.body;

  try {
    const exame = await prisma.exameNutricional.update({
      where: { id: Number(id) },
      data: {
        nutrienteId: nutrienteId ? Number(nutrienteId) : undefined,
        dataExame: dataExame ? new Date(dataExame) : undefined,
        valorEncontrado: valorEncontrado ? Number(valorEncontrado) : undefined,
        unidade,
        valorMinRef: valorMinRef ? Number(valorMinRef) : undefined,
        valorMaxRef: valorMaxRef ? Number(valorMaxRef) : undefined,
        observacao
      }
    });
    res.json(exame);
  } catch (error) {
    console.error(error);
    res.status(404).json({ error: 'Exame não encontrado' });
  }
};