'use strict';

const prisma = require('../lib/prisma').default;

function mesReferenciaAtual() {
  return new Date().toISOString().slice(0, 7);
}

/**
 * Garante que existe uma fatura ABERTA para o proprietário DENTRO DE UMA EMPRESA.
 *
 * ⚠️ A regra antiga era "uma fatura por proprietário" — SUBSTITUÍDA pela segregação
 * por empresa (migration 20260812000000). O mesmo cliente atendido por duas clínicas
 * tem DUAS faturas independentes: EmpresaA-Cliente-Fatura e EmpresaB-Cliente-Fatura,
 * sem uma enxergar os itens da outra.
 *
 * Esta função é PREVENTIVA (roda ao aceitar um vínculo vet-animal) e nem todo caller
 * tem a empresa à mão. Sem `empresaId` explícito ela deduz pelo cadastro do cliente e,
 * sendo AMBÍGUO (cliente em várias empresas), NÃO cria nada: uma fatura sem tenancy
 * viraria o depósito dos lançamentos de qualquer clínica — exatamente o vazamento que
 * esta mudança elimina. Nada se perde: no primeiro lançamento real,
 * `getOrCreateFatura(tx, proprietarioId, empresaId)` cria a fatura certa.
 *
 * @param {number} proprietarioId
 * @param {number|null} empresaId - empresa do contexto; informe sempre que souber
 */
async function garantirFaturaAberta(proprietarioId, empresaId = null) {
  if (!proprietarioId) return null;
  const id = Number(proprietarioId);

  let empresa = empresaId ? Number(empresaId) : null;

  if (!empresa) {
    // Dedução só é segura quando o cliente pertence a UMA única empresa
    const perfis = await prisma.proprietarioPerfil.findMany({
      where:    { userId: id },
      select:   { empresaId: true },
      distinct: ['empresaId'],
    });
    if (perfis.length === 1) empresa = perfis[0].empresaId;
    else if (perfis.length > 1) return null; // ambíguo → não cria (ver doc acima)
  }

  const existe = await prisma.fatura.findFirst({
    where: { proprietarioId: id, status: 'ABERTA', empresaId: empresa },
  });
  if (existe) return existe;

  return prisma.fatura.create({
    data: {
      proprietarioId: id,
      empresaId:      empresa,
      mesReferencia:  mesReferenciaAtual(),
      total:          0,
      status:         'ABERTA',
    },
  });
}

module.exports = { garantirFaturaAberta };
