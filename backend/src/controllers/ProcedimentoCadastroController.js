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
const vinculoPrestador = require('../lib/procedimentoPrestador');
// FONTE ÚNICA da criação de procedimento DA EMPRESA — o mesmo helper que a Prescrição
// e o Orçamento usam quando alguém digita um procedimento que não está no catálogo.
const { garantirProcedimentoDaEmpresa } = require('../lib/catalogoManual');
const {
  CATEGORIAS_IMAGEM, TIPO_IMAGEM, ESPECIALIDADE_IMAGEM,
} = require('../seeds/005_procedimentos_imagem.seed');

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

    // CATÁLOGO COMPLETO PARA TODOS (decisão de 2026-07-30). Antes, quem não era gestor
    // via apenas as especialidades do PRÓPRIO vínculo — restrição fixa no código, que a
    // matriz do Controle de Acesso não oferece configurar (é binária, ver 28-c) e que na
    // prática impedia de orçar: todo item do orçamento exige especialidade, e 19 dos 39
    // vínculos não-gestores da base não tinham nenhuma vinculada — lista vazia, nada a
    // adicionar. Pior: enfermeiro, secretaria e financeiro NÃO TÊM especialidade por
    // regra (seção 15), então jamais conseguiriam montar um orçamento.
    // Agora quem decide é a matriz: quem tem a ação de criar orçamento escolhe qualquer
    // especialidade que a EMPRESA atenda.
    const rows = await prisma.especialidade.findMany({
      where: { ativo: true }, select: { nome: true }, orderBy: { nome: 'asc' },
    });
    let nomes = rows.map(r => r.nome);

    // Restringe às especialidades que a empresa efetivamente atende (Configurações /
    // espécies do dono) — vale tanto para gestor quanto para membro comum.
    if (permitidas) nomes = nomes.filter(n => permitidas.has(n));

    // 🔴 'Diagnóstico por Imagem' SAI do seletor (pedido de 2026-09-09). No lugar dela
    // entram as CATEGORIAS de imagem (Radiografia, Ultrassonografia, Endoscopia…), que
    // é como o exame de imagem se organiza na prática.
    // ⚠️ Ela continua existindo em `tb_especialidades` e no DADO do procedimento — o
    // que muda é só o que a tela OFERECE. Removê-la do catálogo quebraria a Agenda e o
    // cadastro de membro de quem já a tem vinculada.
    nomes = nomes.filter(n => n !== ESPECIALIDADE_IMAGEM);

    return res.json({
      dados: [...new Set(nomes)],
      imagemCategorias: CATEGORIAS_IMAGEM,
      gestor,
    });
  } catch (err) {
    console.error('ProcedimentoCadastroController.especialidadesMinhas:', err);
    return res.status(500).json({ error: 'Erro ao listar especialidades.' });
  }
};

// GET /api/procedimentos/cadastro/lista?especialidade=NOME&busca=&especie=NOME
// Procedimentos ativos da especialidade + valor da empresa ativa (quando houver).
const listarComValores = async (req, res) => {
  try {
    const { especialidade, busca, especie, imagemCategoria, codigos, ativo } = req.query;
    const where = {};

    /**
     * 🔴 SITUAÇÃO — o DEFAULT É `ativo: true` e não deve mudar.
     *
     * Este MESMO endpoint alimenta os seletores de procedimento do ORÇAMENTO e da
     * PRESCRIÇÃO (ver o comentário das rotas), que jamais podem oferecer algo que a
     * clínica inativou. Quem manda 'all'/'false' é só a tela de Cadastro, que precisa
     * alcançar o inativo para poder reativá-lo — sem isso, inativar vira caminho sem volta.
     */
    if (ativo === 'all')        { /* sem recorte por situação */ }
    else if (ativo === 'false') { where.ativo = false; }
    else                        { where.ativo = true; }

    /**
     * 🔴 RECORTE POR CÓDIGO (2026-09-11) — a tela de exames manda para cá os exames
     * que o prestador escolhido AINDA NÃO tem valor cadastrado, e a lista abre só com
     * eles. Sem isso o gestor cairia numa categoria de 56 radiografias para achar as
     * 3 que faltam.
     *
     * ⚠️ Por CÓDIGO, não por id: é a chave estável do catálogo (PR-0302…), a mesma que
     * o seed usa. Id de procedimento global muda entre bases; código, não.
     * ⚠️ Teto de 200: a lista vem da URL e um `in` sem limite é um vetor de consulta
     * cara aberto ao cliente.
     */
    const listaCodigos = String(codigos ?? '')
      .split(',').map(c => c.trim()).filter(Boolean).slice(0, 200);
    if (listaCodigos.length > 0) where.codigo = { in: listaCodigos };
    // Exame de imagem é recortado pela CATEGORIA (Radiografia, Ultrassonografia…), não
    // pela especialidade — que saiu do seletor. Os dois filtros são excludentes: quem
    // escolheu uma categoria de imagem não quer procedimento clínico junto.
    const imgCat = imagemCategoria ? String(imagemCategoria).trim() : '';
    if (imgCat) {
      where.tipoProcedimento = TIPO_IMAGEM;
      where.categoria = { equals: imgCat, mode: 'insensitive' };
    } else if (especialidade) {
      where.especialidade = { equals: String(especialidade), mode: 'insensitive' };
    }
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
        empresaId: true, ativo: true,
      },
    });

    // Filtros por especialidade/espécie que a empresa atende — procedimento PRÓPRIO da
    // empresa (empresaId setado) sempre aparece, independente desses filtros.
    const permitidas      = await nomesEspecialidadesPermitidas(req);
    const especiesEmpresa = await nomesEspeciesDaEmpresa(req);
    procedimentos = procedimentos.filter(p => {
      if (p.empresaId && p.empresaId === req.empresaId) return true;
      // ⚠️ Exame de imagem NÃO passa pelo filtro de especialidades atendidas: quem o
      // governa é a categoria, e a especialidade dele ('Diagnóstico por Imagem') pode
      // não estar entre as da empresa — o que esconderia os 119 exames sem explicação.
      // O filtro por ESPÉCIE, logo abaixo, continua valendo para ele.
      if (p.tipoProcedimento !== TIPO_IMAGEM) {
        if (permitidas && !permitidas.has(p.especialidade)) return false;
      }
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

    // Vínculos de PRESTADOR do procedimento (Nome do Prestador + Valor Cobrado pelo
    // Prestador). Uma linha por prestador na tela — é o que permite dois ferradores
    // no MESMO ferrageamento com valores e comissionamentos diferentes.
    // ⚠️ Vem em bloco (uma consulta para a página inteira), nunca por procedimento:
    // a lista tem centenas de linhas e uma ida ao banco por linha derrubaria a tela.
    const vinculos = await vinculoPrestador.vinculosPorProcedimento(
      req.empresaId, procedimentos.map(p => p.id), { incluirInativos: true },
    );

    return res.json({
      dados: procedimentos.map(p => ({
        ...p,
        /**
         * `daEmpresa: false` = linha GLOBAL do catálogo, que vale para TODAS as
         * clínicas. A tela usa isto para NÃO oferecer inativar nem renomear o item do
         * sistema — mesma regra (e mesma razão) de `ProdutoController`: a policy de
         * `tb_procedimentos_vet` LÊ global + próprio mas só ESCREVE o próprio, então
         * o botão só falharia depois do clique (armadilha 28-d).
         */
        daEmpresa:    p.empresaId != null,
        valorEmpresa: valores.get(p.id) ?? null,
        prestadores:  vinculos.get(p.id) ?? [],
      })),
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

// GET /api/procedimentos/cadastro/combos?ativo=all|true|false — combos da empresa
// ativa. `ativo` default 'true': os consumidores clínicos (Orçamento, Prescrição)
// não mandam o parâmetro, então continuam vendo só combos ativos; só a tela de
// Cadastro > Procedimentos manda `all`/`false` para gerir os inativados.
const listarCombos = async (req, res) => {
  try {
    if (!req.empresaId) return res.json({ dados: [] });
    const { ativo } = req.query;
    const where = { empresaId: req.empresaId };
    if (ativo === 'all') { /* sem filtro */ }
    else if (ativo !== undefined) where.ativo = ativo === 'true';
    else where.ativo = true;

    let combos = await prisma.procedimentoCombo.findMany({
      where,
      include: COMBO_INCLUDE,
      orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
    });

    // Só combos cujos itens são TODOS de especialidades que a empresa atende.
    const permitidas = await nomesEspecialidadesPermitidas(req);
    if (permitidas) {
      combos = combos.filter(c => c.itens.every(it => permitidas.has(it.procedimento.especialidade)));
    }

    // Prestador e valor do prestador do PACOTE (colunas novas → SQL cru).
    //
    // 🔴 `recursos.comboPrestador` diz se as colunas EXISTEM nesta base. Sem ele, a tela
    // ofereceria o seletor de prestador do combo e a escolha desapareceria no salvar —
    // falha SILENCIOSA, que é o pior resultado possível. Com a bandeira, a tela troca os
    // campos por um aviso dizendo que falta aplicar a migration.
    return res.json({
      dados:    await vinculoPrestador.anexarPrestadorEmCombos(prisma, combos),
      recursos: { comboPrestador: await vinculoPrestador.temColunasCombo() },
    });
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

  // PRESTADOR do pacote (2026-09-10) — OPCIONAL: combo executado pela própria equipe
  // não tem prestador, e exigi-lo travaria a configuração por causa de um cadastro que
  // talvez nem exista. `valor` continua sendo o VALOR CLIENTE (só o rótulo mudou).
  const prestadorId = body?.prestadorId === '' || body?.prestadorId === null || body?.prestadorId === undefined
    ? null
    : Number(body.prestadorId);
  if (prestadorId !== null && !Number.isInteger(prestadorId)) {
    return { erro: 'Prestador inválido.' };
  }
  const vpBruto = body?.valorPrestador;
  const valorPrestador = vpBruto === '' || vpBruto === null || vpBruto === undefined ? null : Number(vpBruto);
  if (valorPrestador !== null && !(Number.isFinite(valorPrestador) && valorPrestador >= 0)) {
    return { erro: 'Valor do prestador inválido.' };
  }

  return {
    nome, valor, ids, especialidade, prestadorId, valorPrestador,
    descricao: body?.descricao?.trim() || null,
  };
}

/**
 * Verifica que todos os procedimentos existem e estão ativos.
 *
 * ⚠️ O combo ACEITA procedimentos de especialidades DIFERENTES (2026-08-04). A trava
 * "todos têm de ser da especialidade X" foi removida: pacote real mistura áreas — uma
 * castração leva itens de Clínica Médica e de Anestesiologia —, e com a regra antiga a
 * clínica precisava criar dois combos e somá-los à mão no orçamento.
 * `Combo.especialidade` CONTINUA existindo e obrigatório: é a CLASSIFICAÇÃO do pacote
 * (badge do card e filtro do Orçamento, `combosDaEsp` em Orcamento.tsx), não mais um
 * critério de composição.
 */
async function validarProcedimentosDoCombo(ids) {
  const procs = await prisma.procedimentoVeterinario.findMany({
    where:  { id: { in: ids }, ativo: true },
    select: { id: true },
  });
  if (procs.length !== ids.length) return 'Procedimento inválido no combo.';
  return null;
}

/**
 * O prestador do combo tem de ser DESTA empresa. Sem a conferência, um id de outra
 * clínica ficaria gravado no pacote e iria ao recibo errado — o RLS não cruza tabelas,
 * então a policy de `tb_procedimento_combos` não protege contra isso.
 * `null` (sem prestador) é válido: combo executado pela própria equipe.
 */
async function prestadorDoComboInvalido(prestadorId, empresaId) {
  if (prestadorId === null || prestadorId === undefined) return null;
  const p = await prisma.prestador.findFirst({
    where: { id: Number(prestadorId), empresaId }, select: { id: true },
  });
  return p ? null : 'Prestador não encontrado nesta empresa.';
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

    const erroProcs = await validarProcedimentosDoCombo(v.ids);
    if (erroProcs) return res.status(400).json({ error: erroProcs });

    const erroPrest = await prestadorDoComboInvalido(v.prestadorId, req.empresaId);
    if (erroPrest) return res.status(404).json({ error: erroPrest });

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
    // Colunas novas por SQL cru (o client pode não conhecê-las) — fora do `create`
    // porque um campo desconhecido no `data` derrubaria a criação do combo inteira.
    await vinculoPrestador.gravarPrestadorDoCombo(prisma, combo.id, {
      prestadorId: v.prestadorId, valorPrestador: v.valorPrestador,
    });
    return res.status(201).json({
      dados: await vinculoPrestador.anexarPrestadorEmCombos(prisma, combo),
    });
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

    const erroProcs = await validarProcedimentosDoCombo(v.ids);
    if (erroProcs) return res.status(400).json({ error: erroProcs });

    const erroPrest = await prestadorDoComboInvalido(v.prestadorId, req.empresaId);
    if (erroPrest) return res.status(404).json({ error: erroPrest });

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
    await vinculoPrestador.gravarPrestadorDoCombo(prisma, id, {
      prestadorId: v.prestadorId, valorPrestador: v.valorPrestador,
    });
    return res.json({
      dados: await vinculoPrestador.anexarPrestadorEmCombos(prisma, atualizado),
    });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Já existe um combo com esse nome.' });
    console.error('ProcedimentoCadastroController.atualizarCombo:', err);
    return res.status(500).json({ error: 'Erro ao atualizar combo.' });
  }
};

// PATCH /api/procedimentos/cadastro/combos/:id/toggle — GESTOR; motivo obrigatório
// (auditoria). Alterna ativo↔inativo — combo inativo some de Orçamento/Prescrição
// (listarCombos filtra ativo:true por padrão) mas continua alcançável nesta tela
// pela aba Inativos/Todos, com o botão revertendo a ação.
const toggleCombo = async (req, res) => {
  try {
    const id     = Number(req.params.id);
    const motivo = req.body?.motivo?.trim();
    if (!motivo) return res.status(400).json({ error: 'É obrigatório informar o motivo' });
    if (!(await isGestorDaEmpresa(req.user.id, req.empresaId))) {
      return res.status(403).json({ error: 'Somente o gestor da empresa altera o status de combos.' });
    }
    const combo = await prisma.procedimentoCombo.findFirst({ where: { id, empresaId: req.empresaId } });
    if (!combo) return res.status(404).json({ error: 'Combo não encontrado.' });

    const vaiInativar = combo.ativo;
    const atualizado = await prisma.$transaction(async (tx) => {
      const novo = await tx.procedimentoCombo.update({
        where:   { id },
        data:    { ativo: !combo.ativo },
        include: COMBO_INCLUDE,
      });
      await registrarAuditoria(tx, req, {
        // (In)ativar não é editar um campo — ver EstoqueController.toggle.
        categoria:  vaiInativar ? 'INATIVACAO' : 'ATIVACAO',
        entidade:   'PROCEDIMENTO_COMBO',
        entidadeId: id,
        motivo,
        detalhes:   `Combo "${combo.nome}" ${vaiInativar ? 'inativado' : 'ativado'}`,
      });
      return novo;
    });
    return res.json({ dados: atualizado, mensagem: vaiInativar ? 'Combo inativado.' : 'Combo ativado.' });
  } catch (err) {
    console.error('ProcedimentoCadastroController.toggleCombo:', err);
    return res.status(500).json({ error: 'Erro ao alterar status do combo.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PRESTADOR × PROCEDIMENTO (Cadastro > Procedimentos)
// ─────────────────────────────────────────────────────────────────────────────
// Regra de negócio nova (2026-09-08): a MESMA empresa pode ter vários prestadores
// executando o MESMO procedimento, cada um com o seu "Valor Cobrado para o Cliente"
// e o seu "Valor Cobrado pelo Prestador". `ProcedimentoValorEmpresa` (o valor único
// por procedimento) continua existindo como PADRÃO — o que vale quando quem executa
// é a própria equipe.

// GET /api/procedimentos/cadastro/prestadores
// Prestadores ATIVOS da empresa, para o seletor do vínculo e o da prescrição.
// ⚠️ Escopado por `req.empresaId` — `tb_prestadores` é TENANT DIRETO sob RLS, então
// a policy já recusaria linha de outra clínica; o filtro explícito é o que faz a
// resposta ser a mesma com e sem o carimbo (ADMIN de plataforma incluído).
const listarPrestadoresDaEmpresa = async (req, res) => {
  try {
    if (!req.empresaId) return res.json({ dados: [] });
    const prestadores = await prisma.prestador.findMany({
      where:   { empresaId: req.empresaId, ativo: true },
      // Forma de pagamento vem junto: é ela que a tela usa para explicar de onde sai o
      // valor do recibo (% sobre o cliente, valor fixo, ou o valor do procedimento).
      select: {
        id: true, nome: true, tipoServico: true,
        tipoPagamento: true, formaPagamento: true, valorPagamento: true,
      },
      orderBy: { nome: 'asc' },
    });
    return res.json({ dados: prestadores });
  } catch (err) {
    console.error('ProcedimentoCadastroController.listarPrestadoresDaEmpresa:', err);
    return res.status(500).json({ error: 'Erro ao listar prestadores.' });
  }
};

// PUT /api/procedimentos/cadastro/prestador/:procedimentoId  — GESTOR
// { prestadorId, valorCliente?, valorPrestador?, ativo? }
// Cria ou atualiza o vínculo. Idempotente por (empresa, procedimento, prestador).
// ⚠️ `valorCliente: null` APAGA o valor do vínculo e devolve o procedimento ao valor
// padrão da empresa — não é o mesmo que "não mandou o campo" (que mantém o gravado).
const definirPrestador = async (req, res) => {
  try {
    if (!req.empresaId) return res.status(400).json({ error: 'Contexto de empresa não resolvido.' });
    if (!(await isGestorDaEmpresa(req.user.id, req.empresaId))) {
      return res.status(403).json({ error: 'Somente o gestor da empresa define prestadores e valores de procedimento.' });
    }
    const procedimentoId = Number(req.params.procedimentoId);
    const proc = await prisma.procedimentoVeterinario.findUnique({
      where: { id: procedimentoId }, select: { id: true, nome: true },
    });
    if (!proc) return res.status(404).json({ error: 'Procedimento não encontrado.' });

    const prestadorId = Number(req.body?.prestadorId);
    if (!Number.isInteger(prestadorId)) return res.status(400).json({ error: 'Selecione o prestador.' });
    // Prestador tem de ser DESTA empresa: sem a checagem, um id de outra clínica
    // criaria um vínculo que a tela dela nunca mostraria e que iria ao recibo errado.
    const prestador = await prisma.prestador.findFirst({
      where: { id: prestadorId, empresaId: req.empresaId }, select: { id: true, nome: true },
    });
    if (!prestador) return res.status(404).json({ error: 'Prestador não encontrado nesta empresa.' });

    const { erro, id } = await vinculoPrestador.salvarVinculo(prisma, {
      empresaId:      req.empresaId,
      procedimentoId,
      prestadorId,
      valorCliente:   req.body?.valorCliente,
      valorPrestador: req.body?.valorPrestador,
      ativo:          req.body?.ativo,
    });
    if (erro) return res.status(400).json({ error: erro });

    const mapa = await vinculoPrestador.vinculosPorProcedimento(
      req.empresaId, [procedimentoId], { incluirInativos: true },
    );
    return res.json({ dados: { procedimentoId, id, prestadores: mapa.get(procedimentoId) ?? [] } });
  } catch (err) {
    console.error('ProcedimentoCadastroController.definirPrestador:', err);
    return res.status(500).json({ error: 'Erro ao salvar o prestador do procedimento.' });
  }
};

// DELETE /api/procedimentos/cadastro/prestador/:procedimentoId/:vinculoId — GESTOR
// Hard delete: é configuração de PREÇO, não registro clínico. O que já foi executado
// está no ledger do recibo (`tb_execucoes_procedimento_prestador`), que é snapshot e
// não depende do vínculo continuar existindo.
const removerPrestador = async (req, res) => {
  try {
    if (!req.empresaId) return res.status(400).json({ error: 'Contexto de empresa não resolvido.' });
    if (!(await isGestorDaEmpresa(req.user.id, req.empresaId))) {
      return res.status(403).json({ error: 'Somente o gestor da empresa remove prestadores de procedimento.' });
    }
    const procedimentoId = Number(req.params.procedimentoId);
    await vinculoPrestador.removerVinculo(prisma, req.empresaId, Number(req.params.vinculoId));
    const mapa = await vinculoPrestador.vinculosPorProcedimento(
      req.empresaId, [procedimentoId], { incluirInativos: true },
    );
    return res.json({ dados: { procedimentoId, prestadores: mapa.get(procedimentoId) ?? [] } });
  } catch (err) {
    console.error('ProcedimentoCadastroController.removerPrestador:', err);
    return res.status(500).json({ error: 'Erro ao remover o prestador do procedimento.' });
  }
};

// GET /api/procedimentos/cadastro/prestadores-do-procedimento?nome=NOME
// Prestadores que executam o procedimento — seletor da tela de PRESCRIÇÃO, onde o
// item guarda só o NOME (não há FK para o catálogo).
const prestadoresDoProcedimento = async (req, res) => {
  try {
    if (!req.empresaId) return res.json({ dados: [], todos: [] });
    const nome = String(req.query.nome ?? '').trim();
    const vinculados = nome
      ? await vinculoPrestador.prestadoresDoProcedimentoPorNome(req.empresaId, nome)
      : [];
    // A lista COMPLETA vai junto: o vínculo é configuração do gestor e pode não
    // existir ainda, e travar a prescrição por causa disso pararia o atendimento.
    // A tela mostra os vinculados no topo e o resto abaixo, com aviso de "sem valor
    // cadastrado" — quem decide é quem está atendendo.
    const todos = await prisma.prestador.findMany({
      where:  { empresaId: req.empresaId, ativo: true },
      select: {
        id: true, nome: true, tipoServico: true,
        tipoPagamento: true, formaPagamento: true, valorPagamento: true,
      },
      orderBy: { nome: 'asc' },
    });
    return res.json({ dados: vinculados, todos });
  } catch (err) {
    console.error('ProcedimentoCadastroController.prestadoresDoProcedimento:', err);
    return res.status(500).json({ error: 'Erro ao listar prestadores do procedimento.' });
  }
};

/**
 * "Categoria" DA TELA × as duas colunas do banco.
 *
 * 🔴 A tela de Cadastro > Procedimentos chama de CATEGORIA o que o banco guarda em
 * DUAS colunas diferentes, conforme a natureza do item (o rótulo mudou em 2026-09-22;
 * antes era "Especialidade / Exame de imagem"):
 *   • procedimento clínico  → `especialidade` ('Clínica Médica', 'Ortopedia'…)
 *   • exame de imagem       → `tipoProcedimento = 'IMAGEM'` + `categoria`
 *     ('Radiografia', 'Ultrassonografia'…), que é como `listarComValores` recorta
 *     essa família desde 2026-09-09.
 *
 * ⚠️ Sem este desvio, cadastrar "Radiografia de carpo" escolhendo Radiografia gravaria
 * `especialidade = 'Radiografia'` — e o item NASCERIA INVISÍVEL na própria lista em
 * que acabou de ser criado, porque aquela lista filtra imagem por categoria, nunca por
 * especialidade.
 *
 * @param {string} categoriaDaTela
 * @returns {{especialidade: string|null, categoria: string|null, tipoProcedimento: string|null}}
 */
function camposDaCategoria(categoriaDaTela) {
  const c = String(categoriaDaTela ?? '').trim();
  if (!c) return { especialidade: null, categoria: null, tipoProcedimento: null };

  const daImagem = CATEGORIAS_IMAGEM.find(x => x.toLowerCase() === c.toLowerCase());
  if (daImagem) {
    return { especialidade: ESPECIALIDADE_IMAGEM, categoria: daImagem, tipoProcedimento: TIPO_IMAGEM };
  }
  return { especialidade: c, categoria: null, tipoProcedimento: null };
}

/**
 * Grava/remove o VALOR da empresa para o procedimento (o "Valor" da tela).
 *
 * ⚠️ `tb_procedimento_valores_empresa` é TENANT DIRETO: a linha nasce com o
 * `empresa_id` do contexto e o RLS recusa qualquer outro. É por ISSO que o valor não
 * mora em `tb_procedimentos_vet` — ali a linha pode ser GLOBAL, e o preço de uma
 * clínica viraria o preço de todas.
 * ⚠️ Vazio/zero REMOVE a linha em vez de gravar 0: "sem valor definido" e "de graça"
 * são coisas diferentes, e é a ausência que faz a tela cair no valor de referência.
 */
async function gravarValorDaEmpresa(tx, empresaId, procedimentoId, valor) {
  if (valor === null || valor === undefined || valor === '' || Number(valor) === 0) {
    await tx.procedimentoValorEmpresa.deleteMany({ where: { empresaId, procedimentoId } });
    return null;
  }
  const v = Number(valor);
  if (!Number.isFinite(v) || v < 0) throw Object.assign(new Error('Valor inválido.'), { status: 400 });

  const row = await tx.procedimentoValorEmpresa.upsert({
    where:  { empresaId_procedimentoId: { empresaId, procedimentoId } },
    create: { empresaId, procedimentoId, valor: v },
    update: { valor: v },
  });
  return row.valor;
}

/** O procedimento no escopo VISÍVEL da empresa: o global + o próprio dela. */
function procedimentoVisivel(empresaId, id) {
  return { id, OR: [{ empresaId: null }, ...(empresaId ? [{ empresaId: Number(empresaId) }] : [])] };
}

/**
 * POST /api/procedimentos/cadastro/proprio  { nome, categoria?, valor? }
 *
 * 🔴 CRIA O PROCEDIMENTO DA CLÍNICA. Desde 2026-09-22 quem o chama é o botão
 * **Novo Procedimento** da tela, com os três campos que o usuário pediu — Categoria,
 * Procedimento e Valor.
 *
 * ⚠️ SUBSTITUI o cadastro-ao-digitar-na-busca de 2026-09-18 ("Cadastrar «X»"), retirado
 * a pedido: criar o registro como efeito colateral de uma BUSCA fazia erro de digitação
 * virar cadastro, e não havia onde informar categoria nem valor — o item nascia com o
 * carimbo genérico e preço zerado, para alguém corrigir depois.
 *
 * ⚠️ NÃO é o `POST /procedimentos` do catálogo, que é ADMIN-ONLY e escreve a linha
 * GLOBAL, válida para TODAS as clínicas. Aqui nasce a linha DA EMPRESA
 * (`garantirProcedimentoDaEmpresa`, o MESMO helper que a Prescrição e o Orçamento já
 * usavam quando alguém digita um procedimento à mão). Uma cópia própria da criação
 * divergiria dele — e o que divergiria é o escopo do que nasce: global × da clínica.
 *
 * ⚠️ IDEMPOTENTE por (nome, empresa), sem diferenciar maiúsculas: o helper devolve o
 * id do que já existe em vez de criar a segunda linha. É isso que impede "Ferrageamento"
 * e "ferrageamento" virarem dois procedimentos com preços diferentes. O VALOR informado
 * é aplicado de todo jeito — ele é da EMPRESA e não pertence à linha reaproveitada.
 */
const criarProprio = async (req, res) => {
  try {
    if (!req.empresaId) return res.status(400).json({ error: 'Selecione a empresa.' });
    const nome = String(req.body?.nome ?? '').trim();
    if (nome.length < 2) return res.status(400).json({ error: 'Informe o nome do procedimento.' });

    // `especialidade` continua aceito pelo nome antigo: o campo só foi RENOMEADO na
    // tela, e um cliente que ainda mande o nome velho não pode parar de funcionar.
    const campos = camposDaCategoria(req.body?.categoria ?? req.body?.especialidade);
    if (!campos.especialidade) return res.status(400).json({ error: 'Selecione a categoria do procedimento.' });

    const { id, criado, valorEmpresa } = await prisma.$transaction(async (tx) => {
      const antes = await tx.procedimentoVeterinario.findFirst({
        where:  { ativo: true, nome: { equals: nome, mode: 'insensitive' },
                  OR: [{ empresaId: null }, { empresaId: req.empresaId }] },
        select: { id: true },
      });
      const novoId = await garantirProcedimentoDaEmpresa(tx, { nome, ...campos }, req.empresaId);
      if (!novoId) return { id: null, criado: false, valorEmpresa: null };

      const valor = await gravarValorDaEmpresa(tx, req.empresaId, novoId, req.body?.valor);

      await registrarAuditoria(tx, req, {
        categoria: antes ? 'ALTERACAO' : 'CRIACAO', entidade: 'PROCEDIMENTO', entidadeId: novoId,
        detalhes:  antes
          ? `Procedimento "${nome}" já existia — valor da clínica atualizado`
          : `Procedimento "${nome}" cadastrado pela clínica`,
      });
      return { id: novoId, criado: !antes, valorEmpresa: valor };
    });

    if (!id) return res.status(400).json({ error: 'Não foi possível cadastrar o procedimento.' });

    const dados = await prisma.procedimentoVeterinario.findUnique({
      where:  { id },
      select: { id: true, nome: true, categoria: true, especialidade: true, tipoProcedimento: true,
                valorVenda: true, empresaId: true, ativo: true },
    });
    return res.status(criado ? 201 : 200).json({
      dados: { ...dados, daEmpresa: dados?.empresaId != null, valorEmpresa }, criado,
    });
  } catch (err) {
    if (err?.status === 400) return res.status(400).json({ error: err.message });
    console.error('ProcedimentoCadastroController.criarProprio:', err);
    return res.status(500).json({ error: 'Erro ao cadastrar o procedimento.' });
  }
};

/**
 * PUT /api/procedimentos/cadastro/proprio/:id  { nome?, categoria?, valor? }
 *
 * ALTERAR no mesmo formato de Produtos (2026-09-22): o lápis abre o formulário com os
 * três campos e grava.
 *
 * 🔴 O QUE A CLÍNICA PODE ALTERAR DEPENDE DE QUEM É A LINHA:
 *   • procedimento DELA (`empresa_id` setado) → nome, categoria e valor;
 *   • linha GLOBAL (`empresa_id IS NULL`)     → SÓ O VALOR.
 * O valor é da empresa por construção (tabela à parte), então alterá-lo num item do
 * sistema não toca em clínica nenhuma. Renomeá-lo, sim — e o RLS recusaria a escrita
 * de qualquer forma (o `WITH CHECK` da policy só aceita `empresa_id = app_empresa_id()`),
 * o que viraria um 500 sem explicação no lugar de uma recusa legível.
 *
 * ⚠️ A tela desabilita nome/categoria no item do sistema (selo "do sistema"), então
 * este 400 é a rede de segurança, não o caminho normal — mas ele PRECISA existir:
 * campo desabilitado não é autorização.
 */
const atualizarProprio = async (req, res) => {
  try {
    if (!req.empresaId) return res.status(400).json({ error: 'Selecione a empresa.' });
    const id = Number(req.params.id);

    const atual = await prisma.procedimentoVeterinario.findFirst({
      where:  procedimentoVisivel(req.empresaId, id),
      select: { id: true, nome: true, empresaId: true, especialidade: true, categoria: true },
    });
    // Procedimento privado de outra clínica responde 404 — não confirma que existe.
    if (!atual) return res.status(404).json({ error: 'Procedimento não encontrado.' });

    const daEmpresa = atual.empresaId != null;
    const nome   = req.body?.nome !== undefined ? String(req.body.nome).trim() : null;
    const campos = (req.body?.categoria !== undefined || req.body?.especialidade !== undefined)
      ? camposDaCategoria(req.body?.categoria ?? req.body?.especialidade)
      : null;

    if (!daEmpresa) {
      const mudouNome = nome !== null && nome.toLowerCase() !== atual.nome.toLowerCase();
      const mudouCat  = campos !== null && campos.especialidade !== atual.especialidade;
      if (mudouNome || mudouCat) {
        return res.status(400).json({
          error: 'Este procedimento é do catálogo do sistema e vale para todas as clínicas — aqui só o valor pode ser alterado.',
          code:  'ITEM_DO_SISTEMA',
        });
      }
    }
    if (daEmpresa && nome !== null && nome.length < 2) {
      return res.status(400).json({ error: 'Informe o nome do procedimento.' });
    }

    const valorEmpresa = await prisma.$transaction(async (tx) => {
      if (daEmpresa) {
        const data = {};
        if (nome !== null) data.nome = nome.slice(0, 255);
        if (campos !== null) {
          if (!campos.especialidade) throw Object.assign(new Error('Selecione a categoria do procedimento.'), { status: 400 });
          data.especialidade    = campos.especialidade;
          data.tipoProcedimento = campos.tipoProcedimento;
          // Exame de imagem é recortado pela CATEGORIA; o clínico mantém a que tem.
          if (campos.categoria) data.categoria = campos.categoria;
        }
        if (Object.keys(data).length > 0) await tx.procedimentoVeterinario.update({ where: { id }, data });
      }

      const v = req.body?.valor !== undefined
        ? await gravarValorDaEmpresa(tx, req.empresaId, id, req.body.valor)
        : undefined;

      await registrarAuditoria(tx, req, {
        categoria: 'ALTERACAO', entidade: 'PROCEDIMENTO', entidadeId: id,
        detalhes:  `Procedimento "${nome ?? atual.nome}" alterado${daEmpresa ? '' : ' (valor da clínica)'}`,
      });
      return v;
    });

    const dados = await prisma.procedimentoVeterinario.findUnique({
      where:  { id },
      select: { id: true, nome: true, categoria: true, especialidade: true, tipoProcedimento: true,
                valorVenda: true, empresaId: true, ativo: true },
    });
    return res.json({ dados: { ...dados, daEmpresa, valorEmpresa } });
  } catch (err) {
    if (err?.status === 400) return res.status(400).json({ error: err.message });
    console.error('ProcedimentoCadastroController.atualizarProprio:', err);
    return res.status(500).json({ error: 'Erro ao alterar o procedimento.' });
  }
};

/**
 * PATCH /api/procedimentos/cadastro/proprio/:id/toggle  { motivo? }
 *
 * ATIVAR/INATIVAR o procedimento DA CLÍNICA — o par que a tela passou a oferecer em
 * 2026-09-22, no mesmo formato de Produtos. O que faltava não era o soft delete e sim
 * o CAMINHO DE VOLTA: inativado, não havia como reativá-lo por tela nenhuma.
 *
 * ⚠️ INATIVAR exige `motivo` e grava `INATIVACAO` na Auditoria; ATIVAR não pede
 * motivo (§13, armadilha 33: reativar é correção, e pedir justificativa ali é só
 * atrito). Gate estrutural em `__tests__/inativacaoJustificada.test.js`.
 *
 * ⚠️ Linha GLOBAL responde 400: ela vale para TODAS as clínicas do SaaS, e o RLS de
 * `tb_procedimentos_vet` recusa a escrita de qualquer forma. Para tirá-la da frente
 * desta clínica, o caminho é cadastrar o próprio procedimento.
 */
const toggleAtivoProprio = async (req, res) => {
  try {
    if (!req.empresaId) return res.status(400).json({ error: 'Selecione a empresa.' });
    const id = Number(req.params.id);

    const item = await prisma.procedimentoVeterinario.findFirst({
      where:  procedimentoVisivel(req.empresaId, id),
      select: { id: true, nome: true, ativo: true, empresaId: true },
    });
    if (!item) return res.status(404).json({ error: 'Procedimento não encontrado.' });
    if (item.empresaId == null) {
      return res.status(400).json({
        error: 'Este procedimento é do catálogo do sistema e vale para todas as clínicas — não pode ser inativado aqui.',
        code:  'ITEM_DO_SISTEMA',
      });
    }

    const vaiInativar = item.ativo;
    const motivo = String(req.body?.motivo ?? '').trim();
    if (vaiInativar && motivo.length < 3) {
      return res.status(400).json({ error: 'É obrigatório informar o motivo da inativação.' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.procedimentoVeterinario.update({ where: { id }, data: { ativo: !vaiInativar } });
      await registrarAuditoria(tx, req, {
        categoria:  vaiInativar ? 'INATIVACAO' : 'ATIVACAO',
        entidade:   'PROCEDIMENTO',
        entidadeId: id,
        motivo:     vaiInativar ? motivo : null,
        detalhes:   `Procedimento "${item.nome}" ${vaiInativar ? 'inativado' : 'ativado'} no catálogo da clínica`,
      });
    });

    return res.json({
      mensagem: vaiInativar ? 'Procedimento inativado.' : 'Procedimento ativado.',
      ativo:    !vaiInativar,
    });
  } catch (err) {
    console.error('ProcedimentoCadastroController.toggleAtivoProprio:', err);
    return res.status(500).json({ error: 'Erro ao alterar a situação do procedimento.' });
  }
};

/**
 * Quantas execuções o LEDGER do prestador tem com este nome.
 *
 * ⚠️ SQL CRU e atrás do guarda de `lib/procedimentoPrestador.js`: a tabela nasceu numa
 * migration que pode não estar aplicada, e no Windows o `prisma generate` falha com o
 * backend rodando (§11) — pelo client tipado, uma base defasada derrubaria a checagem
 * inteira com 500. Sem a tabela não há execução registrada, então 0 é a resposta certa.
 *
 * ⚠️ O recorte por empresa é do RLS (a tabela é tenant plane e tem `empresa_id`).
 */
async function contarNoLedgerDoPrestador(nome) {
  if (!(await vinculoPrestador.temTabelas())) return 0;
  const rows = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS n
      FROM "schs2vet"."tb_execucoes_procedimento_prestador"
     WHERE lower("procedimento_nome") = lower(${nome})`;
  return Number(rows?.[0]?.n ?? 0);
}

/**
 * Onde o procedimento pode estar SENDO USADO. Devolve a lista de motivos que impedem
 * a exclusão definitiva — vazia = nada o referencia.
 *
 * 🔴 A LIGAÇÃO É PELO NOME, não por FK. `tb_prescricoes` guarda o procedimento em
 * `medicamento` (texto) com `tipo = 'PROCEDIMENTO'`, e o ledger do prestador guarda
 * `procedimento_nome`: nenhuma das duas tem `procedimento_id`. Isso é intencional lá
 * (prontuário não muda porque um cadastro foi mexido), e aqui vira a única forma de
 * perguntar "isto já foi usado?".
 *
 * ⚠️ O recorte por empresa vem do RLS, não de um `where` escrito aqui: `tb_prescricoes`,
 * `tb_orcamento_itens` e `tb_execucoes_procedimento_prestador` são tenant plane, então
 * a contagem já é a DESTA clínica. Não somar um filtro por empresa à mão — seria uma
 * segunda regra a divergir da policy.
 *
 * ⚠️ Prescrição CANCELADA ou soft-deletada CONTA. O que se pergunta é "este nome já
 * apareceu num prontuário?", e apagar o cadastro por trás de um registro clínico que
 * existiu deixa o histórico apontando para nada. Inativar é o caminho para esse caso.
 */
async function usosDoProcedimento(nome, id) {
  const porNome = { equals: nome, mode: 'insensitive' };

  const [emPrescricoes, emOrcamentos, emCombos, emExecucoes] = await Promise.all([
    prisma.prescricao.count({ where: { tipo: 'PROCEDIMENTO', medicamento: porNome } }),
    prisma.orcamentoItem.count({
      where: { tipo: 'PROCEDIMENTO', OR: [{ refId: id }, { descricao: porNome }] },
    }),
    prisma.procedimentoComboItem.count({ where: { procedimentoId: id } }),
    contarNoLedgerDoPrestador(nome),
  ]);

  const motivos = [];
  if (emPrescricoes) motivos.push(`${emPrescricoes} prescrição(ões)/evolução(ões)`);
  if (emOrcamentos)  motivos.push(`${emOrcamentos} item(ns) de orçamento`);
  if (emCombos)      motivos.push(`${emCombos} combo(s) desta clínica`);
  if (emExecucoes)   motivos.push(`${emExecucoes} execução(ões) já lançada(s)`);
  return motivos;
}

/**
 * DELETE /api/procedimentos/cadastro/proprio/:id  { motivo }
 *
 * 🔴 EXCLUSÃO DEFINITIVA, e SÓ quando o procedimento nunca foi usado (2026-09-23, a
 * pedido). O erro de digitação recém-cadastrado não precisa ficar para sempre na lista
 * como "inativo"; o que já entrou num prontuário, sim.
 *
 * ⚠️ NÃO substitui o inativar (`toggleAtivoProprio`), e a tela oferece os dois: usado
 * uma vez, o cadastro deixa de ser excluível para sempre — sem o soft delete não
 * haveria como tirá-lo da frente. Esta rota é a saída para o caso em que não há
 * histórico a preservar.
 *
 * ⚠️ Linha GLOBAL responde 400: ela vale para TODAS as clínicas do SaaS e o RLS de
 * `tb_procedimentos_vet` recusaria a escrita de qualquer forma — o que viraria um 500
 * sem explicação no lugar de uma recusa legível.
 *
 * ⚠️ `motivo` é OBRIGATÓRIO e vai para a Auditoria (§13, armadilha 33). A auditoria é
 * gravada ANTES do `delete`, na MESMA transação: a linha some do catálogo, então o
 * rastro é o único lugar onde ela continua existindo.
 *
 * ⚠️ O `delete` CASCATEIA para `tb_procedimento_valores_empresa` e
 * `tb_procedimento_prestadores` (configuração, sem histórico). Para
 * `tb_procedimento_combo_itens` a cascata também existe — e é justamente por isso que
 * o combo entra na checagem acima: sem ela, excluir o procedimento esvaziaria o pacote
 * de alguém em silêncio.
 */
const excluirProprio = async (req, res) => {
  try {
    if (!req.empresaId) return res.status(400).json({ error: 'Selecione a empresa.' });
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Procedimento inválido.' });

    const item = await prisma.procedimentoVeterinario.findFirst({
      where:  procedimentoVisivel(req.empresaId, id),
      select: { id: true, nome: true, empresaId: true },
    });
    // Procedimento privado de outra clínica responde 404 — não confirma que existe.
    if (!item) return res.status(404).json({ error: 'Procedimento não encontrado.' });

    if (item.empresaId == null) {
      return res.status(400).json({
        error: 'Este procedimento é do catálogo do sistema e vale para todas as clínicas — não pode ser excluído aqui.',
        code:  'ITEM_DO_SISTEMA',
      });
    }

    const motivo = String(req.body?.motivo ?? '').trim();
    if (motivo.length < 3) {
      return res.status(400).json({ error: 'É obrigatório informar o motivo da exclusão.' });
    }

    const motivos = await usosDoProcedimento(item.nome, id);
    if (motivos.length > 0) {
      return res.status(409).json({
        error: `"${item.nome}" já foi usado em ${motivos.join(', ')} e não pode ser excluído. Inative-o para tirá-lo do Orçamento e da Prescrição sem apagar o histórico.`,
        code:  'PROCEDIMENTO_EM_USO',
        usos:  motivos,
      });
    }

    await prisma.$transaction(async (tx) => {
      await registrarAuditoria(tx, req, {
        categoria:  'EXCLUSAO',
        entidade:   'PROCEDIMENTO',
        entidadeId: id,
        motivo,
        detalhes:   `Procedimento "${item.nome}" excluído do catálogo da clínica (nunca usado)`,
      });
      await tx.procedimentoVeterinario.delete({ where: { id } });
    });

    return res.json({ mensagem: 'Procedimento excluído.' });
  } catch (err) {
    console.error('ProcedimentoCadastroController.excluirProprio:', err);
    return res.status(500).json({ error: 'Erro ao excluir o procedimento.' });
  }
};

module.exports = {
  criarProprio,
  atualizarProprio,
  toggleAtivoProprio,
  excluirProprio,
  especialidadesMinhas,
  listarComValores,
  definirValor,
  listarPrestadoresDaEmpresa,
  definirPrestador,
  removerPrestador,
  prestadoresDoProcedimento,
  listarCombos,
  criarCombo,
  atualizarCombo,
  toggleCombo,
};
