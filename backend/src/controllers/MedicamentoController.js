// backend/src/controllers/MedicamentoController.js
'use strict';

const prisma = require('../lib/prisma').default;
// PRODUTO DE FORNECEDOR — o item que a clínica NÃO estoca mas consegue pedir.
// Lido por SQL cru: a tabela é da migration 20261006000000 e o client pode não
// conhecê-la (§11). Sem ela, a lista sai como saía antes.
const produtoFornecedor = require('../lib/produtoFornecedor');
const { registrarAuditoria } = require('../lib/auditoria');
const { garantirMedicamentoDaEmpresa, dedupPorCaixa, viaExcluidaDoSeletor,
        preferirCopiaDaEmpresa } = require('../lib/catalogoManual');
// Garante a opção 'Un.' no seletor de unidade quando o catálogo da empresa não tem
// nenhuma equivalente — ver lib/unidadeMedicamento.js.
const { garantirUnidadeAvulsa } = require('../lib/unidadeMedicamento');

const INCLUDE = {
  vias: { select: { id: true, via: true }, orderBy: { via: 'asc' } },
};

const INCLUDE_VACINA = {
  vias:    { select: { id: true, via: true }, orderBy: { via: 'asc' } },
  especies: {
    select: {
      id:      true,
      especie: { select: { id: true, nome: true } },
    },
  },
};

// ─── Helper: verifica duplicata com os 5 campos da chave única ────────────────
// nome + fabricante + formaFarmaceutica + apresentacao + set de vias
// excludeId: ignora o próprio registro ao verificar (usado no update)

async function verificarDuplicata(nome, fabricante, formaFarmaceutica, apresentacao, vias, excludeId = null) {
  const fab = (fabricante ?? '').trim().toLowerCase();
  const viasNorm = [...vias].map(v => String(v).trim().toLowerCase()).sort().join('|');

  const candidatos = await prisma.medicamento.findMany({
    where: {
      ...(excludeId ? { id: { not: excludeId } } : {}),
      nome:              { equals: nome.trim(),              mode: 'insensitive' },
      formaFarmaceutica: { equals: formaFarmaceutica.trim(), mode: 'insensitive' },
      apresentacao:      { equals: apresentacao.trim(),      mode: 'insensitive' },
    },
    include: { vias: { select: { via: true } } },
  });

  return candidatos.some(c => {
    const cFab  = (c.fabricante ?? '').trim().toLowerCase();
    const cVias = c.vias.map(v => v.via.trim().toLowerCase()).sort().join('|');
    return cFab === fab && cVias === viasNorm;
  });
}

// ─── Helper: retorna vias atuais de um medicamento ───────────────────────────

async function getViasExistentes(medicamentoId) {
  const rows = await prisma.medicamentoVia.findMany({
    where:  { medicamentoId },
    select: { via: true },
  });
  return rows.map(r => r.via);
}

// Catálogo VISÍVEL para a empresa ativa: o global (empresaId null, mantido pelo ADMIN)
// + o que a própria empresa cadastrou à mão (lib/catalogoManual.js grava `empresaId`).
//
// Sem este recorte, `listar`/`listarVacinas`/`obterPorId` devolviam TAMBÉM os itens
// privados das outras clínicas — nome comercial, fabricante e apresentação do que cada
// concorrente usa. `paraAtendimento` já filtrava assim; as listagens é que não.
// ADMIN da plataforma continua vendo tudo (é ele quem mantém o catálogo global).
function escopoCatalogo(req) {
  if (req.user?.userType === 'ADMIN') return {};
  const empresaId = req.empresaId ? Number(req.empresaId) : null;
  return { OR: [{ empresaId: null }, ...(empresaId ? [{ empresaId }] : [])] };
}

// 🔴 O QUE É DA EMPRESA VEM ANTES DO CATÁLOGO GLOBAL (pedido de 2026-09-15).
//
// "Da empresa" NÃO é só `empresa_id` preenchido — é a UNIÃO de três coisas, nesta ordem:
//   1. o que a clínica TEM EM ESTOQUE — o frasco está na prateleira, mesmo que a linha do
//      catálogo seja GLOBAL (estoque é sempre de UMA empresa);
//   2. o que ela NÃO tem em estoque mas CADASTROU em `/cadastro/produtos` — hoje isso
//      grava a cópia da empresa (`empresa_id`, copy-on-write de `lib/catalogoEmpresa.js`)
//      e, no modelo anterior, o vínculo com o fornecedor (`tb_produtos_fornecedor`);
//   3. o resto do catálogo GLOBAL, que é o que sobra.
// Medido na base: o animal 93 (empresa 58) enxerga 2 em estoque + 3 cadastrados contra
// 4.368 globais — em ordem alfabética pura os cinco ficavam perdidos no meio.
//
// ⚠️ A ordem DEFINITIVA é o sort de `paraAtendimento` (que conhece estoque e fornecedor);
// este `orderBy` é o que faz a PRIMEIRA PÁGINA já sair coerente — e isso não é detalhe:
// `listar` PAGINA (a Farmácia pede 5.000, o catálogo do ADMIN pagina de 30 em 30) e a
// Prescrição abre o dropdown com `limit=5` enquanto o catálogo completo carrega em
// paralelo. Ordenando só a página recebida, o item da clínica nem entraria nela quando o
// nome fosse alfabeticamente tarde, e o defeito apareceria justamente na primeira tela
// que a pessoa vê — sem erro nenhum.
//
// ⚠️ A CONTAGEM DE ESTOQUE É ESCOPADA PELO RLS, não por um `where`: `tb_estoque_clinica`
// e `tb_lotes_vacina` estão com ENABLE + FORCE, então a subconsulta do `_count` só enxerga
// as linhas da empresa da sessão. Verificado ao vivo: as empresas 58 e 42 devolvem itens
// diferentes no topo. ⚠️ Ela conta a entrada INATIVA também (o `_count` do Prisma não
// aceita filtro) — aceitável aqui: é item com que a clínica já lidou, e quem decide o
// grupo de verdade é o sort.
//
// ⚠️ `empresaId: 'asc'` e NUNCA `'desc'`: no Postgres ASC é NULLS LAST, então o não-nulo
// (a empresa) vem primeiro e o global (`empresa_id IS NULL`) por último. `desc` é NULLS
// FIRST e inverteria tudo. Mesma precedência de `garantirMedicamentoDaEmpresa`.
//
// ⚠️ ADMIN da plataforma fica FORA: ele enxerga o catálogo de TODAS as clínicas, e ali
// `empresaId asc` agruparia por id de empresa — ordem que não significa nada na tela dele,
// que segue alfabética.
function ordemEmpresaPrimeiro(req, relacaoEstoque = 'estoques') {
  const escopado = req.user?.userType !== 'ADMIN' && req.empresaId;
  if (!escopado) return [{ nome: 'asc' }];
  return [
    { [relacaoEstoque]: { _count: 'desc' } },  // 1. o frasco está aqui
    { empresaId: 'asc' },                      // 2. cadastrado pela clínica (NULLS LAST)
    { nome: 'asc' },                           // 3. alfabético
  ];
}

// Espécies que valem para o item cadastrado SEM paciente na tela (Entrada de Estoque
// da Farmácia e Estoque de Vacinas). A espécie é o que faz o item aparecer nas buscas
// depois — sem ela, o medicamento/vacina recém-criado nasce FORA do filtro da própria
// tela que o criou, e a pessoa conclui que o cadastro não funcionou.
//
// 🔴 É a UNIÃO das duas fontes que as telas usam para recortar o catálogo, porque elas
// não são a mesma:
//   • `listar` (Farmácia, `especieDaEmpresa=true`) → espécies dos ANIMAIS ativos;
//   • `EstoqueVacinaController.getEspeciesIds` → para VETERINARIO, as espécies
//     DECLARADAS no perfil (`tb_vet_especies`), caindo nos animais só quando não há
//     nenhuma declarada.
// Cobrir só uma deixaria o item invisível na outra. Espécie a mais não vaza nada: o
// item é privado da empresa e o RLS de `tb_medicamentos` o mantém assim.
async function especiesParaItemSemPaciente(req) {
  const empresaId = req.empresaId ?? null;
  const equipeId  = req.equipeId  ?? null;
  const ids = new Set();

  if (empresaId || equipeId) {
    const where = { ativo: true };
    if (equipeId) where.equipeId  = Number(equipeId);
    else          where.empresaId = Number(empresaId);

    const linhas = await prisma.animal.findMany({
      where, select: { especieId: true }, distinct: ['especieId'],
    });
    for (const a of linhas) if (a.especieId) ids.add(a.especieId);
  }

  if (req.user?.userType === 'VETERINARIO' && req.user?.id) {
    const doVet = await prisma.vetEspecie.findMany({
      where:  { vetPerfil: { userId: Number(req.user.id) } },
      select: { especieId: true }, distinct: ['especieId'],
    }).catch(() => []);
    for (const e of doVet) if (e.especieId) ids.add(e.especieId);
  }

  return [...ids];
}

// GET /medicamentos/opcoes-catalogo?tipo=medicamento|vacina
//
// Valores que JÁ EXISTEM no catálogo visível da empresa, para os seletores da tela de
// cadastro rápido (Prescrição, Vacina e Entrada de Estoque). NÃO é lista fixa no código:
// uma constante no front divergiria do banco no primeiro item novo, e o cadastro passaria
// a criar variações do que já existe ("Frasco" × "frasco ampola") sem ninguém notar.
//
// ⚠️ Recortado por `tipo`: a vacina tem forma, unidade e via PRÓPRIAS ('dose',
// 'Subcutânea (SC)'), e oferecer 'Comprimido' num cadastro de vacina seria oferecer o
// que não existe ali.
const opcoesCatalogo = async (req, res) => {
  try {
    const isVacina = req.query.tipo === 'vacina';
    const escopo   = escopoCatalogo(req);

    const where = {
      ativo: true,
      ...(isVacina ? { classificacao: { contains: 'vacin', mode: 'insensitive' } }
                   : { NOT: { classificacao: { contains: 'vacin', mode: 'insensitive' } } }),
      ...(escopo.OR ? { AND: [escopo] } : {}),
    };

    // `groupBy` (e não `distinct`) porque a CONTAGEM é que resolve a duplicata de
    // caixa: com 'kg' e 'Kg' no catálogo, o seletor mostrava as duas como se fossem
    // unidades diferentes. Fica a grafia MAIS USADA — escolher a primeira alfabética
    // faria 'Kg' vencer 'kg' por acidente de ordenação.
    const [formas, unidades, apresentacoes, vias] = await Promise.all([
      prisma.medicamento.groupBy({ by: ['formaFarmaceutica'], where, _count: { _all: true } }),
      prisma.medicamento.groupBy({ by: ['unidade'],           where, _count: { _all: true } }),
      prisma.medicamento.groupBy({ by: ['apresentacao'],      where, _count: { _all: true } }),
      prisma.medicamentoVia.groupBy({ by: ['via'], where: { medicamento: where }, _count: { _all: true } }),
    ]);

    const limpar = dedupPorCaixa;

    // Curadoria do seletor de vias (não mexe no catálogo — ver `viaExcluidaDoSeletor`).
    const viasLimpas = limpar(vias, 'via').filter(v => !viaExcluidaDoSeletor(v, isVacina));

    return res.json({
      dados: {
        formas:        limpar(formas,        'formaFarmaceutica'),
        // 🔴 A unidade é a ÚNICA opção do seletor com um valor GARANTIDO: a clínica
        // conta o item em embalagens ('Un.'), e o catálogo global quase sempre só traz
        // peso/volume — sem a garantia, a tela de estoque não teria como corrigir isso.
        unidades:      garantirUnidadeAvulsa(limpar(unidades, 'unidade')),
        apresentacoes: limpar(apresentacoes, 'apresentacao'),
        vias:          viasLimpas,
      },
    });
  } catch (err) {
    console.error('MedicamentoController.opcoesCatalogo:', err);
    return res.status(500).json({ error: 'Erro ao carregar as opções do catálogo.' });
  }
};

// ─── Listar ──────────────────────────────────────────────────────────────────

const listar = async (req, res) => {
  try {
    const { busca, ativo, controlado, especieNome, excluirVacinas, especieDaEmpresa } = req.query;
    const take = Math.min(Number(req.query.limit)  || 5000, 5000);
    const skip = Math.max(Number(req.query.offset) || 0,    0);
    const where = {};

    if (ativo !== undefined) where.ativo = ativo === 'true';
    if (controlado === 'true') where.controlado = true;

    if (excluirVacinas === 'true') {
      where.NOT = { classificacao: { contains: 'vacin', mode: 'insensitive' } };
    }

    if (busca) {
      where.OR = [
        { nome:              { contains: busca, mode: 'insensitive' } },
        { formaFarmaceutica: { contains: busca, mode: 'insensitive' } },
        { vias: { some: { via: { contains: busca, mode: 'insensitive' } } } },
      ];
    }

    if (especieNome) {
      const ids = await prisma.$queryRawUnsafe(
        `SELECT DISTINCT me."medicamentoId"
         FROM schs2vet.tb_medicamento_especies me
         JOIN schs2vet.tb_especies e ON e.id = me."especieId"
         WHERE lower(e.nome) = lower($1)`,
        especieNome
      );
      where.id = { in: ids.map((r) => r.medicamentoId) };
    }

    // Resolve espécies a partir dos animais ativos da empresa/equipe do contexto
    if (especieDaEmpresa === 'true' && !especieNome) {
      const empresaId = req.empresaId ?? null;
      const equipeId  = req.equipeId  ?? null;
      if (empresaId || equipeId) {
        const animalWhere = { ativo: true };
        if (equipeId)  animalWhere.equipeId  = equipeId;
        else           animalWhere.empresaId = empresaId;

        const animaisEspecies = await prisma.animal.findMany({
          where:    animalWhere,
          select:   { especieId: true },
          distinct: ['especieId'],
        });
        const especieIds = animaisEspecies.map((a) => a.especieId);

        if (especieIds.length > 0) {
          // Filtra medicamentos vinculados a pelo menos uma dessas espécies
          where.especies = { some: { especieId: { in: especieIds } } };
        }
        // Se não há animais ainda, não filtra por espécie (exibe o catálogo completo)
      }
    }

    // O escopo entra como AND para não colidir com o `where.OR` da busca por nome.
    const escopo = escopoCatalogo(req);
    where.AND = [...(where.AND ?? []), ...(escopo.OR ? [escopo] : [])];

    const [medicamentos, total, totalControlados, totalFiltrado] = await Promise.all([
      prisma.medicamento.findMany({ where, include: INCLUDE_VACINA, orderBy: ordemEmpresaPrimeiro(req), take, skip }),
      prisma.medicamento.count({ where: { ativo: true, ...escopo } }),
      prisma.medicamento.count({ where: { ativo: true, controlado: true, ...escopo } }),
      prisma.medicamento.count({ where }),
    ]);

    return res.json({
      // Medicamento GLOBAL cuja cópia a empresa já tem (troca de unidade) sai da lista —
      // as duas linhas têm o mesmo nome e a tela não teria como distingui-las.
      dados: preferirCopiaDaEmpresa(medicamentos),
      meta: {
        total,
        totalControlados,
        totalFiltrado,
        offset: skip,
        limit: take,
        hasMore: skip + medicamentos.length < totalFiltrado,
      },
    });
  } catch (err) {
    console.error('MedicamentoController.listar:', err);
    return res.status(500).json({ error: 'Erro ao listar medicamentos.' });
  }
};

// ─── Listar Vacinas (classificacao contém 'vacin') ────────────────────────────

const listarVacinas = async (req, res) => {
  try {
    const { busca, ativo } = req.query;
    const where = {
      classificacao: { contains: 'vacin', mode: 'insensitive' },
    };

    if (ativo !== undefined) where.ativo = ativo === 'true';

    if (busca) {
      where.AND = [
        { classificacao: { contains: 'vacin', mode: 'insensitive' } },
        {
          OR: [
            { nome:       { contains: busca, mode: 'insensitive' } },
            { fabricante: { contains: busca, mode: 'insensitive' } },
          ],
        },
      ];
      delete where.classificacao;
    }

    const escopo = escopoCatalogo(req);
    where.AND = [...(where.AND ?? []), ...(escopo.OR ? [escopo] : [])];

    const vacinas = await prisma.medicamento.findMany({
      where,
      include: INCLUDE_VACINA,
      orderBy: { nome: 'asc' },
    });

    return res.json({ dados: vacinas });
  } catch (err) {
    console.error('MedicamentoController.listarVacinas:', err);
    return res.status(500).json({ error: 'Erro ao listar vacinas.' });
  }
};

// ─── Listar Espécies ──────────────────────────────────────────────────────────

const listarEspecies = async (_req, res) => {
  try {
    const especies = await prisma.especie.findMany({
      select:  { id: true, nome: true },
      orderBy: { nome: 'asc' },
    });
    return res.json({ dados: especies });
  } catch (err) {
    console.error('MedicamentoController.listarEspecies:', err);
    return res.status(500).json({ error: 'Erro ao listar espécies.' });
  }
};

// ─── Obter por ID ─────────────────────────────────────────────────────────────

const obterPorId = async (req, res) => {
  try {
    const med = await prisma.medicamento.findFirst({
      where: { id: Number(req.params.id), ...escopoCatalogo(req) },
      include: INCLUDE_VACINA,
    });
    // Item privado de outra clínica responde 404 — não confirma que existe.
    if (!med) return res.status(404).json({ error: 'Medicamento não encontrado.' });
    return res.json({ dados: med });
  } catch (err) {
    console.error('MedicamentoController.obterPorId:', err);
    return res.status(500).json({ error: 'Erro ao buscar medicamento.' });
  }
};

// ─── Criar ───────────────────────────────────────────────────────────────────

const criar = async (req, res) => {
  try {
    const {
      nome, formaFarmaceutica, unidade, apresentacao,
      controlado = false, ativo = true, vias = [],
      classificacao, fabricante, especieIds = [],
    } = req.body;

    if (!nome || !formaFarmaceutica || !unidade || !apresentacao)
      return res.status(400).json({ error: 'Campos obrigatórios: nome, formaFarmaceutica, unidade, apresentacao.' });

    if (!Array.isArray(vias) || vias.length === 0)
      return res.status(400).json({ error: 'Informe ao menos uma via de administração.' });

    const isDup = await verificarDuplicata(nome, fabricante, formaFarmaceutica, apresentacao, vias);
    if (isDup)
      return res.status(409).json({ error: 'Já existe um medicamento com o mesmo nome, fabricante, forma farmacêutica, apresentação e via.' });

    const createData = {
      nome:              nome.trim(),
      formaFarmaceutica: formaFarmaceutica.trim(),
      unidade:           unidade.trim(),
      apresentacao:      apresentacao.trim(),
      controlado:        Boolean(controlado),
      ativo:             Boolean(ativo),
      vias:              { create: vias.map((v) => ({ via: String(v) })) },
    };
    if (classificacao) createData.classificacao = classificacao.trim();
    if (fabricante)    createData.fabricante    = fabricante.trim();
    if (Array.isArray(especieIds) && especieIds.length > 0) {
      createData.especies = { create: especieIds.map((id) => ({ especieId: Number(id) })) };
    }

    const med = await prisma.medicamento.create({ data: createData, include: INCLUDE });

    return res.status(201).json({ data: med });
  } catch (err) {
    console.error('MedicamentoController.criar:', err);
    return res.status(500).json({ error: 'Erro ao criar medicamento.' });
  }
};

// ─── Atualizar ────────────────────────────────────────────────────────────────

const atualizar = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { nome, formaFarmaceutica, unidade, apresentacao, controlado, ativo, vias, classificacao, fabricante, especieIds } = req.body;

    const existe = await prisma.medicamento.findUnique({ where: { id } });
    if (!existe) return res.status(404).json({ error: 'Medicamento não encontrado.' });

    // Resolve os valores efetivos (enviado no body ou mantém o atual)
    const nomeEfetivo = nome              ?? existe.nome;
    const fabEfetivo  = fabricante        !== undefined ? fabricante : existe.fabricante;
    const formaEfetiva = formaFarmaceutica ?? existe.formaFarmaceutica;
    const apresEfetiva = apresentacao     ?? existe.apresentacao;
    const viasEfetivas = Array.isArray(vias) ? vias : await getViasExistentes(id);

    const isDup = await verificarDuplicata(
      nomeEfetivo, fabEfetivo, formaEfetiva, apresEfetiva, viasEfetivas,
      id  // exclui o próprio registro da checagem
    );
    if (isDup)
      return res.status(409).json({ error: 'Já existe um medicamento com o mesmo nome, fabricante, forma farmacêutica, apresentação e via.' });

    const data = {};
    if (nome              !== undefined) data.nome              = nome.trim();
    if (formaFarmaceutica !== undefined) data.formaFarmaceutica = formaFarmaceutica.trim();
    if (unidade           !== undefined) data.unidade           = unidade.trim();
    if (apresentacao      !== undefined) data.apresentacao      = apresentacao.trim();
    if (controlado        !== undefined) data.controlado        = Boolean(controlado);
    if (ativo             !== undefined) data.ativo             = Boolean(ativo);
    if (fabricante        !== undefined) data.fabricante        = fabricante?.trim() || null;
    if (classificacao     !== undefined) data.classificacao     = classificacao?.trim() || null;

    const med = await prisma.$transaction(async (tx) => {
      if (Array.isArray(vias)) {
        await tx.medicamentoVia.deleteMany({ where: { medicamentoId: id } });
        data.vias = { create: vias.map((v) => ({ via: String(v) })) };
      }

      if (Array.isArray(especieIds)) {
        await tx.medicamentoEspecie.deleteMany({ where: { medicamentoId: id } });
      }

      const updated = await tx.medicamento.update({ where: { id }, data, include: INCLUDE });

      if (Array.isArray(especieIds) && especieIds.length > 0) {
        await tx.medicamentoEspecie.createMany({
          data: especieIds.map((eid) => ({ medicamentoId: id, especieId: Number(eid) })),
        });
      }

      if (Array.isArray(especieIds)) {
        return tx.medicamento.findUnique({ where: { id }, include: INCLUDE_VACINA });
      }

      return updated;
    });

    return res.json({ dados: med });
  } catch (err) {
    console.error('MedicamentoController.atualizar:', err);
    return res.status(500).json({ error: 'Erro ao atualizar medicamento.' });
  }
};

// ─── Excluir (soft delete) ────────────────────────────────────────────────────

const excluir = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { motivo } = req.body ?? {};
    if (!motivo?.trim()) {
      return res.status(400).json({ error: 'É obrigatório informar o motivo da exclusão' });
    }

    const existe = await prisma.medicamento.findUnique({ where: { id } });
    if (!existe) return res.status(404).json({ error: 'Medicamento não encontrado.' });

    await prisma.medicamento.update({ where: { id }, data: { ativo: false } });

    await registrarAuditoria(null, req, {
      categoria:  'EXCLUSAO',
      entidade:   'MEDICAMENTO',
      entidadeId: id,
      motivo,
      detalhes:   existe.nome ?? null,
    });

    return res.json({ data: { message: 'Medicamento inativado com sucesso.' } });
  } catch (err) {
    console.error('MedicamentoController.excluir:', err);
    return res.status(500).json({ error: 'Erro ao excluir medicamento.' });
  }
};

// ─── Para Atendimento ─────────────────────────────────────────────────────────
// Retorna todos os medicamentos do catálogo para a espécie do animal,
// com flag emEstoque indicando se há entrada no estoque da empresa.
// tipo=medicamento: exclui vacinas (classificacao contém 'vacin')
// tipo=vacina:      filtra apenas vacinas
// O backend de prescrição e vacina já ignora silenciosamente itens sem entrada
// de estoque (criarReservas / consumirReservas / verificarEstoqueParaDia fazem
// continue quando !estoque), portanto nenhuma mudança de fluxo é necessária.

// POST /medicamentos/garantir — cadastra (ou reaproveita) um MEDICAMENTO ou VACINA
// digitado à mão nas telas de atendimento (Prescrição já resolve isso na hora de
// salvar, via `garantirMedicamentoDaEmpresa` — ver PrescricaoGrupoController.js; a
// Vacina PRECISA do id ANTES de salvar, porque a tela dela já usa o id para buscar
// lote/estoque/via no mesmo clique, então este endpoint devolve o item já pronto no
// formato que os dois comboboxes esperam de `/medicamentos/para-atendimento`).
//
// O item nasce PRIVADO da empresa do contexto ativo — `empresaId` não nulo em
// `lib/catalogoManual.js` — e só ela o vê nas próprias buscas dali em diante (o
// catálogo global, ADMIN-only, nunca é tocado por aqui).
const garantirCatalogoManual = async (req, res) => {
  try {
    const { nome, tipo = 'medicamento', animalId, unidade,
            formaFarmaceutica, apresentacao, controlado, vias, fabricante,
            multidose, dosesPorEmbalagem } = req.body;
    const n = String(nome ?? '').trim();
    if (!n) return res.status(400).json({ error: 'Nome é obrigatório.' });

    const isVacina = tipo === 'vacina';

    // A tela de cadastro (Prescrição, Vacina e Entrada de Estoque) manda os campos e
    // exige TODOS eles. O caminho antigo — só o nome — continua valendo para quem
    // chama sem formulário; ali o item nasce com os padrões de `catalogoManual.js`.
    const comFormulario = formaFarmaceutica !== undefined
      || apresentacao !== undefined || vias !== undefined;
    const viasLista = Array.isArray(vias) ? vias.map(v => String(v ?? '').trim()).filter(Boolean) : [];
    if (comFormulario) {
      const faltando = [];
      if (!String(formaFarmaceutica ?? '').trim()) faltando.push('Forma');
      if (!String(unidade ?? '').trim())           faltando.push('Unidade');
      if (!String(apresentacao ?? '').trim())      faltando.push('Apresentação');
      if (viasLista.length === 0)                  faltando.push('Vias');
      if (faltando.length > 0) {
        return res.status(400).json({ error: `Preencha: ${faltando.join(', ')}.`, campos: faltando });
      }
    }

    // A ESPÉCIE é o que faz o item aparecer nas buscas depois (`paraAtendimento` e o
    // filtro `especieDaEmpresa` de `listar` recortam por ela). Com paciente na tela,
    // é a dele; sem paciente — a Entrada de Estoque não tem um —, são as espécies dos
    // animais ATIVOS da empresa, exatamente o conjunto que aquele filtro consulta.
    // Sem nenhuma das duas o item nasceria invisível na própria tela que o criou.
    let especieIds = [];
    if (animalId) {
      const animal = await prisma.animal.findUnique({
        where:  { id: Number(animalId) },
        select: { especieId: true },
      });
      if (!animal) return res.status(404).json({ error: 'Animal não encontrado.' });
      especieIds = animal.especieId ? [animal.especieId] : [];
    } else {
      especieIds = await especiesParaItemSemPaciente(req);
    }

    const id = await garantirMedicamentoDaEmpresa(prisma, {
      nome:       n,
      unidade,
      formaFarmaceutica,
      apresentacao,
      fabricante,
      controlado: controlado === true || controlado === 'true',
      vias:       viasLista,
      vacina:     isVacina,
      especieIds,
    }, req.empresaId ?? null);

    // 🔴 MULTIDOSE do item (2026-09-15) — o mesmo campo da tela de Produtos. Vai por
    // SQL cru com `catch` (§11): a coluna é da migration 20261009000000 e o client
    // pode não conhecê-la; falhando, o item nasce sem a marcação e é cobrado pela
    // embalagem inteira — o comportamento anterior, nunca um erro na tela.
    // ⚠️ `garantirMedicamentoDaEmpresa` REAPROVEITA o item existente (pode ser GLOBAL),
    // e o global nunca é marcado: a checagem de `empresa_id` no UPDATE é o que impede
    // um cadastro rápido mudar a cobrança de todas as clínicas do SaaS.
    if (multidose !== undefined || dosesPorEmbalagem !== undefined) {
      const n = Number(dosesPorEmbalagem);
      const marcado = multidose === true && Number.isFinite(n) && n >= 1;
      await prisma.$executeRawUnsafe(
        `UPDATE schs2vet.tb_medicamentos
            SET multidose = $2, doses_por_embalagem = $3
          WHERE id = $1 AND empresa_id IS NOT NULL`,
        Number(id), marcado, marcado ? Math.trunc(n) : null,
      ).catch(() => {});
    }

    // Mesmo formato de `paraAtendimento` — o front trata o resultado como mais um
    // item da lista, sem precisar de um tipo/caminho de dado à parte.
    const criado = await prisma.medicamento.findUnique({
      where:   { id },
      include: { vias: { select: { id: true, via: true }, orderBy: { via: 'asc' } } },
    });
    return res.status(201).json({
      dados: {
        id: criado.id, nome: criado.nome, formaFarmaceutica: criado.formaFarmaceutica,
        unidade: criado.unidade, apresentacao: criado.apresentacao,
        fabricante: criado.fabricante,
        controlado: criado.controlado, ativo: criado.ativo, vias: criado.vias,
        emEstoque: false, qtdEstoque: null, precoUnitarioBase: null, valorPorDose: null,
        // Item recém-criado à mão não tem fornecedor cadastrado — cadastrar isso é
        // ato à parte, na tela de Produtos.
        ehProduto: false, fornecedores: [],
      },
    });
  } catch (err) {
    console.error('MedicamentoController.garantirCatalogoManual:', err);
    return res.status(500).json({ error: 'Erro ao cadastrar item no catálogo.' });
  }
};

const paraAtendimento = async (req, res) => {
  try {
    const { animalId, tipo = 'medicamento', busca, limit } = req.query;
    const empresaId = req.empresaId ?? null;

    if (!animalId) return res.status(400).json({ error: 'animalId é obrigatório.' });

    const animal = await prisma.animal.findUnique({
      where:  { id: Number(animalId) },
      select: { especieId: true },
    });
    if (!animal) return res.status(404).json({ error: 'Animal não encontrado.' });

    const where = { ativo: true };

    if (animal.especieId) {
      where.especies = { some: { especieId: animal.especieId } };
    }

    const isVacina = tipo === 'vacina';

    if (isVacina) {
      where.classificacao = { contains: 'vacin', mode: 'insensitive' };
    } else {
      where.NOT = { classificacao: { contains: 'vacin', mode: 'insensitive' } };
    }

    if (busca?.trim()) {
      where.OR = [
        { nome:              { contains: busca.trim(), mode: 'insensitive' } },
        { formaFarmaceutica: { contains: busca.trim(), mode: 'insensitive' } },
      ];
    }

    // Catálogo global (empresaId null) + medicamentos próprios da empresa ativa
    where.AND = [{ OR: [{ empresaId: null }, ...(empresaId ? [{ empresaId }] : [])] }];

    // FAIL-CLOSED: estoque e lote pertencem SEMPRE a uma empresa (não existe estoque
    // global). Sem contexto o spread virava `{}` e mostrava o saldo das outras clínicas
    // ao lado do medicamento — `?? -1` não casa com nenhuma empresa.
    const escopoFisico = { empresaId: empresaId ? Number(empresaId) : -1 };
    const estoqueWhere = { ativo: true, ...escopoFisico };
    const loteWhere    = { ativo: true, qtdDisponivel: { gt: 0 }, ...escopoFisico };

    // `limit` é OPCIONAL — quem não passar continua recebendo o catálogo inteiro
    // (SubModuloVacina/Orçamento contam com isso). O seletor de medicamento da
    // Prescrição usa `limit=5` para o dropdown aparecer rápido ao abrir, enquanto
    // o catálogo completo (milhares de linhas) carrega em paralelo — sem isso, o
    // primeiro request já trazia tudo e travava a lista até terminar.
    const limitNum = Number(limit);
    const take = Number.isFinite(limitNum) && limitNum > 0 ? limitNum : undefined;

    const medicamentos = await prisma.medicamento.findMany({
      where,
      include: {
        vias: { select: { id: true, via: true }, orderBy: { via: 'asc' } },
        ...(isVacina
          ? { lotes: { where: loteWhere, select: { id: true, valorUnitario: true, valorUnitarioRepassado: true, dosesPorFrasco: true }, orderBy: { validade: 'asc' }, take: 1 } }
          : { estoques: { where: estoqueWhere, select: { id: true, qtdEstoque: true, precoUnitarioBase: true } } }
        ),
      },
      // Vacina guarda o estoque em `lotes`; medicamento, em `estoques`. Passar a
      // relação errada faria a contagem sair sempre ZERO — em silêncio.
      orderBy: ordemEmpresaPrimeiro(req, isVacina ? 'lotes' : 'estoques'),
      ...(take ? { take } : {}),
    });

    // `empresaId` não vai para o payload (a tela não precisa dele), mas o sort abaixo
    // precisa: o mapa guarda a origem de cada item antes de os objetos serem remontados.
    const daEmpresa = new Map(medicamentos.map(m => [m.id, m.empresaId != null]));

    // Fornecedores de TODOS os itens da página, numa consulta só. Nunca por item:
    // o catálogo tem milhares de linhas e uma ida ao banco por linha derrubaria a tela.
    const produtos = await produtoFornecedor.produtosPorMedicamento(
      empresaId, medicamentos.map(m => m.id),
    );

    /**
     * 🔴 O item é PRODUTO quando tem fornecedor cadastrado E não está no estoque
     * (decisão de 2026-09-10). São coisas diferentes: em ESTOQUE a clínica já tem o
     * frasco; PRODUTO ela pede ao fornecedor quando prescreve. Marcar como produto o
     * que já está em estoque faria a cor deixar de distinguir as duas coisas — que é
     * justamente para o que ela serve.
     */
    const infoProduto = (id, emEstoque) => {
      const lista = produtos.get(id) ?? [];
      if (emEstoque || lista.length === 0) return { ehProduto: false, fornecedores: [] };
      return {
        ehProduto: true,
        fornecedores: lista.map(p => ({
          id: p.fornecedorId, nome: p.fornecedorNome,
          valorUnitario: p.valorUnitario, valorVenda: p.valorVenda, unidade: p.unidade,
        })),
      };
    };

    // Medicamento GLOBAL de que a empresa já tem a CÓPIA (troca de unidade pela tela de
    // estoque) sai da busca: as duas linhas têm o mesmo nome, e a global apareceria
    // "sem estoque" ao lado da cópia que tem o frasco — ver preferirCopiaDaEmpresa.
    const dados = preferirCopiaDaEmpresa(medicamentos).map(m => {
      if (isVacina) {
        // Preço por dose do lote FEFO disponível (para pré-preencher o orçamento);
        // null quando não há estoque — a vacina ainda aparece (preço editável).
        const lote = (m.lotes ?? [])[0];
        const valorPorDose = lote
          ? Number(lote.valorUnitarioRepassado ?? lote.valorUnitario ?? 0) / (Number(lote.dosesPorFrasco) || 1)
          : null;
        const emEstoque = (m.lotes ?? []).length > 0;
        return {
          id: m.id, nome: m.nome, formaFarmaceutica: m.formaFarmaceutica,
          unidade: m.unidade, vias: m.vias,
          emEstoque,
          valorPorDose,
          ...infoProduto(m.id, emEstoque),
        };
      }
      const estoques = m.estoques ?? [];
      const qtdTotal = estoques.reduce((s, e) => s + (e.qtdEstoque ?? 0), 0);
      // Preço base do estoque (R$/g ou R$/mL) para pré-preencher o orçamento
      const precoUnitarioBase = estoques.find(e => e.precoUnitarioBase != null)?.precoUnitarioBase ?? null;
      const emEstoque = estoques.length > 0;
      return {
        id: m.id, nome: m.nome, formaFarmaceutica: m.formaFarmaceutica,
        unidade: m.unidade, vias: m.vias,
        emEstoque,
        qtdEstoque:  emEstoque ? qtdTotal : null,
        precoUnitarioBase,
        ...infoProduto(m.id, emEstoque),
      };
    });

    /**
     * 🔴 ORDEM em QUATRO grupos — os TRÊS PRIMEIROS são "DA EMPRESA" (2026-09-15), o
     * quarto é o catálogo GLOBAL:
     *   0. EM ESTOQUE              — a clínica tem o frasco;
     *   1. PRODUTO de fornecedor   — não tem, mas sabe de quem comprar;
     *   2. CADASTRADO pela clínica — a cópia dela no catálogo (`empresa_id`), que é o que
     *      `/cadastro/produtos` grava, ainda sem estoque nem fornecedor;
     *   3. GLOBAL puro             — o resto do catálogo do sistema.
     * Alfabético dentro de cada grupo.
     *
     * ⚠️ "Da empresa" NÃO é só `empresaId != null`: medicamento GLOBAL que a clínica TEM
     * EM ESTOQUE é dela para todos os efeitos — o frasco está na prateleira. Reduzir o
     * grupo à coluna do catálogo mandaria para baixo justamente o que ela tem em mãos.
     *
     * ⚠️ Os três grupos de 2026-09-10 (estoque → produto → o resto) continuam valendo: o
     * que mudou é que o antigo grupo 2 ("o resto") foi PARTIDO em dois, separando a cópia
     * da clínica do catálogo global.
     *
     * ⚠️ Vale para MEDICAMENTO e VACINA — é a mesma função.
     *
     * ⚠️ A ordem é do BACKEND, não da tela: é aqui que se sabe o que há em estoque, quem
     * fornece e de quem é a linha do catálogo. Mandar as flags e deixar cada tela ordenar
     * seria a mesma regra escrita três vezes (prescrição, vacina, orçamento) — e a
     * terceira divergiria.
     *
     * ⚠️ NÃO é redundante com o `orderBy` da consulta: aquele ordena o que o BANCO sabe
     * (estoque e `empresa_id`), para a primeira página já sair coerente; este é quem
     * conhece o vínculo de FORNECEDOR, que só existe depois do mapeamento.
     */
    const posto = (x) => (x.emEstoque ? 0 : x.ehProduto ? 1 : daEmpresa.get(x.id) ? 2 : 3);
    dados.sort((a, b) => {
      const pa = posto(a), pb = posto(b);
      if (pa !== pb) return pa - pb;
      return a.nome.localeCompare(b.nome, 'pt-BR');
    });

    return res.json({ dados });
  } catch (err) {
    console.error('MedicamentoController.paraAtendimento:', err);
    return res.status(500).json({ error: 'Erro ao buscar medicamentos para atendimento.' });
  }
};

module.exports = { especiesParaItemSemPaciente, listar, listarVacinas, listarEspecies, obterPorId, criar, atualizar, excluir, paraAtendimento, garantirCatalogoManual, opcoesCatalogo };
