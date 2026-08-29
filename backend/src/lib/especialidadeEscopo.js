// backend/src/lib/especialidadeEscopo.js
//
// `tb_especialidades` virou CATÁLOGO MISTO na migration 20260920000000:
//   empresa_id NULL   = especialidade GLOBAL do sistema (scripts/seedEspecialidades.js);
//   empresa_id setado = cadastrada por aquela clínica, visível só para ela.
//
// 🔴 POR QUE ESTE ARQUIVO EXISTE — a migration é GERADA e aplicada em outro momento
// (regra do projeto: nada entra no banco sem autorização), e o `prisma generate` no
// Windows só roda com o backend PARADO (§11 do CLAUDE.md). Entre uma coisa e outra o
// Prisma Client NÃO conhece `Especialidade.empresaId`, e passar esse campo a ele não
// devolve resultado errado: LANÇA (`Unknown arg`). Sem esta guarda, o catálogo de
// especialidades — que alimenta Cadastro Pessoal, Novo Membro, Novo Fornecedor, o
// filtro da Agenda e o encaminhamento — cairia com 500 em TODAS as telas até alguém
// lembrar de rodar o generate.
//
// A pergunta é feita ao CLIENT (DMMF), não ao banco: é o client que recusa o argumento,
// e ele é regenerado no mesmo passo em que a migration é aplicada.
//
// Enquanto está inativo o comportamento é EXATAMENTE o de antes (catálogo global puro):
// a listagem devolve tudo e nada é cadastrado pela clínica — nunca uma linha global
// com o nome que uma empresa digitou, que é o vazamento que este módulo evita.
'use strict';

const { Prisma } = require('@prisma/client');

/** true quando o Prisma Client já conhece `Especialidade.empresaId`. */
const catalogoPorEmpresaAtivo = (() => {
  try {
    const model = Prisma.dmmf.datamodel.models.find(m => m.name === 'Especialidade');
    return !!model?.fields.some(f => f.name === 'empresaId');
  } catch {
    return false;
  }
})();

/**
 * Recorte do catálogo visível para a empresa: global + o próprio dela.
 * Devolve `{}` (sem recorte) enquanto o campo não existe no Client — que é o
 * comportamento de catálogo global puro, o de antes da migration.
 */
function escopoDaEmpresa(empresaId) {
  if (!catalogoPorEmpresaAtivo) return {};
  return { OR: [{ empresaId: null }, ...(empresaId ? [{ empresaId: Number(empresaId) }] : [])] };
}

module.exports = { catalogoPorEmpresaAtivo, escopoDaEmpresa };
