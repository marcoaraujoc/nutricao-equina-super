import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed...');

  // Nutrientes (da sua planilha)
  await prisma.nutriente.createMany({
    data: [
      { nome: 'Cálcio', categoria: 'Mineral', unidadePadrao: 'g', codigo: 'Ca', essencial: true },
      { nome: 'Fósforo', categoria: 'Mineral', unidadePadrao: 'g', codigo: 'P', essencial: true },
      { nome: 'Lisina', categoria: 'Aminoácido', unidadePadrao: 'g', codigo: 'Lys', essencial: true },
      { nome: 'Metionina', categoria: 'Aminoácido', unidadePadrao: 'g', codigo: 'Met', essencial: true },
      { nome: 'Vitamina E', categoria: 'Vitamina', unidadePadrao: 'UI', codigo: 'VitE', essencial: true },
      { nome: 'Selênio', categoria: 'Mineral', unidadePadrao: 'mg', codigo: 'Se', essencial: true },
      { nome: 'Proteína Bruta', categoria: 'Macronutriente', unidadePadrao: 'g', codigo: 'PB', essencial: false },
      { nome: 'Sódio', categoria: 'Mineral', unidadePadrao: 'g', codigo: 'Na', essencial: true },
      { nome: 'Cloro', categoria: 'Mineral', unidadePadrao: 'g', codigo: 'Cl', essencial: true },
    ],
  });

  // Produtos (da sua planilha "alimentação Super.xlsx")
  await prisma.produto.createMany({
    data: [
      { nome: 'Ração S-280', categoria: 'concentrado', fabricante: 'Guabi', forma: 'peletizado', ativo: true },
      { nome: 'Amino E', categoria: 'suplemento', fabricante: 'Aminomix', forma: 'pó', ativo: true },
      { nome: 'Alfafa', categoria: 'volumoso', fabricante: 'Fazenda', forma: 'feno', ativo: true },
      { nome: 'Feno', categoria: 'volumoso', fabricante: 'Fazenda', forma: 'feno', ativo: true },
      { nome: 'Sal Guabi Tech', categoria: 'sal', fabricante: 'Guabi', forma: 'bloco', ativo: true },
    ],
  });

  console.log('✅ Seed concluído com sucesso!');
  console.log('   Nutrientes e produtos da sua planilha foram inseridos.');
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
