// backend/src/lib/logoEmpresaUtils.js
// Resolve o logotipo (EmpresaConfiguracao.logoUrl) aplicável a um animal ou a um
// proprietário — independente do contexto/cargo do usuário que está gerando o
// relatório/impressão (diferente de EquipeController.resolverEscopoConfiguracao,
// que só resolve para quem é dono ou GESTOR da empresa logada).

const prisma = require('./prisma').default;
const { getEquipeIdsDoProprietario } = require('../middlewares/permissao.middleware');

// Mesma lógica de EquipeController.js:89-101 (resolverEscopoConfiguracao), mas a
// partir de um empresaId já resolvido (não do usuário logado).
async function resolverChaveConfiguracao(empresaId, equipeIdPreferida = null) {
  if (!empresaId) return null;
  const empresa = await prisma.empresa.findUnique({ where: { id: Number(empresaId) } });
  if (!empresa) return null;
  if (empresa.cnpj) return { empresaId: empresa.id, equipeId: null };

  let equipe = null;
  if (equipeIdPreferida) {
    equipe = await prisma.equipe.findFirst({ where: { id: Number(equipeIdPreferida), empresaId: empresa.id } });
  }
  if (!equipe) {
    equipe = await prisma.equipe.findFirst({ where: { empresaId: empresa.id } });
  }
  if (!equipe) return null;
  return { empresaId: empresa.id, equipeId: equipe.id };
}

async function buscarLogoPelaChave(chave) {
  if (!chave) return null;
  const config = await prisma.empresaConfiguracao.findUnique({ where: { empresaId_equipeId: chave } });
  return config?.logoUrl ?? null;
}

// Logo do animal — usado por dieta, evolução, prescrição, exame, exame de compra,
// resumo de atendimento (todos os fluxos que já têm um animalId em tela).
async function resolverLogoPorAnimal(animalId) {
  const animal = await prisma.animal.findUnique({
    where:  { id: Number(animalId) },
    select: { empresaId: true, equipeId: true },
  });
  if (!animal?.empresaId) return null;
  const chave = await resolverChaveConfiguracao(animal.empresaId, animal.equipeId);
  return buscarLogoPelaChave(chave);
}

// Logo do proprietário — usado por fatura (Fatura não tem empresaId direto, só
// proprietarioId). Reusa a mesma agregação de equipes já usada para permissões de
// PROPRIETARIO; pega a primeira equipe encontrada (uma clínica na prática comum).
async function resolverLogoPorProprietario(proprietarioId) {
  const equipeIds = await getEquipeIdsDoProprietario(Number(proprietarioId));
  if (equipeIds.length === 0) return null;

  const equipe = await prisma.equipe.findUnique({ where: { id: equipeIds[0] }, select: { empresaId: true } });
  if (!equipe) return null;

  const chave = await resolverChaveConfiguracao(equipe.empresaId, equipeIds[0]);
  return buscarLogoPelaChave(chave);
}

module.exports = { resolverChaveConfiguracao, resolverLogoPorAnimal, resolverLogoPorProprietario };
