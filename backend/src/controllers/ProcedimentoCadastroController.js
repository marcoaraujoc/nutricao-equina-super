// backend/src/controllers/ProcedimentoCadastroController.js
// Cadastro > Procedimentos — visão por especialidade com preços/combos POR EMPRESA.
//   - Especialidades do seletor: vet vê SÓ as suas (UsuarioEspecialidade);
//     GESTOR da empresa ativa e ADMIN veem todas as do catálogo.
//   - Inclusão de procedimento no catálogo: exclusiva do ADMIN (rota do catálogo).
//   - Empresa (GESTOR): define valor por procedimento (ProcedimentoValorEmpresa)
//     e cria combos com valor próprio (ProcedimentoCombo/Item).
'use strict';

const prisma = require('../lib/prisma').default;
const { registrarAuditoria } = require('../lib/auditoria');

// Gestor do contexto ativo: dono da empresa OU membro com cargo GESTOR nela.
async function isGestorDaEmpresa(userId, empresaId) {
  if (!empresaId) return false;
  const emp = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { ownerId: true } });
  if (emp?.ownerId === userId) return true;
  const membro = await prisma.membroEquipe.findFirst({
    where:  { userId, cargo: 'GESTOR', equipe: { empresaId } },
    select: { id: true },
  });
  return Boolean(membro);
}

// Espécies que a empresa atende (mesma resolução de EquipeController.obterEspeciesAtendidas):
// EmpresaConfiguracao.especiesAtendidas explícito > fallback nas espécies do dono (VetEspecie).
// [] = sem restrição configurada (não filtra — evita esconder tudo por falta de configuração).
async function especiesAtendidasDaEmpresa(req) {
  if (!req.empresaId) return [];
  const config = await prisma.empresaConfiguracao.findFirst({
    where: { empresaId: req.empresaId, ...(req.equipeId ? { equipeId: req.equipeId } : {}) },
  });
  let especies = config?.especiesAtendidas
    ? String(config.especiesAtendidas).split(',').map(Number).filter(Number.isInteger)
    : [];
  if (especies.length === 0) {
    const emp = await prisma.empresa.findUnique({ where: { id: req.empresaId }, select: { ownerId: true } });
    if (emp?.ownerId) {
      const perfil = await prisma.vetPerfil.findUnique({
        where:  { userId: emp.ownerId },
        select: { especies: { select: { especieId: true } } },
      });
      especies = perfil?.especies.map(e => e.especieId) ?? [];
    }
  }
  return especies;
}

// Nomes de especialidade (catálogo tb_especialidades) que a empresa atende — usado para
// restringir tanto a lista principal de procedimentos quanto os combos ao que a empresa
// efetivamente cuida. null = sem restrição (nenhuma espécie configurada em lugar nenhum).
async function nomesEspecialidadesPermitidas(req) {
  const especies = await especiesAtendidasDaEmpresa(req);
  if (especies.length === 0) return null;
  const rows = await prisma.especialidade.findMany({
    where:  { especieId: { in: especies }, ativo: true },
    select: { nome: true },
  });
  return new Set(rows.map(r => r.nome));
}

// Nomes (lowercase) das espécies que a empresa atende. null = sem restrição.
// Usado para filtrar procedimentos pela ESPÉCIE (campo ProcedimentoVeterinario.especie)
// — evita trazer procedimentos de espécies que a empresa não trabalha (ex: Bovino).
async function nomesEspeciesDaEmpresa(req) {
  const ids = await especiesAtendidasDaEmpresa(req);
  if (ids.length === 0) return null;
  const rows = await prisma.especie.findMany({ where: { id: { in: ids } }, select: { nome: true } });
  return new Set(rows.map(r => r.nome.trim().toLowerCase()).filter(Boolean));
}

// Procedimento é compatível com as espécies da empresa?
// especie null / "Ambas"/"Ambos" = genérico (serve a todas). Campo pode listar
// várias ("Bovino e Equino") → basta uma das espécies da empresa aparecer.
function procedimentoDaEmpresa(especieProc, especiesEmpresa) {
  if (!especiesEmpresa) return true;              // sem restrição configurada
  if (!especieProc) return true;                   // genérico
  const e = especieProc.trim().toLowerCase();
  if (e === 'ambas' || e === 'ambos') return true;
  for (const nome of especiesEmpresa) if (e.includes(nome)) return true;
  return false;
}

// GET /api/procedimentos/especialidades-minhas
// Nomes de especialidade para o seletor da tela. { dados: [nome], gestor: bool }
const especialidadesMinhas = async (req, res) => {
  try {
    const isAdmin = req.user.userType === 'ADMIN';
    const gestor  = isAdmin || await isGestorDaEmpresa(req.user.id, req.empresaId);

    const permitidas = await nomesEspecialidadesPermitidas(req);

    let nomes;
    if (gestor) {
      const rows = await prisma.especialidade.findMany({
        where: { ativo: true }, select: { nome: true }, orderBy: { nome: 'asc' },
      });
      nomes = rows.map(r => r.nome);
    } else {
      const rows = await prisma.usuarioEspecialidade.findMany({
        where:   { userId: req.user.id, especialidade: { ativo: true } },
        select:  { especialidade: { select: { nome: true } } },
      });
      nomes = rows.map(r => r.especialidade.nome).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    }

    // Restringe às especialidades que a empresa efetivamente atende (Configurações /
    // espécies do dono) — vale tanto para gestor quanto para membro comum.
    if (permitidas) nomes = nomes.filter(n => permitidas.has(n));

    return res.json({ dados: [...new Set(nomes)], gestor });
  } catch (err) {
    console.error('ProcedimentoCadastroController.especialidadesMinhas:', err);
    return res.status(500).json({ error: 'Erro ao listar especialidades.' });
  }
};

// GET /api/procedimentos/cadastro/lista?especialidade=NOME&busca=&especie=NOME
// Procedimentos ativos da especialidade + valor da empresa ativa (quando houver).
const listarComValores = async (req, res) => {
  try {
    const { especialidade, busca, especie } = req.query;
    const where = { ativo: true };
    if (especialidade) where.especialidade = { equals: String(especialidade), mode: 'insensitive' };
    if (busca) {
      where.OR = [
        { nome:          { contains: String(busca), mode: 'insensitive' } },
        { nomeAbreviado: { contains: String(busca), mode: 'insensitive' } },
        { categoria:     { contains: String(busca), mode: 'insensitive' } },
      ];
    }

    // Catálogo global (empresaId null) + procedimentos próprios da empresa ativa
    where.AND = [{ OR: [{ empresaId: null }, ...(req.empresaId ? [{ empresaId: req.empresaId }] : [])] }];

    let procedimentos = await prisma.procedimentoVeterinario.findMany({
      where,
      orderBy: [{ categoria: 'asc' }, { nome: 'asc' }],
      select: {
        id: true, nome: true, nomeAbreviado: true, categoria: true, subcategoria: true,
        especialidade: true, especie: true, tipoProcedimento: true, duracao: true, valorVenda: true, descricao: true,
        empresaId: true,
      },
    });

    // Filtros por especialidade/espécie que a empresa atende — procedimento PRÓPRIO da
    // empresa (empresaId setado) sempre aparece, independente desses filtros.
    const permitidas      = await nomesEspecialidadesPermitidas(req);
    const especiesEmpresa = await nomesEspeciesDaEmpresa(req);
    procedimentos = procedimentos.filter(p => {
      if (p.empresaId && p.empresaId === req.empresaId) return true;
      if (permitidas && !permitidas.has(p.especialidade)) return false;
      if (!procedimentoDaEmpresa(p.especie, especiesEmpresa)) return false;
      return true;
    });

    // Só os procedimentos da espécie do animal em atendimento (ex: "Acupuntura" tem
    // procedimentos catalogados por espécie — Equino, Bovino, Canino... — o mesmo nome
    // de especialidade não deve misturar espécies diferentes). "Ambas"/sem espécie
    // definida = procedimento genérico, aparece para qualquer espécie.
    if (especie) {
      const especieNorm = String(especie).trim().toLowerCase();
      procedimentos = procedimentos.filter(p =>
        !p.especie || p.especie.toLowerCase() === 'ambas' || p.especie.toLowerCase() === especieNorm
      );
    }

    let valores = new Map();
    if (req.empresaId && procedimentos.length > 0) {
      const rows = await prisma.procedimentoValorEmpresa.findMany({
        where:  { empresaId: req.empresaId, procedimentoId: { in: procedimentos.map(p => p.id) } },
        select: { procedimentoId: true, valor: true },
      });
      valores = new Map(rows.map(r => [r.procedimentoId, r.valor]));
    }

    return res.json({
      dados: procedimentos.map(p => ({ ...p, valorEmpresa: valores.get(p.id) ?? null })),
    });
  } catch (err) {
    console.error('ProcedimentoCadastroController.listarComValores:', err);
    return res.status(500).json({ error: 'Erro ao listar procedimentos.' });
  }
};

// PUT /api/procedimentos/cadastro/valor/:procedimentoId  { valor }  — GESTOR
// valor numérico > 0 grava/atualiza; null/''/0 remove o valor da empresa.
const definirValor = async (req, res) => {
  try {
    if (!req.empresaId) return res.status(400).json({ error: 'Contexto de empresa não resolvido.' });
    if (!(await isGestorDaEmpresa(req.user.id, req.empresaId))) {
      return res.status(403).json({ error: 'Somente o gestor da empresa define valores de procedimento.' });
    }

    const procedimentoId = Number(req.params.procedimentoId);
    const proc = await prisma.procedimentoVeterinario.findUnique({ where: { id: procedimentoId }, select: { id: true } });
    if (!proc) return res.status(404).json({ error: 'Procedimento não encontrado.' });

    const { valor } = req.body;
    if (valor === null || valor === undefined || valor === '' || Number(valor) === 0) {
      await prisma.procedimentoValorEmpresa.deleteMany({ where: { empresaId: req.empresaId, procedimentoId } });
      return res.json({ dados: { procedimentoId, valorEmpresa: null } });
    }

    const v = Number(valor);
    if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: 'Valor inválido.' });

    const row = await prisma.procedimentoValorEmpresa.upsert({
      where:  { empresaId_procedimentoId: { empresaId: req.empresaId, procedimentoId } },
      create: { empresaId: req.empresaId, procedimentoId, valor: v },
      update: { valor: v },
    });
    return res.json({ dados: { procedimentoId, valorEmpresa: row.valor } });
  } catch (err) {
    console.error('ProcedimentoCadastroController.definirValor:', err);
    return res.status(500).json({ error: 'Erro ao definir valor do procedimento.' });
  }
};

const COMBO_INCLUDE = {
  itens: {
    include: {
      procedimento: { select: { id: true, nome: true, categoria: true, especialidade: true, valorVenda: true } },
    },
  },
};

// GET /api/procedimentos/cadastro/combos — combos ativos da empresa ativa
const listarCombos = async (req, res) => {
  try {
    if (!req.empresaId) return res.json({ dados: [] });
    let combos = await prisma.procedimentoCombo.findMany({
      where:   { empresaId: req.empresaId, ativo: true },
      include: COMBO_INCLUDE,
      orderBy: { nome: 'asc' },
    });

    // Só combos cujos itens são TODOS de especialidades que a empresa atende.
    const permitidas = await nomesEspecialidadesPermitidas(req);
    if (permitidas) {
      combos = combos.filter(c => c.itens.every(it => permitidas.has(it.procedimento.especialidade)));
    }

    return res.json({ dados: combos });
  } catch (err) {
    console.error('ProcedimentoCadastroController.listarCombos:', err);
    return res.status(500).json({ error: 'Erro ao listar combos.' });
  }
};

function validarComboBody(body) {
  const nome          = body?.nome?.trim();
  const valor         = Number(body?.valor);
  const especialidade = body?.especialidade?.trim();
  const ids           = Array.isArray(body?.procedimentoIds)
    ? [...new Set(body.procedimentoIds.map(Number).filter(Number.isInteger))]
    : [];
  if (!nome)                          return { erro: 'Nome do combo é obrigatório.' };
  if (!especialidade)                 return { erro: 'Selecione a especialidade do combo.' };
  if (!Number.isFinite(valor) || valor <= 0) return { erro: 'Informe o valor do combo (maior que zero).' };
  if (ids.length < 2)                 return { erro: 'Um combo precisa de pelo menos 2 procedimentos.' };
  return { nome, valor, ids, especialidade, descricao: body?.descricao?.trim() || null };
}

// Verifica que todos os procedimentos existem, estão ativos e são da especialidade do combo.
async function validarProcedimentosDoCombo(ids, especialidade) {
  const procs = await prisma.procedimentoVeterinario.findMany({
    where:  { id: { in: ids }, ativo: true },
    select: { id: true, especialidade: true },
  });
  if (procs.length !== ids.length) return 'Procedimento inválido no combo.';
  const alvo = especialidade.trim().toLowerCase();
  const foraDaEspecialidade = procs.some(p => (p.especialidade ?? '').trim().toLowerCase() !== alvo);
  if (foraDaEspecialidade) return `Todos os procedimentos do combo devem ser da especialidade "${especialidade}".`;
  return null;
}

// POST /api/procedimentos/cadastro/combos — GESTOR
const criarCombo = async (req, res) => {
  try {
    if (!req.empresaId) return res.status(400).json({ error: 'Contexto de empresa não resolvido.' });
    if (!(await isGestorDaEmpresa(req.user.id, req.empresaId))) {
      return res.status(403).json({ error: 'Somente o gestor da empresa cria combos de procedimentos.' });
    }

    const v = validarComboBody(req.body);
    if (v.erro) return res.status(400).json({ error: v.erro });

    const erroProcs = await validarProcedimentosDoCombo(v.ids, v.especialidade);
    if (erroProcs) return res.status(400).json({ error: erroProcs });

    const combo = await prisma.procedimentoCombo.create({
      data: {
        empresaId:     req.empresaId,
        nome:          v.nome,
        descricao:     v.descricao,
        especialidade: v.especialidade,
        valor:         v.valor,
        itens:         { create: v.ids.map(id => ({ procedimentoId: id })) },
      },
      include: COMBO_INCLUDE,
    });
    return res.status(201).json({ dados: combo });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Já existe um combo com esse nome.' });
    console.error('ProcedimentoCadastroController.criarCombo:', err);
    return res.status(500).json({ error: 'Erro ao criar combo.' });
  }
};

// PUT /api/procedimentos/cadastro/combos/:id — GESTOR
const atualizarCombo = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!(await isGestorDaEmpresa(req.user.id, req.empresaId))) {
      return res.status(403).json({ error: 'Somente o gestor da empresa altera combos.' });
    }
    const combo = await prisma.procedimentoCombo.findFirst({ where: { id, empresaId: req.empresaId, ativo: true } });
    if (!combo) return res.status(404).json({ error: 'Combo não encontrado.' });

    const v = validarComboBody(req.body);
    if (v.erro) return res.status(400).json({ error: v.erro });

    const erroProcs = await validarProcedimentosDoCombo(v.ids, v.especialidade);
    if (erroProcs) return res.status(400).json({ error: erroProcs });

    const atualizado = await prisma.$transaction(async (tx) => {
      await tx.procedimentoComboItem.deleteMany({ where: { comboId: id } });
      return tx.procedimentoCombo.update({
        where: { id },
        data: {
          nome:          v.nome,
          descricao:     v.descricao,
          especialidade: v.especialidade,
          valor:         v.valor,
          itens:         { create: v.ids.map(pid => ({ procedimentoId: pid })) },
        },
        include: COMBO_INCLUDE,
      });
    });
    return res.json({ dados: atualizado });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Já existe um combo com esse nome.' });
    console.error('ProcedimentoCadastroController.atualizarCombo:', err);
    return res.status(500).json({ error: 'Erro ao atualizar combo.' });
  }
};

// DELETE /api/procedimentos/cadastro/combos/:id — GESTOR; motivo obrigatório (auditoria)
const excluirCombo = async (req, res) => {
  try {
    const id     = Number(req.params.id);
    const motivo = req.body?.motivo?.trim();
    if (!motivo) return res.status(400).json({ error: 'É obrigatório informar o motivo da exclusão' });
    if (!(await isGestorDaEmpresa(req.user.id, req.empresaId))) {
      return res.status(403).json({ error: 'Somente o gestor da empresa exclui combos.' });
    }
    const combo = await prisma.procedimentoCombo.findFirst({ where: { id, empresaId: req.empresaId, ativo: true } });
    if (!combo) return res.status(404).json({ error: 'Combo não encontrado.' });

    await prisma.$transaction(async (tx) => {
      await tx.procedimentoCombo.update({ where: { id }, data: { ativo: false } });
      await registrarAuditoria(tx, req, {
        categoria:  'EXCLUSAO',
        entidade:   'PROCEDIMENTO_COMBO',
        entidadeId: id,
        motivo,
        detalhes:   `Combo "${combo.nome}" excluído (soft delete)`,
      });
    });
    return res.json({ dados: { message: 'Combo excluído.' } });
  } catch (err) {
    console.error('ProcedimentoCadastroController.excluirCombo:', err);
    return res.status(500).json({ error: 'Erro ao excluir combo.' });
  }
};

module.exports = {
  especialidadesMinhas,
  listarComValores,
  definirValor,
  listarCombos,
  criarCombo,
  atualizarCombo,
  excluirCombo,
};
