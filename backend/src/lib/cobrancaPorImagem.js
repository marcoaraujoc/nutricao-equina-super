'use strict';
/**
 * COBRANÇA DO EXAME DE IMAGEM: valor ÚNICO × POR IMAGEM (2026-09-30)
 *
 * 🔴 POR QUE EXISTE: o pedido de exame de imagem tem "Quantidade de imagens"
 * (`tb_exames_clinicos.qtd_amostra`), mas o preço saía sempre pelo exame inteiro —
 * 3 imagens de uma radiografia cadastrada a R$ 80 iam para a fatura por R$ 80.
 * `tb_procedimentos_vet.cobranca_por_imagem = true` diz que o valor cadastrado é o de
 * UMA imagem e deve ser multiplicado pela quantidade do pedido.
 *
 * 🔴 LEITURA/ESCRITA SEMPRE por aqui, em SQL cru com guarda de coluna: a coluna é da
 * migration `20261030000000` e o client Prisma pode não conhecê-la (§11 — no Windows o
 * `prisma generate` falha com o backend no ar). Base não migrada = valor único para
 * todo mundo, que é exatamente o comportamento anterior.
 *
 * ⚠️ A flag mora na LINHA do procedimento. Linha GLOBAL não é escrita pela clínica:
 * quem chama passa pelo copy-on-write (`garantirCopiaProcedimento`) antes de gravar.
 */

const prisma = require('./prisma').default;

let _temColuna = null;
async function temColuna() {
  if (_temColuna !== null) return _temColuna;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'schs2vet' AND table_name = 'tb_procedimentos_vet'
          AND column_name = 'cobranca_por_imagem'`);
    _temColuna = rows.length === 1;
  } catch { _temColuna = false; }
  return _temColuna;
}

/** Map id → boolean. Base sem a coluna devolve Map vazio (= valor único). */
async function lerCobrancaPorImagem(client, ids) {
  const lista = [...new Set((Array.isArray(ids) ? ids : [ids]).map(Number).filter(Number.isInteger))];
  const vazio = new Map();
  if (lista.length === 0 || !(await temColuna())) return vazio;
  try {
    const ph = lista.map((_, i) => `$${i + 1}`).join(', ');
    const rows = await client.$queryRawUnsafe(
      `SELECT id, cobranca_por_imagem FROM schs2vet.tb_procedimentos_vet WHERE id IN (${ph})`,
      ...lista);
    return new Map(rows.map(r => [Number(r.id), r.cobranca_por_imagem === true]));
  } catch { return vazio; }
}

/**
 * Grava a flag. Lança erro legível se a base ainda não tem a coluna — gravar em
 * silêncio "nada" faria a tela afirmar uma cobrança por imagem que não existe.
 */
async function gravarCobrancaPorImagem(client, procedimentoId, porImagem) {
  if (!(await temColuna())) {
    throw Object.assign(new Error(
      'A cobrança por imagem ainda não está disponível nesta base (migration 20261030000000_procedimento_cobranca_por_imagem pendente).'),
    { status: 400 });
  }
  await client.$executeRawUnsafe(
    `UPDATE schs2vet.tb_procedimentos_vet SET cobranca_por_imagem = $2 WHERE id = $1`,
    Number(procedimentoId), porImagem === true);
}

/** Copia a flag da linha de origem para a cópia da empresa (copy-on-write). */
async function copiarCobrancaPorImagem(client, deId, paraId) {
  if (!(await temColuna())) return;
  await client.$executeRawUnsafe(
    `UPDATE schs2vet.tb_procedimentos_vet
        SET cobranca_por_imagem = (SELECT cobranca_por_imagem FROM schs2vet.tb_procedimentos_vet WHERE id = $1)
      WHERE id = $2`,
    Number(deId), Number(paraId));
}

module.exports = {
  temColuna,
  lerCobrancaPorImagem,
  gravarCobrancaPorImagem,
  copiarCobrancaPorImagem,
};
