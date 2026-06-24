/**
 * ResenhaGraficaController.js
 *
 * Segue o padrão de resposta já estabelecido no S2Vet:
 * { sucesso: boolean, dados: any, mensagem: string }
 */

const resenhaGraficaService = require('../services/resenhagraficaservice');
const prismaLib = require('../lib/prisma');
const prisma = prismaLib.default ?? prismaLib;

/**
 * GET /api/animais/:animalId/resenha/:vista
 * Retorna o documento de resenha gráfica de uma vista + as regiões
 * anatômicas disponíveis para aquela vista.
 */
async function buscarPorVista(req, res) {
  try {
    const animalId = Number(req.params.animalId);
    const { vista } = req.params;

    if (!animalId || Number.isNaN(animalId)) {
      return res.status(400).json({ sucesso: false, dados: null, mensagem: 'animalId inválido.' });
    }

    const resultado = await resenhaGraficaService.buscarOuCriarResenhaPorVista(animalId, vista);

    return res.status(200).json({
      sucesso: true,
      dados: resultado,
      mensagem: 'Resenha gráfica carregada com sucesso.',
    });
  } catch (erro) {
    console.error('[ResenhaGraficaController.buscarPorVista]', erro);
    return res.status(500).json({ sucesso: false, dados: null, mensagem: 'Erro ao buscar resenha gráfica.' });
  }
}

/**
 * PUT /api/animais/:animalId/resenha/:vista
 * Salva (cria ou substitui) os traços desenhados para uma vista.
 *
 * Body: { vetorTracos: TracoResenha[], snapshotPng?: string | null }
 */
async function salvarPorVista(req, res) {
  try {
    const animalId = Number(req.params.animalId);
    const { vista } = req.params;
    const { vetorTracos, snapshotPng } = req.body;
    const criadoPorId = Number(req.user?.id);

    if (!animalId || Number.isNaN(animalId)) {
      return res.status(400).json({ sucesso: false, dados: null, mensagem: 'animalId inválido.' });
    }

    if (!Array.isArray(vetorTracos)) {
      return res.status(400).json({ sucesso: false, dados: null, mensagem: 'vetorTracos deve ser um array.' });
    }

    const animal = await prisma.animal.findUnique({ where: { id: animalId } });
    if (!animal) {
      return res.status(404).json({ sucesso: false, dados: null, mensagem: 'Animal não encontrado.' });
    }

    const resenha = await resenhaGraficaService.salvarResenhaGrafica({
      animalId,
      vista,
      vetorTracos,
      snapshotPng: snapshotPng ?? null,
      criadoPorId,
    });

    return res.status(200).json({
      sucesso: true,
      dados: resenha,
      mensagem: 'Resenha gráfica salva com sucesso.',
    });
  } catch (erro) {
    console.error('[ResenhaGraficaController.salvarPorVista]', erro);
    return res.status(500).json({ sucesso: false, dados: null, mensagem: 'Erro ao salvar resenha gráfica.' });
  }
}

/**
 * GET /api/animais/:animalId/resenha/marcacoes
 * Resumo textual de todas as marcações do animal, em todas as vistas.
 */
async function listarMarcacoes(req, res) {
  try {
    const animalId = Number(req.params.animalId);

    if (!animalId || Number.isNaN(animalId)) {
      return res.status(400).json({ sucesso: false, dados: null, mensagem: 'animalId inválido.' });
    }

    const marcacoes = await resenhaGraficaService.listarMarcacoesPorAnimal(animalId);

    return res.status(200).json({
      sucesso: true,
      dados: marcacoes,
      mensagem: 'Marcações listadas com sucesso.',
    });
  } catch (erro) {
    console.error('[ResenhaGraficaController.listarMarcacoes]', erro);
    return res.status(500).json({ sucesso: false, dados: null, mensagem: 'Erro ao listar marcações.' });
  }
}

module.exports = { buscarPorVista, salvarPorVista, listarMarcacoes };
