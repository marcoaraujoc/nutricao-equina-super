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
  const agora = Date.now();
  let total = 0;
  const porEmpresa = [];

  // ⚠️ Este job JÁ percorria empresa a empresa — a validade é de `EmpresaConfiguracao`.
  // O que faltava era CARIMBAR o tenant: sem o `comTenant`, as consultas rodavam sem
  // `app.empresa_id` e, depois da fase 7c, o RLS as devolveria vazias. O filtro
  // `empresaId: escopo.empresaId` continua no `where` de propósito — o RLS é a garantia
  // no banco, não substituto do filtro explícito da aplicação.
  const { comTenant } = require('../lib/tenantDb');
  const { empresasAtivas } = require('../lib/cronTenant');
  const { passo } = require('../lib/cronTrace');

  // 🔴 A LISTA DE ESCOPOS TAMBÉM PRECISA DE TENANT.
  //
  // Ela vinha de `listarEscoposComValidade()` sem cliente — ou seja, do `prisma` global,
  // sem `app.empresa_id`. `tb_empresa_configuracoes` está sob RLS: a consulta voltava
  // VAZIA, o job saía no `if (escopos.length === 0)` da primeira linha e nenhum orçamento
  // jamais expirava. Silencioso porque "nenhuma clínica configurou validade" e "o RLS
  // escondeu todas" produzem exatamente o mesmo retorno.
  //
  // `empresasAtivas()` lê `tb_empresas`, que é CONTROL PLANE (sem RLS) — é o ponto de
  // partida legítimo para varrer as clínicas, o mesmo de `paraCadaEmpresa`.
  const empresas = await empresasAtivas();
  const escopos = [];
  for (const empresa of empresas) {
    const doTenant = await comTenant(empresa.id, (tx) => listarEscoposComValidade(tx));
    escopos.push(...doTenant);
  }
  passo(`Orcamento-Validade: ${escopos.length} escopo(s) com validade configurada, em ${empresas.length} empresa(s) ativa(s)`);
  if (escopos.length === 0) return { ok: true, notificar: false };

  for (const escopo of escopos) {
    const limite = new Date(agora - escopo.dias * 24 * 60 * 60 * 1000);

    const n = await comTenant(escopo.empresaId, async (tx) => {
      const vencidos = await tx.orcamento.findMany({
        where: {
          empresaId: escopo.empresaId,
          ...(escopo.equipeId != null && { equipeId: escopo.equipeId }),
          ativo:     true,
          status:    { notIn: STATUS_PRESERVADOS },
          createdAt: { lt: limite },
        },
        select: { id: true, numero: true, observacao: true },
      });
      if (vencidos.length === 0) return 0;

      const motivo = motivoCancelamento(escopo.dias);
      // Um update por linha: a observação do orçamento é do usuário — o motivo é
      // ACRESCENTADO, nunca sobrescreve o que ele escreveu.
      for (const orc of vencidos) {
        await tx.orcamento.update({
          where: { id: orc.id },
          data:  {
            status:     'CANCELADO',
            observacao: [orc.observacao?.trim(), motivo].filter(Boolean).join('\n'),
          },
        });
      }
      return vencidos.length;
    });

    passo(`empresa ${escopo.empresaId}${escopo.equipeId != null ? ` / equipe ${escopo.equipeId}` : ''}: validade ${escopo.dias} dia(s) → ${n} orçamento(s) cancelado(s)`);
    if (n === 0) continue;
    total += n;
    porEmpresa.push(`empresa ${escopo.empresaId}: ${n}`);
  }

  if (total === 0) return { ok: true, notificar: false };

  return {
    ok: true,
    notificar: true,
    resumo: `${total} orçamento(s) cancelado(s) por validade expirada (${porEmpresa.join('; ')}).`,
  };
}

module.exports = { cancelarOrcamentosVencidos, STATUS_PRESERVADOS, motivoCancelamento };
