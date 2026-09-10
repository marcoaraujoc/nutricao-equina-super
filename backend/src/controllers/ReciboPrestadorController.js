// backend/src/controllers/ReciboPrestadorController.js
//
// RECIBO DE PAGAMENTO AO PRESTADOR — diário, semanal, mensal e anual (2026-09-08).
//
// 🔴 É O OUTRO LADO DO BALCÃO DA FATURA, e é por isso que é uma tela própria e não
// uma aba do Faturamento: a fatura registra o que a clínica COBRA do cliente; o
// recibo registra o que ela DEVE a quem executou o procedimento. Os dois nascem do
// MESMO evento (a execução) e por isso conferem, mas são documentos diferentes,
// para pessoas diferentes, com totais diferentes.
//
// Funciona como a fatura em forma: escolhe-se o período, agrupa-se por prestador e
// cada linha traz o que o recibo tem de dizer — NOME DO ANIMAL, PROCEDIMENTO
// EXECUTADO, VALOR e DATA DA EXECUÇÃO.
//
// 🔴 O VALOR NÃO É RECALCULADO AQUI. Ele vem congelado do ledger
// (`tb_execucoes_procedimento_prestador`), gravado no instante da execução junto com
// a forma de pagamento que valia então. Recalcular na leitura faria o recibo de
// março mudar de valor quando o percentual fosse renegociado em setembro — e não
// haveria como provar o que foi acordado. Ver `lib/procedimentoPrestador.js`.
//
// ⚠️ A REGRA DE COBRANÇA NÃO MUDOU: procedimento só entra na fatura — e só entra
// aqui — DEPOIS de executado. Prescrito e não executado não aparece em nenhum dos
// dois documentos.
'use strict';

const prisma = require('../lib/prisma').default;
const { resolverPeriodo } = require('./RelatorioGerencialController');
const { BASES_CALCULO, listarExecucoes, temTabelas } = require('../lib/procedimentoPrestador');

// Texto que EXPLICA a conta de cada linha. Recibo que só mostra o total obriga quem
// paga a confiar; dizendo de onde saiu o número, a conferência é possível.
const EXPLICACAO_BASE = {
  [BASES_CALCULO.VALOR_PROCEDIMENTO]: 'Valor cobrado pelo prestador para este procedimento',
  [BASES_CALCULO.PERCENTUAL_CLIENTE]: 'Percentual sobre o valor cobrado para o cliente',
  [BASES_CALCULO.VALOR_FIXO]:         'Comissão fixa por procedimento',
  [BASES_CALCULO.SALARIO]:            'Remuneração fixa (salário) — não apurada por procedimento',
  [BASES_CALCULO.SEM_CONFIG]:         'Forma de pagamento não cadastrada para este prestador',
};

const arred = (v) => Math.round((Number(v) || 0) * 100) / 100;

/**
 * GET /api/recibos-prestador?granularidade=dia|semana|mes|ano&data=YYYY-MM-DD&prestadorId=
 *
 * Devolve UM recibo por prestador com execuções no período.
 *
 * ⚠️ Prestador SEM execução no período não aparece — recibo de valor zero para quem
 * não trabalhou é ruído, e a lista existe justamente para dizer a quem pagar.
 *
 * ⚠️ `pendentes` conta as linhas em que o valor não pôde ser apurado (prestador sem
 * forma de pagamento cadastrada). Elas ENTRAM no recibo com valor 0 e o aviso à
 * vista, em vez de sumirem: some a linha, some o serviço prestado — e ninguém
 * descobre que faltava um cadastro.
 */
const listar = async (req, res) => {
  try {
    if (!req.empresaId) return res.status(400).json({ error: 'Contexto de empresa não resolvido.' });
    if (!(await temTabelas())) {
      // Base ainda sem a migration `20261001000000`: responde vazio com o motivo, em
      // vez de 500. A tela mostra o aviso e nada mais quebra.
      return res.json({ dados: [], periodo: null, indisponivel: true });
    }

    const periodo = resolverPeriodo(req);
    // `resolverPeriodo` devolve `fim` INCLUSIVO (23:59:59.999) e a consulta usa
    // `< fim`: sem o +1ms, uma execução gravada exatamente no último milissegundo do
    // período ficaria de fora.
    const fimExclusivo = new Date(periodo.fim.getTime() + 1);

    const prestadorId = Number(req.query.prestadorId) || null;
    const execucoes = await listarExecucoes(req.empresaId, {
      inicio: periodo.inicio, fim: fimExclusivo, prestadorId,
    });

    // Agrupa por prestador preservando a ordem que o SQL já deu (nome ASC, data ASC).
    const porPrestador = new Map();
    for (const e of execucoes) {
      if (!porPrestador.has(e.prestadorId)) {
        porPrestador.set(e.prestadorId, {
          prestadorId:   e.prestadorId,
          prestadorNome: e.prestadorNome,
          documento:     e.prestadorDoc,
          tipoServico:   e.prestadorTipo,
          telefone:      e.prestadorTelefone,
          email:         e.prestadorEmail,
          // Forma de pagamento da ÚLTIMA execução do período — é o que descreve o
          // acordo vigente. Se ela mudou no meio do período, cada LINHA continua com
          // a sua própria base (é snapshot), e o cabeçalho fica com a mais recente.
          tipoPagamento:  e.tipoPagamento,
          formaPagamento: e.formaPagamento,
          valorPagamento: e.valorPagamento,
          itens:          [],
          totalCliente:   0,
          totalAPagar:    0,
          pendentes:      0,
        });
      }
      const r = porPrestador.get(e.prestadorId);
      r.itens.push({
        id:            e.id,
        animalId:      e.animalId,
        animal:        e.animalNome,
        procedimento:  e.procedimento,
        quantidade:    e.quantidade,
        valorCliente:  e.valorCliente,
        valor:         e.valorAPagar,
        baseCalculo:   e.baseCalculo,
        explicacao:    EXPLICACAO_BASE[e.baseCalculo] ?? null,
        executadoEm:   e.executadoEm,
        prescricaoId:  e.prescricaoId,
      });
      r.totalCliente = arred(r.totalCliente + e.valorCliente);
      r.totalAPagar  = arred(r.totalAPagar + e.valorAPagar);
      if (e.baseCalculo === BASES_CALCULO.SEM_CONFIG) r.pendentes += 1;
      r.tipoPagamento  = e.tipoPagamento;
      r.formaPagamento = e.formaPagamento;
      r.valorPagamento = e.valorPagamento;
    }

    const dados = [...porPrestador.values()];
    return res.json({
      dados,
      periodo: {
        granularidade: periodo.granularidade,
        inicio:        periodo.inicio,
        fim:           periodo.fim,
      },
      totais: {
        prestadores:  dados.length,
        procedimentos: dados.reduce((a, r) => a + r.itens.length, 0),
        totalCliente: arred(dados.reduce((a, r) => a + r.totalCliente, 0)),
        totalAPagar:  arred(dados.reduce((a, r) => a + r.totalAPagar, 0)),
        pendentes:    dados.reduce((a, r) => a + r.pendentes, 0),
      },
    });
  } catch (err) {
    console.error('ReciboPrestadorController.listar:', err);
    return res.status(500).json({ error: 'Erro ao apurar os recibos de prestador.' });
  }
};

/**
 * GET /api/recibos-prestador/emitente
 * Dados da clínica que EMITE o recibo (razão social, documento e endereço) — é quem
 * paga, e um recibo sem identificar o pagador não serve como comprovante.
 *
 * ⚠️ Só a IDENTIFICAÇÃO. Chave PIX e conta bancária ficam FORA de propósito: aqueles
 * campos existem para o cliente PAGAR a clínica, e imprimi-los num documento que vai
 * ao prestador publicaria os dados de recebimento dela para terceiros.
 */
const emitente = async (req, res) => {
  try {
    if (!req.empresaId) return res.json({ dados: null });
    const emp = await prisma.empresa.findUnique({
      where:  { id: req.empresaId },
      select: {
        nome: true, razaoSocial: true, nomeFantasia: true,
        cnpj: true, documento: true, tipoDocumento: true, inscricaoEstadual: true,
        endereco: true, numero: true, complemento: true, bairro: true,
        cidade: true, estado: true, cep: true, telefone: true, emailContato: true,
      },
    });
    return res.json({ dados: emp ?? null });
  } catch (err) {
    console.error('ReciboPrestadorController.emitente:', err);
    return res.json({ dados: null });
  }
};

module.exports = { listar, emitente };
