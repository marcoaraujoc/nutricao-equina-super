// backend/src/services/orcamentoAvisoService.js
//
// AVISOS DE ORÇAMENTO EM ABERTO, por WhatsApp, para o(s) GESTOR(es) da clínica
// (pedido de 2026-09-08). Dois avisos, com propósitos diferentes:
//
//   1. SEMANAL — "existe orçamento esperando decisão". É acompanhamento: o orçamento
//      parado não avisa sozinho, e sem isso ele só reaparece no dia em que o sistema
//      o cancela, quando já não há o que fazer.
//   2. VÉSPERA — "este vai ser cancelado amanhã". É a última janela para aprovar,
//      renegociar ou estender. Vai marcado em VERMELHO (🔴 e caixa alta no verbo),
//      porque a diferença entre os dois avisos é justamente a urgência: um chegando
//      igual ao outro seria lido igual, e o da véspera perderia a função.
//
// 🔴 QUEM RECEBE É O GESTOR, não o cliente. O orçamento parado é problema comercial
// da clínica; mandar cobrança de decisão ao proprietário é outra decisão de produto,
// e não foi pedida.
//
// ⚠️ TUDO passa pelo `tx` de `comTenant` (regra dos crons, §12/2026-08-23): fora dele
// o RLS devolve ZERO linha em silêncio, e o job termina "sem trabalho" todo dia.
'use strict';

const logger = require('../lib/logger');
const whatsappService = require('./whatsappService');
const { comTenant } = require('../lib/tenantDb');
const { empresasAtivas } = require('../lib/cronTenant');
const { passo } = require('../lib/cronTrace');
const { listarEscoposComValidade } = require('../lib/validadeOrcamento');
const { STATUS_PRESERVADOS } = require('./orcamentoCronService');

const DIA_MS = 24 * 60 * 60 * 1000;

/** Quantos orçamentos são nomeados na mensagem antes de virar "e mais N". */
const MAX_NA_MENSAGEM = 5;

const num = (n) => `#${String(n).padStart(4, '0')}`;
const brl = (v) => `R$ ${Number(v ?? 0).toFixed(2).replace('.', ',')}`;

/**
 * Orçamentos que ainda esperam decisão no escopo. Mesma definição do job de validade
 * (`STATUS_PRESERVADOS`): aprovado, aprovado em parte e cancelado já foram decididos.
 */
async function abertosDoEscopo(tx, escopo) {
  return tx.orcamento.findMany({
    where: {
      empresaId: escopo.empresaId,
      ...(escopo.equipeId != null && { equipeId: escopo.equipeId }),
      ativo:  true,
      status: { notIn: STATUS_PRESERVADOS },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, numero: true, createdAt: true,
      proprietario: { select: { fullName: true } },
      itens: { select: { valorTotal: true } },
    },
  });
}

/** Telefones dos gestores da empresa, sem repetição e sem os que não têm número. */
async function telefonesDosGestores(tx, empresaId) {
  const gestores = await tx.membroEquipe.findMany({
    where:  { equipe: { empresaId }, cargo: 'GESTOR' },
    select: { user: { select: { id: true, fullName: true, phone: true } } },
  });
  const porTelefone = new Map();
  for (const g of gestores) {
    const fone = String(g.user?.phone ?? '').replace(/\D/g, '');
    // ⚠️ Sem telefone não há aviso — e isso NÃO é erro: o gestor pode não ter
    // cadastrado o número. O job segue com os outros em vez de falhar o lote.
    if (fone) porTelefone.set(fone, { nome: g.user?.fullName ?? 'Gestor', fone });
  }
  return [...porTelefone.values()];
}

/** Uma linha por orçamento, com o que o gestor precisa para agir. */
function linhaDoOrcamento(o, sufixo = '') {
  const total = o.itens.reduce((s, i) => s + (i.valorTotal ?? 0), 0);
  const dono  = o.proprietario?.fullName ?? 'cliente';
  return `• ${num(o.numero)} — ${dono} — ${brl(total)}${sufixo}`;
}

function corpoComLimite(orcamentos, montarLinha) {
  const mostrados = orcamentos.slice(0, MAX_NA_MENSAGEM).map(montarLinha);
  const resto = orcamentos.length - mostrados.length;
  // Nomear todos numa clínica com 40 orçamentos abertos produziria uma mensagem que
  // ninguém lê no celular — e o WhatsApp trunca de qualquer jeito.
  if (resto > 0) mostrados.push(`• …e mais ${resto} orçamento(s).`);
  return mostrados.join('\n');
}

async function enviarAosGestores(tx, escopo, texto, rotulo) {
  const gestores = await telefonesDosGestores(tx, escopo.empresaId);
  if (gestores.length === 0) {
    passo(`empresa ${escopo.empresaId}: ${rotulo} — nenhum gestor com telefone cadastrado`);
    return 0;
  }
  let enviados = 0;
  for (const g of gestores) {
    const r = await whatsappService
      .sendMessage({ empresaId: escopo.empresaId, equipeId: escopo.equipeId }, g.fone, texto)
      .catch(err => ({ sucesso: false, erro: err?.message }));
    if (r?.sucesso) enviados += 1;
    else logger.warn(`[OrcamentoAviso] ${rotulo} não enviado a ${g.nome} (empresa ${escopo.empresaId}): ${r?.erro ?? 'motivo desconhecido'}`);
  }
  return enviados;
}

/**
 * AVISO SEMANAL — existe orçamento esperando decisão.
 *
 * ⚠️ Roda em TODA empresa ativa, inclusive as SEM validade configurada: o orçamento
 * parado é problema mesmo onde ele nunca expira. Quem tem validade ganha, na linha, há
 * quantos dias está aberto e quantos faltam.
 */
async function avisarOrcamentosEmAberto() {
  const empresas = await empresasAtivas();
  let total = 0, empresasAvisadas = 0;
  const resumo = [];

  for (const empresa of empresas) {
    const r = await comTenant(empresa.id, async (tx) => {
      // Sem config de validade o escopo é a empresa inteira (equipeId null).
      const escopos = await listarEscoposComValidade(tx);
      const doEscopo = escopos.length ? escopos : [{ empresaId: empresa.id, equipeId: null, dias: null }];
      let enviados = 0, abertos = 0;

      for (const escopo of doEscopo) {
        const lista = await abertosDoEscopo(tx, escopo);
        if (lista.length === 0) continue;
        abertos += lista.length;

        const corpo = corpoComLimite(lista, (o) => {
          const dias = diasEmAberto(o.createdAt);
          const restam = escopo.dias != null ? escopo.dias - dias : null;
          const sufixo = restam == null
            ? ` — aberto há ${dias} dia(s)`
            : ` — aberto há ${dias} dia(s), ${restam <= 0 ? 'vencido' : `expira em ${restam} dia(s)`}`;
          return linhaDoOrcamento(o, sufixo);
        });

        const texto = `📋 *Orçamentos aguardando decisão*\n\n`
          + `${lista.length} orçamento(s) em aberto:\n${corpo}\n\n`
          + `Acompanhe em Financeiro › Orçamento.`;
        enviados += await enviarAosGestores(tx, escopo, texto, 'aviso semanal');
      }
      return { enviados, abertos };
    });

    passo(`empresa ${empresa.id}: ${r.abertos} orçamento(s) em aberto → ${r.enviados} aviso(s) enviado(s)`);
    if (r.enviados > 0) { total += r.enviados; empresasAvisadas += 1; resumo.push(`empresa ${empresa.id}: ${r.abertos} aberto(s)`); }
  }

  if (total === 0) return { ok: true, notificar: false };
  return {
    ok: true, notificar: true,
    resumo: `${total} aviso(s) de orçamento em aberto enviado(s) a gestores de ${empresasAvisadas} empresa(s) (${resumo.join('; ')}).`,
  };
}

/**
 * AVISO DA VÉSPERA — o orçamento será cancelado amanhã.
 *
 * 🔴 A JANELA É O DIA EXATO, não "faltam <= 1 dia": rodando diariamente, um `<=`
 * reenviaria o mesmo alerta todo dia até o cancelamento, e alerta repetido é alerta
 * ignorado. `dias === validade - 1` dispara UMA vez, na véspera.
 *
 * ⚠️ Só existe onde há validade configurada — sem prazo não há véspera de nada.
 */
async function avisarOrcamentosAExpirar() {
  const empresas = await empresasAtivas();
  let total = 0;
  const resumo = [];

  for (const empresa of empresas) {
    const r = await comTenant(empresa.id, async (tx) => {
      const escopos = await listarEscoposComValidade(tx);
      let enviados = 0, naVespera = 0;

      for (const escopo of escopos) {
        if (escopo.dias == null) continue;
        const lista = await abertosDoEscopo(tx, escopo);
        const vespera = lista.filter(o => ehVespera(o.createdAt, escopo.dias));
        if (vespera.length === 0) continue;
        naVespera += vespera.length;

        // 🔴 "EM VERMELHO" no WhatsApp é 🔴 + caixa alta no verbo: o app não tem cor
        // de texto, e prometer uma que não existe deixaria o alerta igual ao semanal.
        const corpo = corpoComLimite(vespera, (o) => linhaDoOrcamento(o));
        const texto = `🔴 *ATENÇÃO — orçamento vence hoje*\n\n`
          + `${vespera.length} orçamento(s) SERÃO CANCELADOS AMANHÃ por falta de decisão:\n${corpo}\n\n`
          + `Validade configurada: ${escopo.dias} dia(s).\n`
          + `Para manter, aprove ou renegocie hoje em Financeiro › Orçamento.`;
        enviados += await enviarAosGestores(tx, escopo, texto, 'aviso de véspera');
      }
      return { enviados, naVespera };
    });

    passo(`empresa ${empresa.id}: ${r.naVespera} orçamento(s) na véspera → ${r.enviados} aviso(s) enviado(s)`);
    if (r.enviados > 0) { total += r.enviados; resumo.push(`empresa ${empresa.id}: ${r.naVespera} na véspera`); }
  }

  if (total === 0) return { ok: true, notificar: false };
  return {
    ok: true, notificar: true,
    resumo: `${total} aviso(s) de véspera de cancelamento enviado(s) (${resumo.join('; ')}).`,
  };
}

/**
 * Dias corridos entre a criação e agora. Fonte única das duas rotinas e do teste —
 * a conta duplicada divergiria no primeiro ajuste de fuso.
 */
function diasEmAberto(createdAt, agora = Date.now()) {
  return Math.floor((agora - new Date(createdAt).getTime()) / DIA_MS);
}

/** Este orçamento está na VÉSPERA do cancelamento? */
function ehVespera(createdAt, validadeDias, agora = Date.now()) {
  if (validadeDias == null) return false;
  return diasEmAberto(createdAt, agora) === validadeDias - 1;
}

module.exports = {
  avisarOrcamentosEmAberto,
  avisarOrcamentosAExpirar,
  // exportados para teste
  linhaDoOrcamento, corpoComLimite, diasEmAberto, ehVespera, MAX_NA_MENSAGEM,
};
