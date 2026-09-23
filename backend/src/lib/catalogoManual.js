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
 * ⚠️ Reaproveitar VENCE o que veio no formulário: nome que já existe devolve a linha
 * existente e NÃO reescreve forma/unidade/apresentação/vias dela. O item pode ser do
 * catálogo GLOBAL (ADMIN), que a clínica não edita — e o RLS recusaria a escrita de
 * qualquer forma. É também o que mantém a função idempotente por (nome + empresa).
 *
 * @param {object} tx        client Prisma (use o `tx` quando houver transaction)
 * @param {object} dados     { nome, unidade?, formaFarmaceutica?, apresentacao?,
 *                             controlado?, vias?, vacina?, especieIds? }
 * @param {number|null} empresaId
 * @returns {Promise<number|null>} id do medicamento (null se veio sem nome)
 */
async function garantirMedicamentoDaEmpresa(
  tx,
  { nome, unidade, formaFarmaceutica, apresentacao, fabricante, controlado = false,
    vias = [], vacina = false, especieIds = [] },
  empresaId,
) {
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
    // 🔴 O PRÓPRIO DA EMPRESA VENCE O GLOBAL de mesmo nome. Desde a troca de unidade
    // pela tela de estoque (lib/unidadeMedicamento.js) a clínica pode ter a CÓPIA de um
    // medicamento global, e as duas casam este `where`. Sem a ordem, o `findFirst`
    // devolveria qualquer uma das duas e prescrever pelo nome poderia cair de volta no
    // global — com a unidade que a clínica acabou de corrigir.
    // ⚠️ `asc` e não `desc`: no Postgres ASC é NULLS LAST, então o não-nulo (o da
    // empresa) vem primeiro; `desc` é NULLS FIRST e faria o global ganhar.
    orderBy: { empresaId: 'asc' },
  });

  const id = existente
    ? existente.id
    : (await tx.medicamento.create({
        data: {
          nome:              n,
          // 'Manual' continua sendo o padrão de quem cria SEM passar os campos (o
          // caminho antigo, do salvar da prescrição). A tela de cadastro os informa.
          formaFarmaceutica: String(formaFarmaceutica || 'Manual').slice(0, 255),
          unidade:           String(unidade || (vacina ? 'dose' : 'un')).slice(0, 100),
          apresentacao:      String(apresentacao || 'Manual').slice(0, 255),
          // 🔴 NUNCA `null` aqui. O recorte de "não é vacina" é
          // `NOT: { classificacao: { contains: 'vacin' } }`, e em SQL o NOT sobre NULL
          // não é verdadeiro: a linha com classificação NULA fica FORA do filtro. Ou
          // seja, o item nasceria invisível na busca da Prescrição, na lista da
          // Farmácia e para esta própria função — que então criaria uma linha nova a
          // cada vez, em silêncio. Segue o precedente de `garantirProcedimentoDaEmpresa`,
          // que carimba a origem em `categoria`.
          classificacao:     vacina ? 'Vacina' : 'Cadastrado na clínica',
          // OPCIONAL, e só a vacina o informa hoje (é o que a tela de Estoque de
          // Vacinas usa para filtrar). Em branco grava NULL — nunca string vazia,
          // que apareceria como um fabricante sem nome naquele filtro.
          fabricante:        String(fabricante ?? '').trim().slice(0, 150) || null,
          controlado:        Boolean(controlado),
          empresaId:         empresaId ?? null,
          ativo:             true,
        },
        select: { id: true },
      })).id;

  // Vias só entram no item NOVO, pela mesma razão dos demais campos: o existente pode
  // ser global. `createMany` com skipDuplicates respeita o unique (medicamentoId, via).
  if (!existente) {
    const viasLimpas = [...new Set(
      (Array.isArray(vias) ? vias : [vias])
        .map(v => String(v ?? '').trim().slice(0, 255))
        .filter(Boolean),
    )];
    if (viasLimpas.length > 0) {
      await tx.medicamentoVia.createMany({
        data: viasLimpas.map(via => ({ medicamentoId: id, via })),
        skipDuplicates: true,
      });
    }
  }

  // Sem o vínculo da espécie o item não aparece na busca do atendimento/orçamento
  for (const especieId of normalizarEspecies(especieIds)) {
    await vincularEspecie(tx, id, especieId);
  }
  return id;
}

/**
 * Uma opção por valor, ignorando MAIÚSCULAS/minúsculas e espaço em volta.
 *
 * 🔴 POR QUE NÃO BASTA `distinct`: o catálogo tem 'kg' e 'Kg', 'Frasco' e 'FRASCO' —
 * o seletor de cadastro mostrava as duas como se fossem coisas diferentes, e escolher
 * uma ou outra criava variação do mesmo valor a cada item novo. Fica a grafia MAIS
 * USADA; a alfabética faria 'Kg' vencer 'kg' por acidente de ordenação.
 *
 * ⚠️ NÃO normaliza a grafia: o valor devolvido é um dos que EXISTEM no catálogo —
 * inventar 'Kg' onde a base só tem 'kg' criaria um valor novo a cada cadastro.
 * ⚠️ Descarta o vazio, que existe na base legada e viraria opção em branco no seletor.
 *
 * @param {Array<object>} linhas  saída de `groupBy` (`{ <campo>, _count: { _all } }`)
 * @param {string} campo
 * @returns {string[]} ordenado em pt-BR (acento entra na ordem certa)
 */
function dedupPorCaixa(linhas, campo) {
  const porChave = new Map();
  for (const linha of linhas) {
    const valor = String(linha?.[campo] ?? '').trim();
    if (!valor) continue;
    const chave = valor.toLocaleLowerCase('pt-BR');
    const n     = linha._count?._all ?? 0;
    const atual = porChave.get(chave);
    if (!atual || n > atual.n) porChave.set(chave, { valor, n });
  }
  return [...porChave.values()]
    .map(x => x.valor)
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

/**
 * VIAS que o SELETOR de cadastro (`CadastroCatalogoModal`) não oferece — curadoria
 * pedida depois de ver o catálogo bruto na tela.
 *
 * 🔴 NÃO apaga NADA do banco. Os medicamentos/vacinas que já usam essas vias
 * continuam com elas gravadas em `tb_medicamento_vias` — só o SELETOR de quem
 * cadastra um item NOVO deixa de oferecê-las como opção. Apagar a via de milhares
 * de itens do catálogo GLOBAL (mantido pelo ADMIN) seria mudança de DADO, não de
 * TELA, e exigiria migration + autorização explícita — o pedido aqui foi só sobre
 * o que aparece no seletor.
 *
 * Duas regras, por TIPO:
 *
 *   VACINA — lista FECHADA de 4 valores exatos: 'SC' e 'IM' (abreviações soltas
 *   que duplicam as formas por extenso já no catálogo — 'Subcutânea (SC)' e
 *   'Intramuscular (IM)'); 'SC (bovinos)' e 'IM (equinos)' (a mesma via com o
 *   detalhe de espécie, que o seletor não precisa oferecer separado).
 *
 *   MEDICAMENTO — três critérios:
 *     • contém "bovin" ou "vitela" — o catálogo é COMPARTILHADO entre espécies e
 *       traz vias específicas de bovino/bezerro/vitela;
 *     • começa com "EV" (Endovenosa) — sinônimo de "IV" (Intravenosa), que já
 *       está no catálogo; oferecer os dois nomes para a MESMA via é a duplicidade
 *       apontada ("Todas as EVs");
 *     • duas entradas EXATAS: "Epidural (nos espaços sacrococcígeo)" — duplicata
 *       (sem o 's' final) de "Epidural (nos espaços sacrococcígeos)", que fica; e
 *       "Ambiental (Aplicar exclusivamente sobre superfícies inanimadas...)" —
 *       descrição longa demais para o seletor, com "Ambiental" (curta) já cobrindo
 *       o mesmo sentido.
 *
 * @param {string} via
 * @param {boolean} vacina
 * @returns {boolean} true = EXCLUI do seletor
 */
function viaExcluidaDoSeletor(via, vacina) {
  const v = String(via ?? '').trim().toLowerCase();
  if (!v) return false;

  if (vacina) {
    return ['sc (bovinos)', 'sc', 'im', 'im (equinos)'].includes(v);
  }

  if (/bovin|vitela/.test(v)) return true;
  if (/^ev\b/.test(v)) return true;
  if (v === 'epidural (nos espaços sacrococcígeo)') return true;
  if (v.startsWith('ambiental (aplicar exclusivamente')) return true;

  return false;
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
 * @param {object} dados     { nome, especialidade?, valor?, especieNome?, categoria?,
 *                             tipoProcedimento? }
 *   especieNome — nome da espécie quando a empresa atende só uma; com mais de uma o
 *   procedimento fica genérico (o catálogo guarda uma única espécie, em texto).
 *   categoria / tipoProcedimento — OPCIONAIS, e só a tela de Cadastro > Procedimentos
 *   os informa: é o que permite cadastrar um EXAME DE IMAGEM pela clínica
 *   (`tipoProcedimento = 'IMAGEM'` + `categoria = 'Radiografia'`), que é como
 *   `listarComValores` recorta essa família. Omitidos, vale o comportamento de
 *   sempre — 'Cadastrado no atendimento', que é o carimbo de origem do item manual.
 * @param {number|null} empresaId
 * @returns {Promise<number|null>}
 */
async function garantirProcedimentoDaEmpresa(
  tx,
  { nome, especialidade = null, valor = 0, especieNome = null, categoria = null, tipoProcedimento = null },
  empresaId,
) {
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
      categoria:     String(categoria ?? '').trim().slice(0, 100) || 'Cadastrado no atendimento',
      especialidade: especialidade || null,
      tipoProcedimento: tipoProcedimento ? String(tipoProcedimento).trim().slice(0, 50) : null,
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

/**
 * Esconde o item GLOBAL quando a empresa tem o PRÓPRIO com o mesmo nome.
 *
 * 🔴 POR QUE EXISTE: até a troca de unidade pela tela de estoque
 * (`lib/unidadeMedicamento.js`), nada criava duas linhas de mesmo nome no escopo
 * visível — `garantirMedicamentoDaEmpresa` REAPROVEITA o global em vez de copiar. O
 * copy-on-write da unidade cria a cópia de propósito, e sem este recorte a busca da
 * Prescrição e a lista da Farmácia passariam a mostrar "Dipirona" DUAS VEZES: a cópia
 * (com o estoque e a unidade certa) e a global (sem estoque), indistinguíveis pelo nome.
 *
 * Mesma chave que o resto do módulo usa para dizer "é o mesmo item": nome sem
 * diferenciar maiúsculas nem espaço em volta.
 *
 * ⚠️ Filtra o que se EXIBE, nunca o que existe: a linha global continua no catálogo
 * para todas as outras clínicas.
 * ⚠️ Aplicado DEPOIS do `take` da consulta, então uma página pode vir com um item a
 * menos — é lista de busca, não paginação contada.
 *
 * @param {Array<{nome?:string, empresaId?:number|null}>} itens
 */
function preferirCopiaDaEmpresa(itens) {
  const lista = Array.isArray(itens) ? itens : [];
  const chave = (n) => String(n ?? '').trim().toLocaleLowerCase('pt-BR');
  const proprios = new Set(
    lista.filter((m) => m?.empresaId != null).map((m) => chave(m.nome)),
  );
  if (proprios.size === 0) return lista;
  return lista.filter((m) => m?.empresaId != null || !proprios.has(chave(m?.nome)));
}

module.exports = {
  dedupPorCaixa,
  preferirCopiaDaEmpresa,
  viaExcluidaDoSeletor,
  garantirMedicamentoDaEmpresa,
  garantirProcedimentoDaEmpresa,
  garantirEspecialidadeDaEmpresa,
  vincularEspecie,
  normalizarEspecies,
};
