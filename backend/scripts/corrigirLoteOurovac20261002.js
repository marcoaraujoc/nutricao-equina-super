/* eslint-disable no-console */
'use strict';
/**
 * Correção de DADO — 2026-10-02 — Patyvet (empresa 59), lote de vacina 37.
 *
 * O QUE ACONTECEU: a clínica editou "Ourovac® Raiva - frasco 50 mL" em
 * /cadastro/produtos (forma de cálculo "doses", 2 doses por frasco). Como o item era
 * GLOBAL (1582), nasceu a CÓPIA da empresa (11769). Dois minutos depois a entrada de
 * estoque foi feita escolhendo o GLOBAL no seletor (que listava os dois): o lote 37
 * nasceu em 1582 com 4 frascos × 1 = 4. A Prescrição só mostra a cópia → "sem estoque".
 *
 * O QUE ESTE SCRIPT FAZ (só o lote 37):
 *   - aponta o lote para a cópia 11769;
 *   - reexpressa o saldo no conteúdo da cópia (2 doses/frasco): mesma conta de
 *     `catalogoEmpresa.reconverterLotesVacinaAtivos` (físico preservado: 4 frascos);
 *   - grava a trilha na auditoria.
 *
 * ⚠️ Os lotes 28/30/31/33 (mesmo estado) NÃO entram: são do
 * `corrigirMultidose20261001.js`, ainda não executado.
 *
 * Uso:  node scripts/corrigirLoteOurovac20261002.js            (simula)
 *       node scripts/corrigirLoteOurovac20261002.js --confirmar (grava)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

const EMPRESA = 59;
const LOTE    = 37;
const GLOBAL  = 1582;
const COPIA   = 11769;
const CONFIRMAR = process.argv.includes('--confirmar');

const prisma = new PrismaClient();

async function main() {
  await prisma.$transaction(async (tx) => {
    // FORCE RLS: sem o carimbo, SELECT devolve 0 e UPDATE afeta 0 — com sucesso (armadilha 42).
    await tx.$executeRawUnsafe(`SELECT set_config('app.plataforma','on',true)`);

    const [lote] = await tx.$queryRawUnsafe(
      `SELECT id, medicamento_cat_id, empresa_id, ativo, qtd_frascos, qtd_total, qtd_disponivel,
              doses_por_frasco, estoque_minimo, estoque_alarmante
         FROM schs2vet.tb_lotes_vacina WHERE id = $1`, LOTE);
    const [copia] = await tx.$queryRawUnsafe(
      `SELECT id, nome, empresa_id, ativo, multidose, doses_por_embalagem, forma_calculo
         FROM schs2vet.tb_medicamentos WHERE id = $1`, COPIA);

    console.log('ANTES', { lote, copia });

    // Estado esperado — qualquer divergência aborta sem tocar em nada.
    if (!lote || Number(lote.medicamento_cat_id) !== GLOBAL || Number(lote.empresa_id) !== EMPRESA || !lote.ativo) {
      throw new Error('Lote 37 não está no estado esperado (global 1582, empresa 59, ativo). Nada alterado.');
    }
    if (!copia || Number(copia.empresa_id) !== EMPRESA || !copia.ativo) {
      throw new Error('Cópia 11769 não está no estado esperado. Nada alterado.');
    }
    const reservas = await tx.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM schs2vet.tb_reservas_estoque_vacina WHERE "loteVacinaId" = $1`, LOTE);
    if (reservas[0].n > 0) throw new Error('Lote 37 tem reserva — tratar à parte. Nada alterado.');

    const renderAntes  = Number(lote.doses_por_frasco) > 0 ? Number(lote.doses_por_frasco) : 1;
    const renderDepois = copia.multidose && Number(copia.doses_por_embalagem) > 0 && copia.forma_calculo
      ? Number(copia.doses_por_embalagem) : 1;
    const fator = renderDepois / renderAntes;

    await tx.$executeRawUnsafe(
      `UPDATE schs2vet.tb_lotes_vacina
          SET medicamento_cat_id = $2,
              qtd_total          = qtd_total         * $3,
              qtd_disponivel     = qtd_disponivel    * $3,
              estoque_minimo     = estoque_minimo    * $3,
              estoque_alarmante  = estoque_alarmante * $3,
              doses_por_frasco   = $4
        WHERE id = $1`,
      LOTE, COPIA, fator, renderDepois);

    await tx.$executeRawUnsafe(
      `INSERT INTO schs2vet.tb_audit_logs
         ("userId", "userName", "email", "action", "empresaId", "categoria", "entidade", "entidadeId", "animalId", "motivo", "detalhes", "ip")
       VALUES (NULL, 'Sistema', '', 'ALTERACAO ESTOQUE_VACINA', $1, 'ALTERACAO', 'ESTOQUE_VACINA', $2, NULL, $3, $4, NULL)`,
      EMPRESA, LOTE,
      'Correção: lote lançado no item global em vez da cópia da clínica',
      `Lote ${LOTE}: medicamento ${GLOBAL} → ${COPIA} (cópia da clínica); doses por frasco ${renderAntes} → ${renderDepois}; `
        + `saldo ${lote.qtd_disponivel} → ${Number(lote.qtd_disponivel) * fator} (${lote.qtd_frascos} frascos).`);

    const [depois] = await tx.$queryRawUnsafe(
      `SELECT id, medicamento_cat_id, qtd_frascos, qtd_total, qtd_disponivel, doses_por_frasco
         FROM schs2vet.tb_lotes_vacina WHERE id = $1`, LOTE);
    console.log('DEPOIS', depois);

    if (!CONFIRMAR) throw new Error('__SIMULACAO__');
  }).catch((e) => {
    if (e.message === '__SIMULACAO__') { console.log('\nSIMULAÇÃO — nada gravado. Rode com --confirmar.'); return; }
    throw e;
  });
  if (CONFIRMAR) console.log('\nGRAVADO.');
}

main()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
