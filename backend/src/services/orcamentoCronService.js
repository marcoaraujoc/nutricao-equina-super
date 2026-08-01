// backend/src/services/orcamentoCronService.js
// Rotina corporativa (global): cancela os ORÇAMENTOS que passaram da validade
// configurada pela empresa (Configurações → "Validade do orçamento"). Registrada como
// job em server.ts via cronManager — horário e liga/desliga ficam com o ADMIN na tela
// de Configuração (CronAgenda). Opera sobre TODAS as empresas que configuraram prazo;
// empresa sem validade (null) não expira nada.
'use strict';

const prisma = require('../lib/prisma').default;
const { listarEscoposComValidade } = require('../lib/validadeOrcamento');

// Status que a validade NÃO toca. APROVADO e APROVADO_PARCIALMENTE já viraram
// compromisso — vão para a prescrição/fatura e não podem sumir por prazo. CANCELADO
// está fora porque já é o destino.
const STATUS_PRESERVADOS = ['APROVADO', 'APROVADO_PARCIALMENTE', 'CANCELADO'];

const motivoCancelamento = (dias) =>
  `Cancelado automaticamente pelo sistema — validade de ${dias} dia(s) expirada sem aprovação.`;

/**
 * Cancela os orçamentos vencidos de cada escopo de configuração.
 *
 * Escopo: config de empresa com CNPJ (equipeId null) vale para a empresa inteira;
 * config de empresa pessoal (por equipe) vale só para os orçamentos daquela equipe —
 * mesmo critério de EmpresaConfiguracao em todo o resto do sistema.
 *
 * A contagem é a partir de `createdAt`: a validade é do documento, não da última
 * edição — senão mexer no orçamento renovaria o prazo sozinho.
 *
 * @returns ResultadoCron para o comAlerta/reportarCron (Monitoração + e-mail ADMIN).
 */
async function cancelarOrcamentosVencidos() {
  const escopos = await listarEscoposComValidade();
  if (escopos.length === 0) return { ok: true, notificar: false };

  const agora = Date.now();
  let total = 0;
  const porEmpresa = [];

  for (const escopo of escopos) {
    const limite = new Date(agora - escopo.dias * 24 * 60 * 60 * 1000);

    const vencidos = await prisma.orcamento.findMany({
      where: {
        empresaId: escopo.empresaId,
        ...(escopo.equipeId != null && { equipeId: escopo.equipeId }),
        ativo:     true,
        status:    { notIn: STATUS_PRESERVADOS },
        createdAt: { lt: limite },
      },
      select: { id: true, numero: true, observacao: true },
    });
    if (vencidos.length === 0) continue;

    const motivo = motivoCancelamento(escopo.dias);
    // Um update por linha: a observação do orçamento é do usuário — o motivo é
    // ACRESCENTADO, nunca sobrescreve o que ele escreveu.
    for (const orc of vencidos) {
      await prisma.orcamento.update({
        where: { id: orc.id },
        data:  {
          status:     'CANCELADO',
          observacao: [orc.observacao?.trim(), motivo].filter(Boolean).join('\n'),
        },
      });
    }

    total += vencidos.length;
    porEmpresa.push(`empresa ${escopo.empresaId}: ${vencidos.length}`);
  }

  if (total === 0) return { ok: true, notificar: false };

  return {
    ok: true,
    notificar: true,
    resumo: `${total} orçamento(s) cancelado(s) por validade expirada (${porEmpresa.join('; ')}).`,
  };
}

module.exports = { cancelarOrcamentosVencidos, STATUS_PRESERVADOS, motivoCancelamento };
