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

const {
  escopoDaEmpresa: escopoEspecialidade,
  catalogoPorEmpresaAtivo,
} = require('./especialidadeEscopo');

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

/**
 * Garante a ESPECIALIDADE no catálogo e devolve `{ id, nome }`.
 *
 * `tb_especialidades` é CATÁLOGO MISTO desde a migration 20260920000000, na mesma
 * forma de `tb_medicamentos`: `empresa_id` nulo = item GLOBAL do sistema (os 72 do
 * `scripts/seedEspecialidades.js`), setado = cadastrado pela clínica.
 *
 * Reaproveita o que já existe no escopo VISÍVEL da empresa (global + o próprio dela)
 * comparando o nome sem diferenciar maiúsculas — "Acupuntura" e "acupuntura" são a
 * mesma especialidade, e duas linhas fariam a lista mostrar o item repetido.
 *
 * 🔴 O item novo nasce SEMPRE com `empresaId` — nunca global. Deixar o `empresa_id`
 * nulo publicaria a especialidade de uma clínica no catálogo de TODAS, e o RLS
 * recusaria a escrita de qualquer forma (o `WITH CHECK` da policy só aceita
 * `empresa_id = app_empresa_id()`). Sem empresa no contexto, não cadastra nada:
 * devolve o que achou ou `null` — inventar uma linha global aqui é o vazamento.
 *
 * @param {object} tx                client Prisma (use o `tx` quando houver transaction)
 * @param {object} dados             { nome, especieId }
 * @param {number|null} empresaId
 * @returns {Promise<{id:number,nome:string}|null>}
 */
async function garantirEspecialidadeDaEmpresa(tx, { nome, especieId }, empresaId) {
  const n = String(nome ?? '').trim().slice(0, 80);
  if (!n) return null;

  const existente = await tx.especialidade.findFirst({
    where: {
      ativo: true,
      nome:  { equals: n, mode: 'insensitive' },
      ...(Number.isInteger(Number(especieId)) ? { especieId: Number(especieId) } : {}),
      ...escopoEspecialidade(empresaId),
    },
    select: { id: true, nome: true },
  });
  if (existente) return existente;

  // Antes da migration 20260920000000 (+ generate) o Client não conhece `empresaId` e a
  // criação LANÇARIA. Não cadastrar é o comportamento correto no intervalo: a linha
  // sairia global, no catálogo de todas as clínicas. O encaminhamento continua sendo
  // gravado — a especialidade é texto nele.
  if (!catalogoPorEmpresaAtivo) return null;

  // Sem empresa (ADMIN de plataforma, job sem tenant) ou sem espécie do paciente não há
  // como cadastrar de quem é nem para qual espécie: devolve o nome digitado, que o
  // encaminhamento grava como texto do mesmo jeito.
  if (!empresaId || !Number.isInteger(Number(especieId))) return null;

  return tx.especialidade.create({
    data: { nome: n, especieId: Number(especieId), empresaId: Number(empresaId), ativo: true },
    select: { id: true, nome: true },
  });
}

module.exports = {
  garantirMedicamentoDaEmpresa,
  garantirProcedimentoDaEmpresa,
  garantirEspecialidadeDaEmpresa,
  vincularEspecie,
  normalizarEspecies,
};
