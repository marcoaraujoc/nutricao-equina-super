// backend/src/controllers/AnimalGraficosController.js
//
// Dados para os gráficos do animal (AnimalDetail): peso ao longo do tempo, linha do
// tempo de local/baia e a evolução de um parâmetro de exame no período — tudo
// derivado de tb_animal_historico e ExameClinicoResultadoItem. Nenhuma agregação é
// persistida: o front busca sob demanda ao abrir a tela/trocar o período.
'use strict';

const prisma = require('../lib/prisma').default;
const { verificarAcessoAnimal } = require('../lib/animalAccess');
const { escopoFilhoEvolucaoWhere } = require('../lib/clinicalScope');

async function checarAcesso(req, animalId) {
  return verificarAcessoAnimal({
    animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType,
  });
}

function janelaData(req, campo) {
  const { inicio, fim } = req.query;
  if (!inicio && !fim) return undefined;
  const where = {};
  if (inicio) where.gte = new Date(inicio);
  if (fim)    where.lte = new Date(`${fim}T23:59:59`);
  return { [campo]: where };
}

const AnimalGraficosController = {

  // GET /clinica/animais/:animalId/grafico-peso?inicio=&fim=
  // Série de peso do animal — cada ponto é um snapshot REAL de tb_animal_historico
  // (gravado só quando o peso mudou, ver lib/animalHistorico.js), não uma amostragem
  // periódica.
  graficoPeso: async (req, res) => {
    try {
      const animalId = Number(req.params.animalId);
      const acesso = await checarAcesso(req, animalId);
      if (acesso === null) return res.status(404).json({ error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ error: 'Acesso não autorizado' });

      const where = { animalId, peso: { not: null }, ...(janelaData(req, 'registradoEm') ?? {}) };
      const pontos = await prisma.animalHistorico.findMany({
        where,
        select: { peso: true, registradoEm: true },
        orderBy: { registradoEm: 'asc' },
      });

      res.json({ dados: pontos });
    } catch (err) {
      console.error('Erro ao carregar gráfico de peso:', err);
      res.status(500).json({ error: 'Erro ao carregar gráfico de peso' });
    }
  },

  // GET /clinica/animais/:animalId/historico-local — linha do tempo de local/baia
  // (leitura; mais recente primeiro).
  historicoLocal: async (req, res) => {
    try {
      const animalId = Number(req.params.animalId);
      const acesso = await checarAcesso(req, animalId);
      if (acesso === null) return res.status(404).json({ error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ error: 'Acesso não autorizado' });

      const pontos = await prisma.animalHistorico.findMany({
        where: { animalId },
        select: {
          registradoEm: true, local: true, baia: true,
          localizacao: { select: { id: true, nome: true } },
        },
        orderBy: { registradoEm: 'desc' },
      });

      res.json({ dados: pontos });
    } catch (err) {
      console.error('Erro ao carregar histórico de local/baia:', err);
      res.status(500).json({ error: 'Erro ao carregar histórico' });
    }
  },

  // GET /clinica/animais/:animalId/exames-parametros — nomes de parâmetro presentes
  // nos exames REALIZADOS do animal, para popular o seletor do gráfico de taxas.
  // Escopo por CLÍNICA (escopoFilhoEvolucaoWhere): o mesmo animal pode ser atendido
  // por mais de uma empresa, e o resultado de exame é dado clínico de cada uma —
  // sem isso, a clínica A veria os parâmetros que só a clínica B pediu (armadilha
  // 35 do CLAUDE.md).
  parametrosDisponiveis: async (req, res) => {
    try {
      const animalId = Number(req.params.animalId);
      const acesso = await checarAcesso(req, animalId);
      if (acesso === null) return res.status(404).json({ error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ error: 'Acesso não autorizado' });

      const itens = await prisma.exameClinicoResultadoItem.findMany({
        where:    { exame: { animalId, ativo: true, AND: [escopoFilhoEvolucaoWhere(req)] } },
        select:   { parametro: true },
        distinct: ['parametro'],
        orderBy:  { parametro: 'asc' },
      });

      res.json({ dados: itens.map(i => i.parametro) });
    } catch (err) {
      console.error('Erro ao listar parâmetros de exame:', err);
      res.status(500).json({ error: 'Erro ao listar parâmetros' });
    }
  },

  // GET /clinica/animais/:animalId/grafico-exame?parametro=Glicose&inicio=&fim=
  // Série de UM parâmetro (ex.: "Glicose") ao longo do tempo, juntando
  // ExameClinicoResultadoItem com a data de RESULTADO do exame de origem. Só entra
  // ponto com valor NUMÉRICO — texto solto ("positivo", "negativo") não plota.
  graficoExame: async (req, res) => {
    try {
      const animalId  = Number(req.params.animalId);
      const parametro = String(req.query.parametro ?? '').trim();
      if (!parametro) return res.status(400).json({ error: 'Informe o parâmetro' });

      const acesso = await checarAcesso(req, animalId);
      if (acesso === null) return res.status(404).json({ error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ error: 'Acesso não autorizado' });

      const whereExame = {
        animalId, ativo: true, AND: [escopoFilhoEvolucaoWhere(req)],
        ...(janelaData(req, 'dataResultado') ?? {}),
      };
      const itens = await prisma.exameClinicoResultadoItem.findMany({
        where:  { parametro, exame: whereExame },
        select: {
          valor: true, unidade: true, referencia: true,
          exame: { select: { id: true, numero: true, dataResultado: true, dataSolicitacao: true } },
        },
      });

      const pontos = itens
        .map(it => ({
          exameId:    it.exame.id,
          numero:     it.exame.numero,
          data:       it.exame.dataResultado ?? it.exame.dataSolicitacao,
          valor:      it.valor,
          unidade:    it.unidade,
          referencia: it.referencia,
        }))
        .filter(p => p.data && p.valor != null && !Number.isNaN(Number(String(p.valor).replace(',', '.'))))
        .sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime());

      res.json({ dados: pontos });
    } catch (err) {
      console.error('Erro ao carregar gráfico de exame:', err);
      res.status(500).json({ error: 'Erro ao carregar gráfico de exame' });
    }
  },
};

module.exports = AnimalGraficosController;
