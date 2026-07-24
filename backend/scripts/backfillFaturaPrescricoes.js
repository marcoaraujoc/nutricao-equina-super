// backend/scripts/backfillFaturaPrescricoes.js
//
// Corrige o histórico anterior às mudanças de 2026-07-23 (lançamento na finalização +
// valor do orçamento na fatura). Três passos, todos idempotentes:
//
//   1. Reconstrói a origem no orçamento dos itens de prescrição já importados
//      (`valorOrcado`/`orcamentoItemId`), casando por animal + descrição.
//   2. Lança na fatura os itens de prescrições FINALIZADO/EXECUTADO que ficaram sem
//      FaturaItem (antes o lançamento só acontecia na execução).
//   3. Atualiza para o valor orçado os FaturaItem que ficaram zerados por não terem
//      preço no catálogo/estoque.
//
// Uso:  node scripts/backfillFaturaPrescricoes.js            (simulação — não grava)
//       node scripts/backfillFaturaPrescricoes.js --aplicar  (grava)
'use strict';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const APLICAR = process.argv.includes('--aplicar');
const STATUS_LANCAVEIS = ['FINALIZADO', 'EXECUTADO', 'CANCELADO_PARCIALMENTE'];

const norm = (s) => String(s ?? '').trim().toLowerCase();
const fmt  = (v) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const numAtendimento = (evo) =>
  evo?.tipoAtendimento && evo?.numero != null
    ? `${evo.tipoAtendimento}-${String(evo.numero).padStart(4, '0')}`
    : null;

// Valor de um PROCEDIMENTO pelo NOME — mesma ordem do PrescricaoGrupoController:
// combo da empresa > valor da empresa p/ o procedimento > valorVenda do catálogo > 0.
async function resolverValorProcedimento(empresaId, nome) {
  const n = (nome ?? '').trim();
  if (!n) return 0;
  if (empresaId) {
    const combo = await prisma.procedimentoCombo.findFirst({
      where:  { empresaId, ativo: true, nome: { equals: n, mode: 'insensitive' } },
      select: { valor: true },
    });
    if (combo) return combo.valor ?? 0;
  }
  const proc = await prisma.procedimentoVeterinario.findFirst({
    where:  { nome: { equals: n, mode: 'insensitive' }, ativo: true },
    select: { id: true, valorVenda: true },
  });
  if (!proc) return 0;
  if (empresaId) {
    const ve = await prisma.procedimentoValorEmpresa.findFirst({
      where:  { empresaId, procedimentoId: proc.id },
      select: { valor: true },
    });
    if (ve) return ve.valor ?? 0;
  }
  return proc.valorVenda ?? 0;
}

function descricaoItem(item, atendNum) {
  const dose = item.dosagem ? `${item.dosagem}${item.unidade ?? ''} × ${item.frequencia}` : item.frequencia;
  const base = item.tipo === 'MEDICAMENTO' ? `${item.medicamento} — ${dose}` : item.medicamento;
  return atendNum ? `[${atendNum}] ${base}` : base;
}

async function main() {
  console.log(APLICAR ? '### APLICANDO ###' : '### SIMULAÇÃO (use --aplicar para gravar) ###');

  const grupos = await prisma.prescricaoGrupo.findMany({
    where:   { status: { in: STATUS_LANCAVEIS } },
    include: {
      itens:    { where: { ativo: true } },
      evolucao: { select: { tipoAtendimento: true, numero: true } },
      animal:   { select: { id: true, nome: true, userId: true } },
    },
    orderBy: { id: 'asc' },
  });

  // ── 1. Religa os itens ao orçamento de origem ──────────────────────────────
  const orcItens = await prisma.orcamentoItem.findMany({
    where:  { statusItem: 'ACEITO', importadoEm: { not: null } },
    select: { id: true, animalId: true, descricao: true, valorUnitario: true, orcamento: { select: { proprietarioId: true } } },
  });
  // chave: animalId|descricao (itens de nível proprietário casam por proprietário)
  const porAnimal = new Map();
  const porProp   = new Map();
  for (const o of orcItens) {
    if (o.animalId != null) porAnimal.set(`${o.animalId}|${norm(o.descricao)}`, o);
    else porProp.set(`${o.orcamento.proprietarioId}|${norm(o.descricao)}`, o);
  }

  let religados = 0;
  for (const g of grupos) {
    for (const item of g.itens) {
      if (item.valorOrcado != null) continue;
      const origem = porAnimal.get(`${g.animalId}|${norm(item.medicamento)}`)
                  ?? porProp.get(`${g.animal?.userId}|${norm(item.medicamento)}`);
      if (!origem) continue;
      console.log(`  [origem] item ${item.id} "${item.medicamento}" → orçamento item ${origem.id} ${fmt(origem.valorUnitario)}`);
      religados++;
      if (APLICAR) {
        await prisma.prescricao.update({
          where: { id: item.id },
          data:  { orcamentoItemId: origem.id, valorOrcado: origem.valorUnitario },
        });
      }
      // reflete nos passos seguintes (inclusive na simulação, para o preview bater)
      item.valorOrcado = origem.valorUnitario;
    }
  }

  // ── 2. Lança na fatura o que ficou de fora ─────────────────────────────────
  let lancados = 0;
  const faturasTocadas = new Set();
  for (const g of grupos) {
    if (!g.animal?.userId) continue;
    const atendNum = numAtendimento(g.evolucao);
    for (const item of g.itens) {
      if (item.medicamentoCliente) continue; // nunca é cobrado
      const jaTem = await prisma.faturaItem.findFirst({ where: { prescricaoId: item.id } });
      if (jaTem) continue;

      const valor = item.valorOrcado
        ?? (item.tipo === 'PROCEDIMENTO'
              ? await resolverValorProcedimento(g.empresaId, item.medicamento)
              : 0);
      console.log(`  [fatura] ${g.animal.nome}: item ${item.id} [${item.tipo}] "${item.medicamento}" → ${fmt(valor)}`);
      lancados++;
      if (APLICAR) {
        await prisma.$transaction(async (tx) => {
          const mes = new Date().toISOString().slice(0, 7);
          let fatura = await tx.fatura.findFirst({ where: { proprietarioId: g.animal.userId, status: 'ABERTA' } });
          if (!fatura) {
            fatura = await tx.fatura.create({
              data: { proprietarioId: g.animal.userId, mesReferencia: mes, status: 'ABERTA', total: 0 },
            });
          }
          await tx.faturaItem.create({
            data: {
              faturaId:      fatura.id,
              animalId:      g.animalId,
              tipo:          item.tipo === 'MEDICAMENTO' ? 'MEDICAMENTO' : 'PROCEDIMENTO',
              descricao:     descricaoItem(item, atendNum),
              valor,
              quantidade:    1,
              veterinarioId: item.veterinarioId ?? g.veterinarioId ?? null,
              prescricaoId:  item.id,
            },
          });
          faturasTocadas.add(fatura.id);
        });
      }
    }
  }

  // ── 3. Preenche o valor dos itens que ficaram zerados ──────────────────────
  let corrigidos = 0;
  for (const g of grupos) {
    for (const item of g.itens) {
      const valorCerto = item.valorOrcado
        ?? (item.tipo === 'PROCEDIMENTO'
              ? await resolverValorProcedimento(g.empresaId, item.medicamento)
              : null);
      if (valorCerto == null || valorCerto <= 0) continue;
      const zerados = await prisma.faturaItem.findMany({
        where:   { prescricaoId: item.id, valor: 0 },
        include: { fatura: { select: { id: true, status: true } } },
      });
      for (const fi of zerados) {
        if (fi.fatura.status === 'PAGA') {
          console.log(`  [pulado] fatura ${fi.faturaId} já PAGA — item ${fi.id} não alterado`);
          continue;
        }
        console.log(`  [valor ] item de fatura ${fi.id} "${fi.descricao}" R$0 → ${fmt(valorCerto)}`);
        corrigidos++;
        if (APLICAR) {
          await prisma.faturaItem.update({ where: { id: fi.id }, data: { valor: valorCerto } });
          faturasTocadas.add(fi.faturaId);
        }
      }
    }
  }

  // ── Recalcula os totais das faturas afetadas ───────────────────────────────
  if (APLICAR && faturasTocadas.size > 0) {
    const { recalcularTotal } = require('../src/lib/faturaUtils');
    for (const faturaId of faturasTocadas) {
      const total = await recalcularTotal(prisma, faturaId);
      console.log(`  [total ] fatura ${faturaId} → ${fmt(total)}`);
    }
  }

  console.log(`\nResumo: ${religados} item(ns) religado(s) ao orçamento · ${lancados} lançamento(s) na fatura · ${corrigidos} valor(es) corrigido(s)`);
  if (!APLICAR) console.log('Nada foi gravado. Rode com --aplicar para efetivar.');
}

main()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
