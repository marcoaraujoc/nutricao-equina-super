require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { buildDataset } = require('./_load_meds_prep');

// Conexao normal da app (zls2vetp1). RLS ativo — usamos o escopo de PLATAFORMA
// (mesmo mecanismo de lib/prismaTenant.js#comEscopoPlataforma) só para o passo de
// limpar o estoque de teste que bloqueia o delete via FK RESTRICT (autorizado pelo
// usuario: dados de estoque de todas as empresas sao de teste, exceto os que estamos
// carregando agora).
const prisma = new PrismaClient();

async function main() {
  const { clean } = await buildDataset();
  console.log('Medicamentos limpos (sem conflito) a carregar:', clean.size);

  const result = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.plataforma', 'on', true)`);

      const especies = await tx.especie.findMany({ where: { nome: { in: ['Equino', 'Bovino'] } } });
      const especieIdByNome = new Map(especies.map((e) => [e.nome, e.id]));
      if (!especieIdByNome.get('Equino') || !especieIdByNome.get('Bovino')) {
        throw new Error('Especie Equino ou Bovino nao encontrada no banco.');
      }
      const especieIds = [...especieIdByNome.values()];

      const poolLinks = await tx.medicamentoEspecie.findMany({
        where: { especieId: { in: especieIds } },
        select: { medicamentoId: true },
        distinct: ['medicamentoId'],
      });
      const poolIds = poolLinks.map((m) => m.medicamentoId);
      const poolMeds = await tx.medicamento.findMany({ where: { id: { in: poolIds } }, select: { id: true, nome: true } });

      const idsByNome = new Map();
      for (const m of poolMeds) {
        if (!idsByNome.has(m.nome)) idsByNome.set(m.nome, []);
        idsByNome.get(m.nome).push(m.id);
      }

      const idsParaDeletar = [];
      for (const nome of clean.keys()) {
        if (idsByNome.has(nome)) idsParaDeletar.push(...idsByNome.get(nome));
      }
      console.log('Registros existentes que serao deletados (e recriados):', idsParaDeletar.length);
      console.log('Registros novos (sem correspondente hoje):', clean.size - idsParaDeletar.length);

      // Limpa estoque de teste que bloquearia o delete (RESTRICT). Autorizado pelo
      // usuario — estoque de todas as empresas eh dado de teste nesta base.
      const estoqueRemovido = await tx.estoqueClinica.deleteMany({ where: { medicamentoId: { in: idsParaDeletar } } });
      console.log('EstoqueClinica de teste removido (desbloqueio do FK):', estoqueRemovido.count);

      // Prescricao.medicamentoCatId e VacinaClinica nao precisam de acao manual:
      // a FK de tb_prescricoes eh ON DELETE SET NULL (o Postgres desvincula sozinho,
      // preservando o registro clinico e o nome livre) e tb_lotes_vacina idem; a
      // relacao de VacinaClinica.medicamentoCatId nao tem FK real no banco.

      if (idsParaDeletar.length) {
        const del = await tx.medicamento.deleteMany({ where: { id: { in: idsParaDeletar } } });
        console.log('Medicamentos deletados:', del.count);
      }

      let created = 0;
      for (const [nome, data] of clean.entries()) {
        await tx.medicamento.create({
          data: {
            nome,
            formaFarmaceutica: data.attrs.formaFarmaceutica,
            unidade: data.attrs.unidade,
            apresentacao: data.attrs.apresentacao,
            classificacao: data.attrs.classificacao,
            controlado: data.attrs.controlado,
            empresaId: null,
            ativo: true,
            vias: { create: [...data.vias].map((via) => ({ via })) },
            especies: { create: [...data.especies].map((esp) => ({ especieId: especieIdByNome.get(esp) })) },
          },
        });
        created++;
        if (created % 500 === 0) console.log('  ...', created, '/', clean.size);
      }
      console.log('Medicamentos criados:', created);

      return { estoqueRemovido: estoqueRemovido.count, deletados: idsParaDeletar.length, criados: created };
    },
    { timeout: 10 * 60 * 1000, maxWait: 30 * 1000 }
  );

  console.log('RESULTADO:', result);

  const totalFinal = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.plataforma', 'on', true)`);
    return tx.medicamento.count();
  });
  console.log('Total de medicamentos no catalogo apos a carga:', totalFinal);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('ERRO — transacao revertida:', e);
  await prisma.$disconnect();
  process.exit(1);
});
