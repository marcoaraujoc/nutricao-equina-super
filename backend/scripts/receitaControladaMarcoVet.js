// backend/scripts/receitaControladaMarcoVet.js
//
// Limpa os modelos de teste da MarcoVet e (re)cria a RECEITA CONTROLADA ESPECIAL a
// partir de `seeds/007_receita_controlada.seed.js`.
//
// ⚠️ Roda sob `comEscopoPlataforma` com o CLIENT DE TENANT: `tb_documento_templates`
// está com RLS ENABLE + FORCE, e sem o carimbo o SELECT devolve 0 linhas e o INSERT é
// recusado — inclusive para o dono do schema (armadilha 42 do CLAUDE.md).
//
// Uso:  node backend/scripts/receitaControladaMarcoVet.js [empresaId]
'use strict';

require('dotenv').config();

// ⚠️ `lib/prisma` é TypeScript e não carrega em `node` puro. O client de TENANT é
// montado aqui do mesmo jeito que `backend/seed.js` faz — sem a EXTENSÃO de tenant
// o carimbo de plataforma nunca chega ao banco e o RLS recusa tudo.
const { PrismaClient } = require('@prisma/client');
const { comTenantAutomatico, comEscopoPlataforma } = require('../src/lib/prismaTenant');
const prisma = comTenantAutomatico(new PrismaClient());
const { semear, NOME } = require('../src/seeds/007_receita_controlada.seed');

const EMPRESA_ID = Number(process.argv[2] ?? 58);

/**
 * Modelos a REMOVER, pelos nomes que o gestor pediu.
 * ⚠️ A comparação é por nome NORMALIZADO (sem acento, sem caixa, sem espaço em
 * volta): a lista veio digitada à mão e "Teste1" × "teste1" são o mesmo modelo.
 * ⚠️ O que NÃO está aqui não é tocado — "teste" (sem o 1) ficou de fora do pedido.
 */
const A_REMOVER = [
  'Receita Controlada',
  'Receita Controlada2',
  'Teste1',
  'controlada 4',
  'rec co',
  'Receita Controlada 3',
];

const normalizar = (v) =>
  String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

async function main() {
  const alvos = new Set(A_REMOVER.map(normalizar));

  const doTenant = await prisma.documentoTemplate.findMany({
    where:  { empresaId: EMPRESA_ID },
    select: { id: true, nome: true, chave: true },
  });

  const remover = doTenant.filter(t => alvos.has(normalizar(t.nome)));
  console.log(`Empresa ${EMPRESA_ID}: ${doTenant.length} modelo(s); ${remover.length} a remover.`);
  for (const t of remover) console.log(`  – #${t.id} "${t.nome}"`);

  if (remover.length > 0) {
    // 🔴 EXCLUSÃO DE VERDADE, não soft delete: são modelos de TESTE que o gestor
    // pediu para apagar, e um deles ("Receita Controlada") precisa sair do caminho
    // para o modelo novo nascer com esse nome — a busca da tela de Prescrição é PELO
    // NOME, e dois com o mesmo nome deixariam o recorte de controlados imprevisível.
    // ⚠️ `DocumentoEmitido` NÃO é tocado: o documento entregue é SNAPSHOT e não
    // depende do modelo (`documentoTemplateId` é nulável).
    const { count } = await prisma.documentoTemplate.deleteMany({
      where: { id: { in: remover.map(t => t.id) }, empresaId: EMPRESA_ID },
    });
    console.log(`Removidos: ${count}`);
  }

  const r = await semear(prisma, EMPRESA_ID);
  console.log(`"${NOME}" ${r.criado ? 'CRIADA' : 'atualizada'} — id ${r.id}`);

  const final = await prisma.documentoTemplate.findMany({
    where:  { empresaId: EMPRESA_ID },
    select: { id: true, nome: true, categoria: true },
    orderBy: { id: 'asc' },
  });
  console.log('Acervo final da empresa:');
  for (const t of final) console.log(`  #${t.id} ${t.nome} (${t.categoria})`);
}

comEscopoPlataforma(main)
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
