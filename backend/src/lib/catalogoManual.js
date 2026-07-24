// backend/src/lib/catalogoManual.js
//
// Item criado À MÃO nas telas (orçamento ou atendimento) entra no catálogo da EMPRESA
// que o cadastrou — `empresaId` setado, então só ela vê/edita — e passa a aparecer nas
// buscas dessas mesmas telas nas próximas vezes.
//
// A ESPÉCIE do item novo é a que a EMPRESA atende (quando ela atende mais de uma, a
// tela pergunta quais) — e é o que o faz aparecer nas buscas depois:
//   • MEDICAMENTO/VACINA precisa do vínculo de ESPÉCIE: `/medicamentos/para-atendimento`
//     filtra por `especies.some({ especieId })` do animal — sem o vínculo o item fica
//     invisível na busca, mesmo existindo na tabela. Aceita várias.
//   • PROCEDIMENTO guarda a espécie como TEXTO (campo único): com uma espécie, grava o
//     nome dela; com várias, fica genérico (null) — que é como o catálogo representa
//     "serve para qualquer espécie". Procedimento próprio da empresa é sempre listado
//     para ela (ProcedimentoCadastroController ignora os filtros nesse caso).
//
// Tudo é idempotente por (nome + empresa): prescrever/orçar o mesmo nome duas vezes
// não duplica a linha do catálogo.
'use strict';

const FILTRO_VACINA     = { classificacao: { contains: 'vacin', mode: 'insensitive' } };
const FILTRO_NAO_VACINA = { NOT: { classificacao: { contains: 'vacin', mode: 'insensitive' } } };

/** Catálogo visível para a empresa: global (empresaId null) + o próprio dela. */
const escopoDaEmpresa = (empresaId) => ({
  OR: [{ empresaId: null }, ...(empresaId ? [{ empresaId: Number(empresaId) }] : [])],
});

/**
 * Garante o MEDICAMENTO (ou VACINA) no catálogo da empresa e devolve o id.
 * Reaproveita a entrada existente — global ou da própria empresa — quando o nome bate.
 *
 * @param {object} tx        client Prisma (use o `tx` quando houver transaction)
 * @param {object} dados     { nome, unidade?, vacina?, especieIds? }
 * @param {number|null} empresaId
 * @returns {Promise<number|null>} id do medicamento (null se veio sem nome)
 */
async function garantirMedicamentoDaEmpresa(tx, { nome, unidade, vacina = false, especieIds = [] }, empresaId) {
  const n = String(nome ?? '').trim().slice(0, 90);
  if (!n) return null;

  const existente = await tx.medicamento.findFirst({
    where: {
      ativo: true,
      nome:  { equals: n, mode: 'insensitive' },
      ...escopoDaEmpresa(empresaId),
      ...(vacina ? FILTRO_VACINA : FILTRO_NAO_VACINA),
    },
    select: { id: true, empresaId: true },
  });

  const id = existente
    ? existente.id
    : (await tx.medicamento.create({
        data: {
          nome:              n,
          formaFarmaceutica: 'Manual',
          unidade:           String(unidade || (vacina ? 'dose' : 'un')).slice(0, 100),
          apresentacao:      'Manual',
          classificacao:     vacina ? 'Vacina' : null,
          empresaId:         empresaId ?? null,
          ativo:             true,
        },
        select: { id: true },
      })).id;

  // Sem o vínculo da espécie o item não aparece na busca do atendimento/orçamento
  for (const especieId of normalizarEspecies(especieIds)) {
    await vincularEspecie(tx, id, especieId);
  }
  return id;
}

/** Lista de ids de espécie válida e sem repetição (aceita número ou array). */
function normalizarEspecies(especieIds) {
  const bruto = Array.isArray(especieIds) ? especieIds : [especieIds];
  return [...new Set(bruto.map(Number).filter(n => Number.isInteger(n) && n > 0))];
}

/** Liga o medicamento à espécie (idempotente). */
async function vincularEspecie(tx, medicamentoId, especieId) {
  const ja = await tx.medicamentoEspecie.findFirst({
    where:  { medicamentoId, especieId },
    select: { id: true },
  });
  if (!ja) await tx.medicamentoEspecie.create({ data: { medicamentoId, especieId } });
}

/**
 * Garante o PROCEDIMENTO no catálogo da empresa e devolve o id.
 *
 * @param {object} tx
 * @param {object} dados     { nome, especialidade?, valor?, especieNome? }
 *   especieNome — nome da espécie quando a empresa atende só uma; com mais de uma o
 *   procedimento fica genérico (o catálogo guarda uma única espécie, em texto).
 * @param {number|null} empresaId
 * @returns {Promise<number|null>}
 */
async function garantirProcedimentoDaEmpresa(tx, { nome, especialidade = null, valor = 0, especieNome = null }, empresaId) {
  const n = String(nome ?? '').trim().slice(0, 255);
  if (!n) return null;

  const existente = await tx.procedimentoVeterinario.findFirst({
    where: {
      ativo: true,
      nome:  { equals: n, mode: 'insensitive' },
      ...escopoDaEmpresa(empresaId),
    },
    select: { id: true },
  });
  if (existente) return existente.id;

  const criado = await tx.procedimentoVeterinario.create({
    data: {
      nome:          n,
      categoria:     'Cadastrado no atendimento',
      especialidade: especialidade || null,
      valorVenda:    Number(valor) || 0,
      especie:       especieNome ? String(especieNome).slice(0, 50) : null, // null = genérico
      empresaId:     empresaId ?? null,
      ativo:         true,
    },
    select: { id: true },
  });
  return criado.id;
}

module.exports = {
  garantirMedicamentoDaEmpresa,
  garantirProcedimentoDaEmpresa,
  vincularEspecie,
  normalizarEspecies,
};
