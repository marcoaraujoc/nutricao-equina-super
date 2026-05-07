const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ==================== FUNÇÃO DE CONVERSÃO (g/g) ====================
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

class ComposicaoAlimentarController {

  async criar(req, res) {
    const { alimentoId, nutrienteId, valorPorKg, base } = req.body;

    try {
      const nutriente = await prisma.nutriente.findUnique({
        where: { id: Number(nutrienteId) },
        select: { unidadePadrao: true }
      });

      if (!nutriente) return res.status(404).json({ error: 'Nutriente não encontrado' });

      const valorConvertido = converterParaGramasPorGrama(valorPorKg, nutriente.unidadePadrao);

      const item = await prisma.composicaoAlimento.create({
        data: {
          alimentoId: Number(alimentoId),
          nutrienteId: Number(nutrienteId),
          valorPorKg: valorConvertido,
          base: base || 'Seca'
        }
      });

      res.status(201).json(item);
    } catch (error) {
      if (error.code === 'P2002') {
        return res.status(409).json({ error: 'Esta combinação de alimento e nutriente já existe.' });
      }
      console.error(error);
      res.status(500).json({ error: 'Erro ao criar composição' });
    }
  }

  async atualizar(req, res) {
    const { id } = req.params;
    const { alimentoId, nutrienteId, valorPorKg, base } = req.body;

    try {
      const nutriente = await prisma.nutriente.findUnique({
        where: { id: Number(nutrienteId) },
        select: { unidadePadrao: true }
      });

      if (!nutriente) return res.status(404).json({ error: 'Nutriente não encontrado' });

      const valorConvertido = converterParaGramasPorGrama(valorPorKg, nutriente.unidadePadrao);

      const item = await prisma.composicaoAlimento.update({
        where: { id: Number(id) },
        data: {
          alimentoId: Number(alimentoId),
          nutrienteId: Number(nutrienteId),
          valorPorKg: valorConvertido,
          base: base || 'Seca'
        }
      });

      res.json(item);
    } catch (error) {
      if (error.code === 'P2002') {
        return res.status(409).json({ error: 'Esta combinação de alimento e nutriente já existe em outro registro.' });
      }
      console.error(error);
      res.status(500).json({ error: 'Erro ao atualizar composição' });
    }
  }

  async listar(req, res) {
    try {
      const composicoes = await prisma.composicaoAlimento.findMany({
        include: { 
          alimento: true, 
          nutriente: true 
        },
        orderBy: { id: 'asc' }
      });
      res.json(composicoes);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao listar composições' });
    }
  }

  async obterPorId(req, res) {
    const { id } = req.params;
    try {
      const item = await prisma.composicaoAlimento.findUnique({
        where: { id: Number(id) },
        include: { alimento: true, nutriente: true }
      });
      if (!item) return res.status(404).json({ error: 'Composição não encontrada' });
      res.json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao buscar composição' });
    }
  }

  async excluir(req, res) {
    const { id } = req.params;
    try {
      await prisma.composicaoAlimento.delete({ where: { id: Number(id) } });
      res.json({ message: 'Composição excluída com sucesso' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao excluir composição' });
    }
  }

  // =============================================
  // ANÁLISE COM LLM - Totalmente Genérico
  // =============================================
  async analisarLLM(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado' });
      }

      const parser = require('../services/composicaoParserService');
      const resultado = await parser.processarArquivo(req.file.path, req.file.mimetype);

      res.json({
        composicoes: resultado.composicoes,
        mensagem: 'Análise realizada com sucesso'
      });

    } catch (error) {
      console.error('Erro na análise LLM de composição:', error);
      res.status(500).json({ 
        error: 'Erro ao processar arquivo com IA',
        detalhes: error.message 
      });
    }
  }
}

module.exports = new ComposicaoAlimentarController();