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
  // findFirst (não findUnique): Prisma rejeita null em chave única composta,
  // e empresa com CNPJ usa equipeId=null.
  const config = await prisma.empresaConfiguracao.findFirst({
    where: { empresaId: chave.empresaId, equipeId: chave.equipeId },
  });
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

// Logo do proprietário — usado pela FATURA (impressão, PDF, WhatsApp, e-mail).
//
// 🔴 COM EMPRESA NO CONTEXTO, A LOGO É A DELA (2026-09-26). Antes a logo saía da
// PRIMEIRA equipe do cliente em QUALQUER clínica (`equipeIds[0]`): o cliente atendido
// por duas clínicas recebia a fatura da MarcoVet com a logo da Patyvet — ou sem logo
// nenhuma, quando a primeira não tinha cadastrado. A fatura é POR EMPRESA, e o PIX e o
// banco impressos nela já saíam da empresa do contexto; a logo segue o mesmo critério.
// ⚠️ Sem empresa no contexto (legado/ADMIN) fica o comportamento antigo.
async function resolverLogoPorProprietario(proprietarioId, empresaId = null, equipeId = null) {
  if (empresaId) {
    const chave = await resolverChaveConfiguracao(empresaId, equipeId);
    return buscarLogoPelaChave(chave);
  }

  const equipeIds = await getEquipeIdsDoProprietario(Number(proprietarioId));
  if (equipeIds.length === 0) return null;

  const equipe = await prisma.equipe.findUnique({ where: { id: equipeIds[0] }, select: { empresaId: true } });
  if (!equipe) return null;

  const chave = await resolverChaveConfiguracao(equipe.empresaId, equipeIds[0]);
  return buscarLogoPelaChave(chave);
}

module.exports = { resolverChaveConfiguracao, resolverLogoPorAnimal, resolverLogoPorProprietario };
