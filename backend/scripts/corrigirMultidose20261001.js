// backend/scripts/corrigirMultidose20261001.js
//
// Correção de DADOS — saldo gravado na unidade errada quando o produto passou a ser
// multidose (ou deixou de ser) ANTES da correção de código de 2026-10-01.
// Ver `.claude/rules/hist-estoque.md`, 2026-10-01 (parte 2).
//
//   A. Zoovit C (Patyvet, estoque 59): 10 → 200 mL (10 frascos), preço R$ 50 → R$ 2,50/mL
//   B. Fatura 133: dose de 1 mL R$ 50 → R$ 2,50; dose de 40 mL R$ 450 → R$ 100,00
//   C. Lotes de vacina 28, 30, 31, 33 presos no item GLOBAL → cópia da clínica, em mL
//   D. Lote 32 (Aftobov, empresa 64, produto sem multidose): 500 mL → 2 frascos
//
// Tudo numa transação: confere o estado esperado antes de cada passo e ABORTA (sem
// gravar nada) se algo mudou desde a análise. Cada mudança deixa movimento/auditoria.
//
// Uso (na pasta backend):   npx ts-node --transpile-only scripts/corrigirMultidose20261001.js --confirmar
// Sem `--confirmar` roda tudo e DESFAZ no fim (simulação).
'use strict';

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const cat = require('../src/lib/catalogoEmpresa');
const { recalcularTotal, registrarCorrecaoFatura } = require('../src/lib/faturaUtils');
const { registrarAuditoria } = require('../src/lib/auditoria');

const CONFIRMAR = process.argv.includes('--confirmar');
const p = new PrismaClient();
const sist = (empresaId) => ({
  user: { id: null, fullName: 'Sistema — correção multidose 01/10/2026', email: '' },
  empresaId, headers: {}, ip: null,
});
const MOTIVO = 'Correção de dados (01/10/2026): saldo gravado na unidade errada quando o produto mudou de multidose — ver hist-estoque 2026-10-01 parte 2.';
class Simulacao extends Error {}

(async () => {
  try {
    await p.$transaction(async (tx) => {
      // Armadilha 42: sem o carimbo o FORCE RLS esconde/recusa as linhas em silêncio.
      await tx.$executeRawUnsafe(`SELECT set_config('app.plataforma','on',true)`);

      // A. Zoovit C — 10 frascos = 200 mL a R$ 2,50/mL
      const e = await tx.estoqueClinica.findUnique({ where: { id: 59 } });
      if (!e || e.qtdEstoque !== 10 || e.pesoPorEmbalagem !== null || e.precoUnitarioBase !== 50) {
        throw new Error('Zoovit (estoque 59) mudou desde a análise: ' + JSON.stringify(e));
      }
      await tx.estoqueClinica.update({ where: { id: 59 }, data: { qtdEstoque: 200, pesoPorEmbalagem: 20, precoUnitarioBase: 2.5 } });
      await tx.movimentoEstoque.create({ data: { estoqueId: 59, tipo: 'AJUSTE', quantidade: 190,
        motivo: 'Correção: o ajuste "0 → 10 frascos" de 01/10 foi gravado como 10 mL (frasco de 20 mL = 200 mL).' } });
      await registrarAuditoria(tx, sist(59), { categoria: 'AJUSTE', entidade: 'ESTOQUE_FARMACIA', entidadeId: 59, motivo: MOTIVO,
        detalhes: 'Zoovit C - frasco 20 mL (lote ssssss): 10 → 200 mL (10 frascos); preço R$ 50,00 → R$ 2,50 por mL' });

      // B. Fatura 133 — doses cobradas ao preço do frasco por mL
      const f = await tx.fatura.findUnique({ where: { id: 133 }, select: { status: true } });
      if (!['ABERTA', 'REABERTA'].includes(f?.status)) throw new Error('Fatura 133 não está aberta: ' + f?.status);
      for (const [id, antigo, novo, desc] of [[358, 50, 2.5, '1 mL'], [359, 450, 100, '40 mL']]) {
        const it = await tx.faturaItem.findUnique({ where: { id } });
        if (!it || it.faturaId !== 133 || it.fechadoEm || it.pagoEm || it.valor !== antigo) {
          throw new Error(`Item ${id} da fatura mudou desde a análise: ` + JSON.stringify(it));
        }
        await tx.faturaItem.update({ where: { id }, data: { valor: novo } });
        await registrarAuditoria(tx, sist(59), { categoria: 'ALTERACAO', entidade: 'FATURA_ITEM', entidadeId: id, animalId: it.animalId, motivo: MOTIVO,
          detalhes: `Zoovit C (dose de ${desc}): R$ ${antigo.toFixed(2)} → R$ ${novo.toFixed(2)} (R$ 2,50/mL)` });
      }
      await recalcularTotal(tx, 133);
      await registrarCorrecaoFatura(tx, 133);

      // C. Lotes presos no item GLOBAL → cópia da clínica (multidose), convertidos
      for (const [loteId, globalId, copiaId, empresaId] of [[28, 1391, 11755, 59], [30, 880, 11757, 59], [31, 880, 11759, 64], [33, 1889, 11761, 59]]) {
        const antes = await tx.loteVacina.findUnique({ where: { id: loteId } });
        if (!antes || antes.medicamentoCatId !== globalId || antes.empresaId !== empresaId || antes.dosesPorFrasco !== 1) {
          throw new Error(`Lote ${loteId} mudou desde a análise: ` + JSON.stringify(antes));
        }
        await tx.loteVacina.update({ where: { id: loteId }, data: { medicamentoCatId: copiaId } });
        await tx.vacinaClinica.updateMany({
          where: { medicamentoCatId: globalId, ativo: true, status: { in: ['SALVA', 'FINALIZADA'] }, animal: { empresaId } },
          data:  { medicamentoCatId: copiaId },
        });
        const estado = (await cat.multidosePorItem(tx, [copiaId])).get(copiaId);
        await cat.reconverterLotesVacinaAtivos(tx, copiaId, estado, empresaId);
        const depois = await tx.loteVacina.findUnique({ where: { id: loteId } });
        await registrarAuditoria(tx, sist(empresaId), { categoria: 'AJUSTE', entidade: 'ESTOQUE_VACINA', entidadeId: loteId, motivo: MOTIVO,
          detalhes: `Lote ${antes.lote}: item ${globalId} (global) → ${copiaId} (da clínica); disponível ${antes.qtdDisponivel} → ${depois.qtdDisponivel} (${depois.dosesPorFrasco}/frasco)` });
        console.log(`lote ${loteId}: ${antes.qtdDisponivel} → ${depois.qtdDisponivel} (${depois.dosesPorFrasco}/frasco), item ${copiaId}`);
      }

      // D. Aftobov (empresa 64) — produto sem multidose, lote ficou em mL → frascos
      const a = await tx.loteVacina.findUnique({ where: { id: 32 } });
      if (!a || a.dosesPorFrasco !== 250 || a.qtdDisponivel !== 500) throw new Error('Lote 32 mudou desde a análise: ' + JSON.stringify(a));
      const estAf = (await cat.multidosePorItem(tx, [11760])).get(11760);
      if (estAf?.multidose) throw new Error('Aftobov (11760) voltou a ser multidose — não converter.');
      await cat.reconverterLotesVacinaAtivos(tx, 11760, estAf, 64);
      const a2 = await tx.loteVacina.findUnique({ where: { id: 32 } });
      await registrarAuditoria(tx, sist(64), { categoria: 'AJUSTE', entidade: 'ESTOQUE_VACINA', entidadeId: 32, motivo: MOTIVO,
        detalhes: `Lote ${a.lote} (Aftobov, sem multidose): ${a.qtdDisponivel}/${a.qtdTotal} mL → ${a2.qtdDisponivel}/${a2.qtdTotal} frascos` });
      console.log(`lote 32: ${a.qtdDisponivel} → ${a2.qtdDisponivel} (${a2.dosesPorFrasco}/frasco)`);

      console.log('Zoovit:', await tx.estoqueClinica.findUnique({ where: { id: 59 }, select: { qtdEstoque: true, pesoPorEmbalagem: true, precoUnitarioBase: true } }));
      console.log('Fatura 133:', await tx.fatura.findUnique({ where: { id: 133 }, select: { total: true } }));
      if (!CONFIRMAR) throw new Simulacao();
    }, { timeout: 60000 });
    console.log('✅ GRAVADO.');
  } catch (err) {
    if (err instanceof Simulacao) console.log('Simulação concluída — nada foi gravado. Rode com --confirmar para aplicar.');
    else console.error('ABORTADO (nada foi gravado):', err.message);
  } finally {
    await p.$disconnect();
  }
})();
