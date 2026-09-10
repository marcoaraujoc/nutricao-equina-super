// backend/src/lib/dadosRecebimento.js
//
// DADOS DE RECEBIMENTO da clínica — chave PIX, recebedor, banco, agência e conta
// (migration `20260928000000_empresa_dados_recebimento`). Impressos no rodapé da
// FATURA: até 2026-09-08 o cliente recebia o documento e não tinha para onde pagar.
//
// 🔴 SQL CRU, COM `catch`, PELO MOTIVO DE SEMPRE (§11): no Windows o `prisma generate`
// falha com o backend rodando, então o client pode não conhecer as colunas. Um
// `select`/`data` tipado ali derrubaria a tela de Configurações e a impressão da
// fatura INTEIRAS numa máquina que ainda não regenerou; assim, o pior caso é o bloco
// de pagamento não sair na folha.
'use strict';

const prisma = require('./prisma').default;

const CAMPOS = ['pixChave', 'pixRecebedor', 'banco', 'agencia', 'contaCorrente'];

const VAZIO = { pixChave: null, pixRecebedor: null, banco: null, agencia: null, contaCorrente: null };

/** Lê os cinco campos da empresa. Base não migrada devolve tudo `null`. */
async function lerDadosRecebimento(empresaId, db = prisma) {
  if (!empresaId) return { ...VAZIO };
  const linhas = await db.$queryRaw`
    SELECT "pix_chave" AS "pixChave", "pix_recebedor" AS "pixRecebedor",
           "banco", "agencia", "conta_corrente" AS "contaCorrente"
      FROM "schs2vet"."tb_empresas" WHERE "id" = ${Number(empresaId)} LIMIT 1
  `.catch(() => []);
  const r = linhas?.[0];
  if (!r) return { ...VAZIO };
  // Normaliza string vazia para null: o que está em branco não é impresso, e "" e
  // null precisam significar a mesma coisa para a folha.
  return Object.fromEntries(CAMPOS.map(c => [c, (r[c] ?? '').toString().trim() || null]));
}

/**
 * Grava os cinco campos. String vazia vira NULL — é o que permite APAGAR um dado
 * bancário trocado, que é o caso em que errar custa caro.
 * ⚠️ Nunca lança: o resto do cadastro da empresa já foi gravado pelo caller.
 */
async function salvarDadosRecebimento(db, empresaId, dados = {}) {
  const v = (k, max) => {
    const t = String(dados[k] ?? '').trim();
    return t ? t.slice(0, max) : null;
  };
  await db.$executeRaw`
    UPDATE "schs2vet"."tb_empresas"
       SET "pix_chave"      = ${v('pixChave', 140)},
           "pix_recebedor"  = ${v('pixRecebedor', 255)},
           "banco"          = ${v('banco', 100)},
           "agencia"        = ${v('agencia', 20)},
           "conta_corrente" = ${v('contaCorrente', 30)}
     WHERE "id" = ${Number(empresaId)}
  `.catch(() => {});
}

/**
 * O bloco tem algo a imprimir? Sem NENHUM dos cinco, a fatura não ganha uma faixa
 * "Dados para pagamento" vazia — é a regra do campo vazio (§12, 26/08).
 */
const temDadosRecebimento = (d) => CAMPOS.some(c => d?.[c]);

module.exports = { lerDadosRecebimento, salvarDadosRecebimento, temDadosRecebimento, CAMPOS };
