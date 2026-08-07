// backend/src/lib/documentoEmpresa.js
//
// DOCUMENTO DA EMPRESA (CPF ou CNPJ) — fonte única da normalização e da unicidade.
//
// A empresa é o TENANT que assina o SaaS: o documento é o que a identifica no mundo
// real, então ele é OBRIGATÓRIO na criação e não se repete entre empresas.
//
// ⚠️ Isto REVERTE, para o documento, a decisão de 2026-06-11 que derrubou o unique
// global de `tb_empresas.cnpj` (migration `20260611120000`). Aquela decisão existia
// porque o GESTOR criava as próprias empresas e podia ter várias — o unique global
// travava o caso legítimo de duas unidades do mesmo dono. Desde 2026-08-06 só o ADMIN
// da plataforma cria empresa, com plano e gestores, e cada empresa é um assinante
// distinto: duas linhas com o mesmo CNPJ passaram a ser duplicata, não filial.
// O unique(ownerId, nome, cnpj) continua existindo — não conflita, só é mais fraco.
//
// ⚠️ DUAS COLUNAS guardam o mesmo dado: `cnpj` (LEGADO, escrito na criação e lido por
// ~60 pontos de código) e `documento`/`tipoDocumento` (cadastro fiscal do assinante).
// A unicidade tem de olhar as DUAS, senão o mesmo CNPJ entra de novo pela coluna que
// ficou de fora. Quem grava passa a preencher as duas com os mesmos dígitos.
'use strict';

const prisma = require('./prisma').default;

/** Documento é comparado e gravado SEM máscara — a máscara é assunto da tela. */
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

/**
 * Normaliza e valida o documento informado.
 *
 * ⚠️ Valida o TAMANHO (11 = CPF, 14 = CNPJ), não os dígitos verificadores — é o mesmo
 * critério que as telas de empresa já aplicavam. Endurecer para o cálculo do DV é
 * decisão à parte: rejeitaria a base de teste inteira.
 *
 * @returns {{ digitos: string, tipo: 'CPF'|'CNPJ' } | { erro: string, code: string }}
 */
function normalizarDocumento(valor, { obrigatorio = true } = {}) {
  const digitos = soDigitos(valor);
  if (!digitos) {
    if (!obrigatorio) return { digitos: null, tipo: null };
    return { erro: 'CPF ou CNPJ é obrigatório.', code: 'DOCUMENTO_OBRIGATORIO' };
  }
  if (digitos.length !== 11 && digitos.length !== 14) {
    return { erro: 'Documento deve ter 11 dígitos (CPF) ou 14 (CNPJ).', code: 'DOCUMENTO_INVALIDO' };
  }
  return { digitos, tipo: digitos.length === 11 ? 'CPF' : 'CNPJ' };
}

/**
 * Empresa que já usa este documento — em `documento` OU no `cnpj` legado.
 *
 * SQL cru porque a comparação é sobre os DÍGITOS: linha antiga pode ter o `cnpj`
 * gravado com máscara, e um `where: { cnpj: digitos }` passaria batido por ela.
 * `tb_empresas` é control plane e não tem RLS (migration `20260806180000`), então a
 * varredura enxerga TODAS as empresas — que é exatamente o que a unicidade exige.
 *
 * @param {string} digitos  documento já normalizado
 * @param {number|null} ignorarEmpresaId  a própria empresa, ao editar
 */
async function empresaComDocumento(digitos, ignorarEmpresaId = null) {
  if (!digitos) return null;
  const ignorar = Number(ignorarEmpresaId);
  const filtroId = Number.isInteger(ignorar) ? ' AND id <> $2' : '';
  const params = Number.isInteger(ignorar) ? [digitos, ignorar] : [digitos];

  const linhas = await prisma.$queryRawUnsafe(
    `SELECT id, nome
       FROM schs2vet.tb_empresas
      WHERE (regexp_replace(COALESCE("documento", ''), '[^0-9]', '', 'g') = $1
          OR regexp_replace(COALESCE("cnpj", ''),      '[^0-9]', '', 'g') = $1)
        ${filtroId}
      LIMIT 1`,
    ...params,
  );
  return linhas?.[0] ?? null;
}

/**
 * Normaliza + garante unicidade numa tacada. Devolve `{ erro, code, status }` para o
 * controller repassar, ou `{ digitos, tipo }` pronto para gravar.
 */
async function resolverDocumento(valor, { obrigatorio = true, ignorarEmpresaId = null } = {}) {
  const doc = normalizarDocumento(valor, { obrigatorio });
  if (doc.erro) return { ...doc, status: 400 };
  if (!doc.digitos) return doc;

  const emUso = await empresaComDocumento(doc.digitos, ignorarEmpresaId);
  if (emUso) {
    return {
      erro:   `Este CPF/CNPJ já está cadastrado para a empresa "${emUso.nome}".`,
      code:   'DOCUMENTO_DUPLICADO',
      status: 409,
    };
  }
  return doc;
}

module.exports = { soDigitos, normalizarDocumento, empresaComDocumento, resolverDocumento };
