// backend/src/controllers/AnaliseFinanceiraController.js
// IA Financeira — painel gerencial em Relatórios > Financeiro.
// Reusa a apuração do relatório (computarFinanceiro) e delega a leitura dos
// números ao financeiroLLMService. Sem persistência: cada consulta analisa o
// período selecionado no PeriodoSelector.
'use strict';

const { computarFinanceiro } = require('./RelatoriosController');
const { resolverPeriodo }    = require('./RelatorioGerencialController');
const { analisarFinanceiro } = require('../services/financeiroLLMService');

const DIA = { day: '2-digit', month: '2-digit', year: 'numeric' };

function rotuloPeriodo(req) {
  const { granularidade, inicio, fim } = resolverPeriodo(req);
  const de  = inicio.toLocaleDateString('pt-BR', DIA);
  const ate = fim.toLocaleDateString('pt-BR', DIA);
  const nome = { dia: 'Dia', semana: 'Semana', mes: 'Mês', ano: 'Ano' }[granularidade] ?? 'Período';
  return granularidade === 'dia' ? `${nome} ${de}` : `${nome} — ${de} a ${ate}`;
}

const AnaliseFinanceiraController = {

  // GET /api/relatorios/financeiro/analise-ia?granularidade=&data=
  analisar: async (req, res, next) => {
    try {
      const dados   = await computarFinanceiro(req);
      const periodo = rotuloPeriodo(req);
      const analise = await analisarFinanceiro(req, dados, periodo);

      return res.json({ dados: { periodo, ...analise } });
    } catch (err) {
      // Limite de plano de IA → 429 pelo handler global (não é erro do servidor)
      if (err.code === 'IA_QUOTA_EXCEDIDA') return next(err);
      console.error('AnaliseFinanceiraController.analisar:', err);
      return res.status(500).json({ error: 'Não foi possível gerar a análise financeira.' });
    }
  },
};

module.exports = AnaliseFinanceiraController;
