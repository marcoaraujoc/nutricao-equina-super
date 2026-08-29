// Seed do catálogo de especialidades por espécie (tb_especialidades).
// Idempotente: upsert por (nome, especieId). Espécies são resolvidas por NOME
// (case-insensitive) — não dependem de IDs fixos. Rode: node scripts/seedEspecialidades.js
//
// 🔴 RODA EM ESCOPO DE PLATAFORMA. Desde a migration 20260920000000 a tabela é CATÁLOGO
// MISTO e tem RLS: o `WITH CHECK` da policy é `app_plataforma() OR empresa_id =
// app_empresa_id()`. Numa sessão sem tenant, `empresa_id = app_empresa_id()` é
// `NULL = NULL` → NULL → o Postgres trata como falso e RECUSA o INSERT. Sem o
// `set_config` abaixo, este seed passaria a falhar com
// "new row violates row-level security policy" justamente ao criar as linhas GLOBAIS,
// que são a razão de ele existir.
//
// `app.plataforma` é o MESMO mecanismo de `comEscopoPlataforma` (src/lib/prismaTenant.js),
// e o `true` do terceiro argumento de `set_config` o torna LOCAL à transação — ele não
// vaza para a próxima consulta que pegar esta conexão do pool.
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { catalogoPorEmpresaAtivo: CATALOGO_POR_EMPRESA } = require('../src/lib/especialidadeEscopo');
const prisma = new PrismaClient();

// Especialidades por espécie. Uma especialidade comum (ex.: "Cardiologia") aparece
// em várias espécies — cada par (nome, espécie) vira uma linha.
const CATALOGO = {
  Equino: [
    'Clínica Médica', 'Cirurgia', 'Reprodução', 'Nutrição', 'Odontologia',
    'Podologia / Casqueamento', 'Ferrageamento', 'Ortopedia',
    'Fisioterapia e Reabilitação', 'Quiropraxia', 'Acupuntura', 'Oftalmologia',
    'Dermatologia', 'Cardiologia', 'Neurologia', 'Anestesiologia',
    'Diagnóstico por Imagem', 'Medicina Esportiva', 'Medicina Interna',
    'Emergência e Terapia Intensiva',
  ],
  Canino: [
    'Clínica Médica', 'Cirurgia de Tecidos Moles', 'Cirurgia Ortopédica',
    'Dermatologia', 'Cardiologia', 'Oncologia', 'Neurologia', 'Oftalmologia',
    'Odontologia', 'Anestesiologia', 'Reprodução', 'Nutrição',
    'Comportamento Animal (Etologia)', 'Diagnóstico por Imagem', 'Endocrinologia',
    'Nefrologia e Urologia', 'Gastroenterologia', 'Fisioterapia e Reabilitação',
    'Acupuntura', 'Emergência e Terapia Intensiva',
  ],
  Felino: [
    'Clínica Médica de Felinos', 'Cirurgia de Tecidos Moles', 'Cirurgia Ortopédica',
    'Dermatologia', 'Cardiologia', 'Oncologia', 'Neurologia', 'Oftalmologia',
    'Odontologia', 'Anestesiologia', 'Reprodução', 'Nutrição',
    'Comportamento Animal (Etologia)', 'Diagnóstico por Imagem', 'Endocrinologia',
    'Nefrologia e Urologia', 'Emergência e Terapia Intensiva',
  ],
  Bovino: [
    'Clínica Médica (Buiatria)', 'Cirurgia', 'Reprodução', 'Nutrição Animal',
    'Podologia', 'Sanidade de Rebanho', 'Medicina Populacional', 'Anestesiologia',
    'Diagnóstico por Imagem', 'Emergência',
  ],
  Réptil: [
    'Clínica de Animais Silvestres e Exóticos', 'Cirurgia de Exóticos',
    'Medicina de Répteis', 'Nutrição', 'Diagnóstico por Imagem',
  ],
};

async function main() {
  // Tudo numa transação só: é o escopo em que o `set_config(..., true)` vale.
  const { criadas, existentes, semEspecie, total } = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SELECT set_config('app.plataforma', 'on', true)");

    const especies = await tx.especie.findMany({ select: { id: true, nome: true } });
    const byNome = new Map(especies.map(e => [e.nome.trim().toLowerCase(), e.id]));

    let criadas = 0, existentes = 0; const semEspecie = [];
    for (const [nomeEspecie, lista] of Object.entries(CATALOGO)) {
      const especieId = byNome.get(nomeEspecie.trim().toLowerCase());
      if (!especieId) { semEspecie.push(nomeEspecie); continue; }
      for (const nome of lista) {
        // Só a linha GLOBAL conta como "já existe": a especialidade que uma clínica
        // cadastrou à mão (empresa_id setado) não pode fazer o seed pular a global,
        // que é a que todas as outras enxergam. `empresaId: null` é ignorado enquanto o
        // Client não conhece a coluna — antes da migration não há linha de empresa.
        const existente = await tx.especialidade.findFirst({
          where: { nome, especieId, ...(CATALOGO_POR_EMPRESA ? { empresaId: null } : {}) },
        });
        if (existente) { existentes++; continue; }
        await tx.especialidade.create({ data: { nome, especieId, ativo: true } });
        criadas++;
      }
    }

    const total = await tx.especialidade.count();
    return { criadas, existentes, semEspecie, total };
  }, { timeout: 120000 });

  console.log(`Especialidades — criadas: ${criadas}, já existentes: ${existentes}`);
  if (semEspecie.length) console.log('Espécies não encontradas no banco (ignoradas):', semEspecie.join(', '));
  console.log('Total no catálogo:', total);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
