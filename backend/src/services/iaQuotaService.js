// backend/src/services/iaQuotaService.js
// QUOTA DE IA POR CLIENTE (empresa) — o freio do modelo "conta única + metering".
//
// Medir sem limitar é só contabilidade: numa conta única do Google, o rate limit e
// a fatura são COMPARTILHADOS, então um tenant sozinho consegue derrubar a IA de
// todos os outros. Este serviço é o que impede isso.
//
// Default seguro: empresa SEM linha em tb_ia_plano_empresa não tem limite — ligar o
// metering nunca derruba um cliente existente. O limite é opt-in por empresa.
'use strict';

const prisma = require('../lib/prisma').default;

class QuotaIaExcedidaError extends Error {
  constructor(mensagem, detalhe) {
    super(mensagem);
    this.name    = 'QuotaIaExcedidaError';
    this.code    = 'IA_QUOTA_EXCEDIDA';
    this.detalhe = detalhe;
  }
}

/** Primeiro instante do mês corrente (janela de apuração do plano). */
function inicioDoMes(ref = new Date()) {
  return new Date(ref.getFullYear(), ref.getMonth(), 1, 0, 0, 0, 0);
}

/**
 * Consumo do mês corrente de uma empresa.
 * Só conta chamadas com sucesso — falha de provider não é consumo do cliente.
 */
async function consumoDoMes(empresaId, ref = new Date()) {
  const agregado = await prisma.aiUsageLog.aggregate({
    _sum:   { tokensTotal: true, custoUsd: true },
    _count: { id: true },
    where:  { empresaId, sucesso: true, createdAt: { gte: inicioDoMes(ref) } },
  });
  return {
    tokens:   agregado._sum.tokensTotal ?? 0,
    chamadas: agregado._count.id ?? 0,
    custoUsd: agregado._sum.custoUsd ?? 0,
  };
}

async function obterPlano(empresaId) {
  if (!empresaId) return null;
  return prisma.iaPlanoEmpresa.findUnique({ where: { empresaId } });
}

/**
 * Situação da empresa no plano: uso, limites e percentuais.
 * Usado tanto pelo gate quanto pelo painel do ADMIN.
 */
async function situacao(empresaId, ref = new Date()) {
  const [plano, uso] = await Promise.all([obterPlano(empresaId), consumoDoMes(empresaId, ref)]);

  const pct = (usado, limite) =>
    limite && limite > 0 ? Number(((usado / limite) * 100).toFixed(1)) : null;

  const excedeuTokens   = Boolean(plano?.limiteTokensMes   && uso.tokens   >= plano.limiteTokensMes);
  const excedeuChamadas = Boolean(plano?.limiteChamadasMes && uso.chamadas >= plano.limiteChamadasMes);

  return {
    empresaId,
    plano:             plano?.plano ?? null,
    temPlano:          Boolean(plano),
    ativo:             plano?.ativo ?? true,
    bloquearAoExceder: plano?.bloquearAoExceder ?? false,
    limiteTokensMes:   plano?.limiteTokensMes   ?? null,
    limiteChamadasMes: plano?.limiteChamadasMes ?? null,
    uso,
    pctTokens:         pct(uso.tokens,   plano?.limiteTokensMes),
    pctChamadas:       pct(uso.chamadas, plano?.limiteChamadasMes),
    excedeu:           excedeuTokens || excedeuChamadas,
    excedeuTokens,
    excedeuChamadas,
  };
}

/**
 * Gate executado ANTES de gastar token. Lança QuotaIaExcedidaError quando a
 * empresa estourou o plano e o plano está configurado para bloquear.
 *
 * Sem empresaId (ex.: ADMIN global, job sem tenant) NÃO bloqueia — não há cliente
 * a quem atribuir e travar o operador do sistema seria pior que o gasto.
 */
async function garantirQuota(empresaId) {
  if (!empresaId) return null;

  const s = await situacao(empresaId);

  // Plano desativado = IA desligada para o cliente (inadimplência, suspensão)
  if (s.temPlano && !s.ativo) {
    throw new QuotaIaExcedidaError(
      'Os recursos de IA estão desativados para esta empresa.',
      { motivo: 'PLANO_INATIVO', ...s },
    );
  }

  if (s.excedeu && s.bloquearAoExceder) {
    const qual = s.excedeuTokens ? 'de tokens' : 'de chamadas';
    throw new QuotaIaExcedidaError(
      `Limite mensal ${qual} do plano de IA atingido. Fale com o administrador para ampliar o plano.`,
      { motivo: 'LIMITE_ATINGIDO', ...s },
    );
  }

  return s;
}

module.exports = {
  QuotaIaExcedidaError,
  garantirQuota,
  situacao,
  consumoDoMes,
  obterPlano,
  inicioDoMes,
};
