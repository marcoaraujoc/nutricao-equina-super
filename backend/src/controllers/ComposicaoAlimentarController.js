const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ==================== NOVA FUNÇÃO DE CONVERSÃO (g/g) ====================
const converterParaGramasPorGrama = (valorOriginal, unidadeOriginal) => {
  const valor = Number(valorOriginal);
  const unidade = String(unidadeOriginal || '').trim().toLowerCase();

  console.log(`[CONVERSÃO g/g] Unidade do banco: "${unidadeOriginal}" → "${unidade}"`);
  console.log(`[CONVERSÃO g/g] Valor informado: ${valorOriginal}`);

  if (isNaN(valor)) {
    console.log(`[CONVERSÃO g/g] ERRO: Valor não numérico`);
    return valorOriginal;
  }

  // Exceção explícita
  if (unidade === 'ufc/g') {
    console.log(`[CONVERSÃO g/g] UFC/g → Mantém valor original`);
    return valor;
  }

  // Conversão para gramas por grama de alimento (g/g)
  let valorFinal = valor;

  if (unidade === 'g')   valorFinal = valor / 1000;           // g/kg → g/g
  if (unidade === 'mg')  valorFinal = valor / 1_000_000;      // mg/kg → g/g
  if (unidade === 'mcg') valorFinal = valor / 1_000_000_000;  // mcg/kg → g/g

  console.log(`[CONVERSÃO g/g] RESULTADO FINAL: ${valor} ${unidade} → ${valorFinal} g/g`);
  return valorFinal;
};
// =====================================================================

class ComposicaoAlimentarController {
  async criar(req, res) {
    const { alimentoId, nutrienteId, valorPorKg, base } = req.body;

    try {
      const nutriente = await prisma.nutriente.findUnique({
        where: { id: Number(nutrienteId) },
        select: { unidadePadrao: true, nome: true }
      });

      if (!nutriente) return res.status(404).json({ error: 'Nutriente não encontrado' });

      const valorConvertido = converterParaGramasPorGrama(valorPorKg, nutriente.unidadePadrao);

      const item = await prisma.composicaoAlimento.create({
        data: {
          alimentoId: Number(alimentoId),
          nutrienteId: Number(nutrienteId),
          valorPorKg: valorConvertido,        // ← AGORA EM g/g
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
        select: { unidadePadrao: true, nome: true }
      });

      if (!nutriente) return res.status(404).json({ error: 'Nutriente não encontrado' });

      const valorConvertido = converterParaGramasPorGrama(valorPorKg, nutriente.unidadePadrao);

      const item = await prisma.composicaoAlimento.update({
        where: { id: Number(id) },
        data: {
          alimentoId: Number(alimentoId),
          nutrienteId: Number(nutrienteId),
          valorPorKg: valorConvertido,
          base
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
        include: { alimento: true, nutriente: true },
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
}

module.exports = new ComposicaoAlimentarController();