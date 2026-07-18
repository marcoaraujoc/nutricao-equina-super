// Seed do catálogo de especialidades por espécie (tb_especialidades).
// Idempotente: upsert por (nome, especieId). Espécies são resolvidas por NOME
// (case-insensitive) — não dependem de IDs fixos. Rode: node scripts/seedEspecialidades.js
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
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
  const especies = await prisma.especie.findMany({ select: { id: true, nome: true } });
  const byNome = new Map(especies.map(e => [e.nome.trim().toLowerCase(), e.id]));

  let criadas = 0, existentes = 0, semEspecie = [];
  for (const [nomeEspecie, lista] of Object.entries(CATALOGO)) {
    const especieId = byNome.get(nomeEspecie.trim().toLowerCase());
    if (!especieId) { semEspecie.push(nomeEspecie); continue; }
    for (const nome of lista) {
      const existente = await prisma.especialidade.findFirst({ where: { nome, especieId } });
      if (existente) { existentes++; continue; }
      await prisma.especialidade.create({ data: { nome, especieId, ativo: true } });
      criadas++;
    }
  }

  console.log(`Especialidades — criadas: ${criadas}, já existentes: ${existentes}`);
  if (semEspecie.length) console.log('Espécies não encontradas no banco (ignoradas):', semEspecie.join(', '));
  const total = await prisma.especialidade.count();
  console.log('Total no catálogo:', total);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
