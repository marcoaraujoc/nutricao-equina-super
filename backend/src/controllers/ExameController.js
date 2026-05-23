// backend/src/controllers/ExameController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { processarExame } = require('../services/exameParserService');
const { storage }        = require('../storage');

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

// 🔥 ANÁLISE COM LLM + FILTRO DE DUPLICIDADE
exports.analisarLLM = async (req, res) => {
  try {
    const { animalId } = req.body;   // ← agora recebe o animalId do frontend

    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    if (!animalId) return res.status(400).json({ error: 'animalId é obrigatório' });

    const resultado = await processarExame(req.file.path);

    const examesValidados = await Promise.all(
      resultado.exames.map(async (exame) => {
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
            dataExame: new Date(resultado.dataExame)
          }
        });

        return {
          ...exame,
          nutrienteId: nutriente.id,
          nomeOficial: nutriente.nome,
          encontrado: !jaExiste,        // só mostra o que ainda não existe
          jaExiste: !!jaExiste
        };
      })
    );

    // Filtra apenas os exames que ainda não foram cadastrados
    const examesNovos = examesValidados.filter(ex => ex.encontrado);

    res.json({
      dataExame: resultado.dataExame || new Date().toISOString().split('T')[0],
      exames: examesNovos
    });

  } catch (error) {
    console.error('Erro na análise LLM:', error);
    res.status(500).json({ error: error.message });
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
  try {
    const exame = await prisma.exameNutricional.delete({
      where: { id: Number(id) }
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