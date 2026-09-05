// backend/src/controllers/EquipeController.js
'use strict';

const bcrypt           = require('bcryptjs');
const emailService     = require('../services/emailService');
const PermissaoService = require('../services/PermissaoService');
const { PERMISSOES_PADRAO } = require('../seeds/002_permissoes_padrao.seed');
const { getEquipeIdsDoProprietario } = require('../middlewares/permissao.middleware');
// "Tem cadastro de cliente nesta empresa?" — mesmo critério do tipo por empresa,
// reusado pela regra "mais de um papel na mesma empresa soma" (ver `ajusteperfil`
// na memória e `minhasPermissoes` abaixo).
const { resolverComoCliente } = require('../lib/tipoContexto');
const { storage }      = require('../storage');
const { TIPOS_FECHAMENTO_VALIDOS } = require('../lib/faturaUtils');
const { normalizarValidade, lerValidade, salvarValidade } = require('../lib/validadeOrcamento');
// Fuso horário da clínica — a aplicação roda nos 4 fusos do Brasil (ver lib/fusoEmpresa.js).
const { normalizarFuso, salvarFuso, fusoDaEmpresa, rotuloFuso } = require('../lib/fusoEmpresa');
const { senhaReutilizada, registrarTrocaSenha, MENSAGEM_REUSO: MENSAGEM_SENHA_REUTILIZADA } = require('../services/passwordHistoryService');

const prisma = require('../lib/prisma').default;
const { comEscopoPlataforma } = require('../lib/prismaTenant');
const { normalizeEmail, findUserByEmail, whereEmailInsensitive } = require('../lib/email');
// Cadastro do profissional é POR EMPRESA — nunca gravar nome/contato/endereço/CRMV
// direto no User (vaza entre clínicas). Ver lib/profissionalPerfil.js.
const {
  salvarPerfil:           salvarPerfilProfissional,
  aplicarPerfil:          aplicarPerfilProfissional,
  aplicarPerfilEmRelacao: aplicarPerfilProfEmRelacao,
} = require('../lib/profissionalPerfil');
// Tabela de ligação usuário × empresa — PERFIL + cadastro por empresa (fonte nova)
const { salvarVinculo, vincularMembro, normalizarPagamento, salvarPagamentoEAcesso,
        lerPagamentoEAcesso,
        anexarPagamentoEmRelacao, anexarFotoEmRelacao, empresasSemAcesso,
        definirAtivoNaEmpresa } = require('../lib/usuarioEmpresa');
// Limite de usuários do plano — fonte única da conta de assentos (fase 2 do multi-tenancy)
const { garantirVagaDeUsuario, consomeAssento } = require('../lib/planoEmpresa');
// Trilha de ATIVAÇÃO/INATIVAÇÃO (quem fez, quando) — ver toggleMembro/listarMembros
const { registrarAtivacao, registrarInativacao, anexarTrilhaAtivacaoEmRelacao } = require('../lib/usuarioAtivacao');
const { registrarAuditoria, registrarAcessoNegado } = require('../lib/auditoria');
const bloqueioLogin = require('../lib/bloqueioLogin');

// ─── Helper: encontra a empresa do usuário (owner OU gestor convidado) ─────────
// empresaIdPreferida (req.empresaId, vindo do seletor de empresa no frontend):
// usada se o usuário for dono OU gestor dela; caso contrário cai no fallback.
/**
 * Empresa em que o usuário age como GESTOR (dono ou cargo GESTOR).
 *
 * ⚠️ REGRA DE ISOLAMENTO (corrigido 2026-07-29): havendo CONTEXTO ATIVO
 * (`empresaIdPreferida` = req.empresaId, já validado pelo auth.js), a resolução é
 * EXCLUSIVA daquela empresa — não existe fallback. Quem não é dono/gestor DELA
 * recebe `null`, e o caller trata como "não é gestor aqui".
 *
 * O fallback antigo ("qualquer empresa que ele possua/gerencie") vazava o papel de
 * gestor entre clínicas: um profissional que é GESTOR na empresa A e VETERINÁRIO na
 * B, trabalhando no contexto de B, era resolvido para A — e então `listarMembros`
 * devolvia o roster de A com isGestor=true, `/equipes/configuracoes` devolvia a
 * configuração de A (bloqueando os módulos de B com "Complete a Configuração da
 * Empresa") e as ações de gestão gravavam em A. Ver CLAUDE.md armadilha #25:
 * "bypass de dono vale APENAS para a empresa ativa".
 *
 * Sem contexto ativo (1º login, cliente não-navegador) o fallback continua: é o
 * bootstrap do vet autônomo, que só tem a própria empresa.
 */
async function getEmpresaDoGestor(userId, empresaIdPreferida = null) {
  if (empresaIdPreferida) {
    return prisma.empresa.findFirst({
      where: {
        id: Number(empresaIdPreferida),
        OR: [
          { ownerId: userId },
          { equipes: { some: { membros: { some: { userId, cargo: 'GESTOR' } } } } },
        ],
      },
    });
  }

  // 1. Usuário é dono (ownerId)
  let empresa = await prisma.empresa.findFirst({ where: { ownerId: userId } });
  if (empresa) return empresa;

  // 2. Usuário é gestor convidado (cargo: 'GESTOR' em alguma equipe)
  const assoc = await prisma.membroEquipe.findFirst({
    where:   { userId, cargo: 'GESTOR' },
    include: { equipe: { select: { empresaId: true } } },
    orderBy: { createdAt: 'asc' },
  });
  if (assoc?.equipe?.empresaId) {
    return prisma.empresa.findUnique({ where: { id: assoc.equipe.empresaId } });
  }
  return null;
}

// ─── Helper: garante empresa + equipe padrão do vet ──────────────────────────
// equipeIdPreferida (req.equipeId — equipe ativa do gestor CPF): usada se pertencer à empresa.
async function garantirEquipePadrao(vetUserId, empresaIdPreferida = null, equipeIdPreferida = null) {
  let empresa = await getEmpresaDoGestor(vetUserId, empresaIdPreferida);
  if (!empresa) {
    // Contexto ativo em que ele NÃO é dono/gestor: a operação é de gestão e não vale
    // aqui. Não se cria empresa nova (viraria empresa fantasma a cada tentativa) nem
    // se cai na empresa dele (gravaria o membro na clínica errada). Caller responde 403.
    if (empresaIdPreferida) return { empresa: null, equipe: null };
    const vetUser = await prisma.user.findUnique({ where: { id: vetUserId }, select: { fullName: true } });
    empresa = await prisma.empresa.create({
      data: { nome: `Clínica de ${vetUser?.fullName ?? 'Veterinário'}`, ownerId: vetUserId },
    });
  }

  let equipe = null;
  if (equipeIdPreferida) {
    equipe = await prisma.equipe.findFirst({
      where: { id: Number(equipeIdPreferida), empresaId: empresa.id },
    });
  }
  // orderBy createdAt asc: mesma equipe "primeira" que listarMembros escolhe — evita
  // inclusão e listagem divergirem quando não há equipe ativa no contexto.
  if (!equipe) equipe = await prisma.equipe.findFirst({ where: { empresaId: empresa.id }, orderBy: { createdAt: 'asc' } });
  if (!equipe) {
    // Bootstrap (empresa legada sem equipe): aqui não existe nome informado por
    // ninguém, então usa o da PRÓPRIA EMPRESA — nunca em branco e nunca o genérico
    // "Equipe Principal", que é o que o gestor acabava vendo no seletor de contexto.
    equipe = await prisma.equipe.create({
      data: { nome: empresa.nome, empresaId: empresa.id },
    });
  }

  return { empresa, equipe };
}

// ─── Helper: equipe ativa dentro da empresa ───────────────────────────────────
// Prefere req.equipeId (seletor do gestor CPF) se a equipe pertencer à empresa;
// caso contrário cai na primeira equipe da empresa.
async function getEquipeAtiva(empresaId, equipeIdPreferida = null) {
  if (equipeIdPreferida) {
    const equipe = await prisma.equipe.findFirst({
      where: { id: Number(equipeIdPreferida), empresaId },
    });
    if (equipe) return equipe;
  }
  return prisma.equipe.findFirst({ where: { empresaId } });
}

// ─── Helper: resolve o escopo (empresaId + equipeId) da EmpresaConfiguracao ───
// Empresa com CNPJ → configuração única por empresa (equipeId null).
// Empresa pessoal (CNPJ null) → configuração única por equipe ativa.
// Retorna null se o usuário não for dono nem gestor de nenhuma empresa/equipe (mesmo
// critério de getEmpresaDoGestor/getEquipeAtiva — caller trata como 404).
async function resolverEscopoConfiguracao(req) {
  const empresa = await getEmpresaDoGestor(req.user.id, req.empresaId);
  if (!empresa) return null;
  if (empresa.cnpj) return { empresaId: empresa.id, equipeId: null };
  const equipe = await getEquipeAtiva(empresa.id, req.equipeId);
  if (!equipe) return null;
  return { empresaId: empresa.id, equipeId: equipe.id };
}

// Espécies atendidas: coluna TEXT com CSV de IDs de Especie. Converte de/para array de números.
function parseEspeciesAtendidas(csv) {
  if (!csv) return [];
  return String(csv).split(',').map(s => Number(s.trim())).filter(Number.isInteger);
}

// Resolve o escopo da configuração para QUALQUER membro do contexto ativo (não só
// gestor) — usado para leitura do expediente de atendimento pelo Agendamento.
// Baseia-se em req.empresaId/req.equipeId já validados pelo auth.
async function resolverEscopoConfiguracaoMembro(req) {
  if (!req.empresaId) return null;
  const empresa = await prisma.empresa.findUnique({ where: { id: req.empresaId }, select: { id: true, cnpj: true } });
  if (!empresa) return null;
  if (empresa.cnpj) return { empresaId: empresa.id, equipeId: null };
  let equipeId = req.equipeId ?? null;
  if (!equipeId) {
    const eq = await prisma.equipe.findFirst({ where: { empresaId: empresa.id }, orderBy: { id: 'asc' }, select: { id: true } });
    if (!eq) return null;
    equipeId = eq.id;
  }
  return { empresaId: empresa.id, equipeId };
}

// Prisma rejeita `null` num campo de chave única composta em findUnique/upsert.
// Empresa com CNPJ usa equipeId=null → usar findFirst, que traduz `equipeId: null`
// para `IS NULL` corretamente.
async function buscarConfiguracao(escopo) {
  return prisma.empresaConfiguracao.findFirst({
    where: { empresaId: escopo.empresaId, equipeId: escopo.equipeId },
  });
}

// "Cadastro da Empresa completo" NÃO é "a linha existe" — é TODOS os campos do
// onboarding do gestor preenchidos (identidade da empresa + operacional), exceto
// LOGO e WHATSAPP (opcionais por natureza).
//
// ⚠️ Existe porque `criarGestor` (2026-08-17) pré-cria a linha de `EmpresaConfiguracao`
// já na criação do gestor, totalmente vazia (nem espécies: o Admin não escolhe mais
// nada da empresa). Se o gate de primeiro acesso do gestor (`empresaConfigurada` em
// UserController.getMe) checasse só "existe linha?"/"empresa existe?", ele responderia
// `true` no instante em que o gestor é criado — antes de ele preencher qualquer coisa
// — e o Sidebar nunca mais pediria isso dele. Este helper é o que faz o gate exigir o
// preenchimento de verdade.
//
// ⚠️ `validadeOrcamentoDias` fica DE FORA de propósito: `null` é um valor de negócio
// legítimo ("orçamento sem validade", consumido pelo cron `cancelar_orcamentos_vencidos`)
// e hoje não há como distinguir "nunca preenchido" de "o gestor escolheu não ter
// validade" sem uma UI própria para isso — incluí-lo aqui removeria essa opção de toda
// empresa nova.
function configuracaoCompleta(config, empresa) {
  const operacionalOk = !!(
    config
    && config.diasAtendimento
    && config.horaInicioAtendimento
    && config.horaFimAtendimento
    && config.especiesAtendidas
    && config.tempoConsultaPadraoMin
    && config.tipoFechamento
    && (config.tipoFechamento === 'ULTIMO_DIA_MES' || config.diaFechamentoFatura)
  );
  if (!operacionalOk) return false;

  if (!empresa) return false;
  if (!empresa.nome?.trim()) return false;
  if (!empresa.documento) return false;
  if (!(empresa.cep && empresa.endereco && empresa.bairro && empresa.cidade && empresa.estado)) return false;
  if (empresa.tipoDocumento === 'CNPJ'
      && !(empresa.razaoSocial?.trim() && empresa.nomeFantasia?.trim() && empresa.inscricaoEstadual?.trim())) {
    return false;
  }
  return true;
}

// Espécies atendidas no escopo (Configurações da empresa; sem elas, as espécies do
// perfil do DONO da empresa — evita listar o catálogo inteiro). `equipeIdParam` permite
// a tela de gestão consultar uma equipe ≠ da do contexto ativo, desde que tenha acesso.
async function resolverEspeciesAtendidas(req, equipeIdParam = null) {
  let escopo = null;
  if (equipeIdParam) {
    const eq = await prisma.equipe.findUnique({
      where:  { id: Number(equipeIdParam) },
      select: { id: true, empresaId: true, empresa: { select: { cnpj: true } } },
    });
    if (eq) {
      const acessoOk = eq.empresaId === req.empresaId
        || !!(await getEmpresaDoGestor(req.user.id, eq.empresaId));
      if (acessoOk) {
        escopo = eq.empresa?.cnpj
          ? { empresaId: eq.empresaId, equipeId: null }
          : { empresaId: eq.empresaId, equipeId: eq.id };
      }
    }
  }
  if (!escopo) escopo = await resolverEscopoConfiguracaoMembro(req);
  // Dono/gestor sem MembroEquipe (sem req.empresaId resolvido) — usa o escopo de gestor
  if (!escopo) escopo = await resolverEscopoConfiguracao(req);
  if (!escopo) return [];

  const config = await buscarConfiguracao(escopo);
  const especies = parseEspeciesAtendidas(config?.especiesAtendidas);
  if (especies.length > 0) return especies;

  const emp = await prisma.empresa.findUnique({
    where:  { id: escopo.empresaId },
    select: { ownerId: true },
  });
  if (!emp?.ownerId) return [];
  const perfilDono = await prisma.vetPerfil.findUnique({
    where:  { userId: emp.ownerId },
    select: { especies: { select: { especieId: true } } },
  });
  return perfilDono?.especies.map(e => e.especieId) ?? [];
}

// VETERINÁRIO que não informa especialidade assume CLÍNICA MÉDICA. O catálogo é POR
// ESPÉCIE e cada uma tem seu rótulo ("Clínica Médica", "Clínica Médica de Felinos",
// "Clínica Médica (Buiatria)"), por isso o casamento é por PREFIXO e devolve uma
// especialidade por espécie atendida. Empresa sem espécies configuradas → [] (não há
// catálogo de onde tirar o padrão).
// FORNECEDOR NÃO usa este padrão: para ele especialidade nula é válida.
const PREFIXO_ESPECIALIDADE_PADRAO = 'clínica médica';

// Animal como a tela "Gerenciar Acesso" do prestador precisa: além da identificação,
// o LOCAL — `localizacao` (cadastro atual) e o campo textual `local` (legado), que é
// o fallback de exibição/filtro para animais cadastrados antes da localização.
const ANIMAL_DESIGNACAO_SELECT = {
  id:            true,
  nome:          true,
  photoUrl:      true,
  local:         true,
  localizacaoId: true,
  especie:       { select: { nome: true } },
  localizacao:   { select: { id: true, nome: true } },
};

// `especiesFallback` cobre o cadastro do vet autônomo: a empresa pode não ter espécies
// configuradas, mas ele acabou de informar as que atende no próprio formulário.
async function especialidadesPadraoVeterinario(req, equipeIdParam = null, especiesFallback = []) {
  try {
    let especies = await resolverEspeciesAtendidas(req, equipeIdParam);
    if (especies.length === 0) {
      especies = [...new Set((especiesFallback ?? []).map(Number))].filter(Number.isInteger);
    }
    if (especies.length === 0) return [];
    const rows = await prisma.especialidade.findMany({
      where:   { ativo: true, especieId: { in: especies } },
      select:  { id: true, nome: true, especieId: true },
      orderBy: { id: 'asc' },
    });
    const porEspecie = new Map();
    for (const r of rows) {
      if (porEspecie.has(r.especieId)) continue;
      if (r.nome.trim().toLowerCase().startsWith(PREFIXO_ESPECIALIDADE_PADRAO)) {
        porEspecie.set(r.especieId, r.id);
      }
    }
    return [...porEspecie.values()];
  } catch {
    return [];
  }
}

// Tempo de consulta (min) que vale para toda especialidade SEM tempo próprio no local:
// o padrão configurado pela empresa do contexto; sem ele, o padrão do sistema (60).
// Herança dinâmica — nunca copiar este valor para dentro do local.
async function tempoConsultaPadraoDaEmpresa(req) {
  try {
    const escopo = await resolverEscopoConfiguracaoMembro(req);
    if (!escopo) return TEMPO_CONSULTA_PADRAO_SISTEMA;
    const config = await buscarConfiguracao(escopo);
    const min = Number(config?.tempoConsultaPadraoMin);
    return Number.isInteger(min) && min > 0 ? min : TEMPO_CONSULTA_PADRAO_SISTEMA;
  } catch {
    return TEMPO_CONSULTA_PADRAO_SISTEMA;
  }
}

// ─── Helper: onboarding de vet convidado ─────────────────────────────────────
// Marca isConvidado=true e copia espécies do dono da equipe para o vet convidado
// (somente se o convidado for VETERINARIO e ainda não tiver espécies cadastradas)
async function aplicarOnboardingConvidado(userId, equipeId) {
  const CARGOS_VET = ['VETERINARIO', 'ADMIN'];
  const usuario = await prisma.user.findUnique({
    where:  { id: userId },
    select: { userType: true },
  });

  // Sempre marca como convidado — SQL raw para não depender do prisma generate
  try {
    await prisma.$executeRawUnsafe(`UPDATE schs2vet.users SET "isConvidado" = true WHERE id = $1`, userId);
  } catch { /* coluna ainda não existe no DB legado — ignora */ }

  // Copia espécies somente para vets sem espécies ainda
  if (!usuario || !CARGOS_VET.includes(usuario.userType)) return;

  const equipe = await prisma.equipe.findUnique({
    where:   { id: equipeId },
    include: { empresa: { select: { ownerId: true } } },
  });
  if (!equipe?.empresa?.ownerId) return;

  const vetPerfilDono = await prisma.vetPerfil.findUnique({
    where:   { userId: equipe.empresa.ownerId },
    include: { especies: { select: { especieId: true } } },
  });
  const especiesDonoIds = vetPerfilDono?.especies.map(e => e.especieId) ?? [];
  if (especiesDonoIds.length === 0) return;

  // Cria VetPerfil do convidado se não existir
  let perfilConvidado = await prisma.vetPerfil.findUnique({ where: { userId } });
  if (!perfilConvidado) {
    perfilConvidado = await prisma.vetPerfil.create({ data: { userId } });
  }

  // Só copia se o convidado ainda não tem espécies próprias
  const especiesConvidado = await prisma.vetEspecie.count({ where: { vetPerfilId: perfilConvidado.id } });
  if (especiesConvidado > 0) return;

  const upserts = especiesDonoIds.map(especieId =>
    prisma.vetEspecie.upsert({
      where:  { vetPerfilId_especieId: { vetPerfilId: perfilConvidado.id, especieId } },
      update: {},
      create: { vetPerfilId: perfilConvidado.id, especieId },
    })
  );
  await prisma.$transaction(upserts);
}

const { USER_TYPES_GERENCIADOS } = PermissaoService;

const NIVEL_ORDER = { NENHUM: 0, LEITURA: 1, PROPRIO: 2, EQUIPE: 3, FULL: 4 };

// Anexa a cada membro os perfis do usuário — exibidos na coluna "Perfis" do
// ControleAcesso. PRIVACIDADE: os perfis são exclusivos de cada empresa — o que
// o usuário é em OUTRA empresa (gestor da própria, estagiário de terceiros etc.)
// não aparece para ninguém fora dela. Por padrão o escopo é a empresa da equipe
// listada ({ empresaId }); apenas o ADMIN da plataforma vê tudo ({ todos: true }).
async function anexarPerfisGlobais(membros, { empresaId = null, todos = false } = {}) {
  const userIds = [...new Set(membros.map(m => m.user.id))];
  if (userIds.length === 0) return membros;
  const [vinculos, donos] = await Promise.all([
    prisma.membroEquipe.findMany({
      where: {
        userId: { in: userIds },
        ...(todos ? {} : { equipe: { empresaId: empresaId ? Number(empresaId) : -1 } }),
      },
      select: { userId: true, cargo: true, cargos: true },
    }),
    prisma.empresa.findMany({
      where: {
        ownerId: { in: userIds },
        ...(todos ? {} : { id: empresaId ? Number(empresaId) : -1 }),
      },
      select: { ownerId: true },
    }),
  ]);
  const perfisPorUser = new Map();
  const add = (userId, cargo) => {
    if (!cargo) return;
    if (!perfisPorUser.has(userId)) perfisPorUser.set(userId, new Set());
    perfisPorUser.get(userId).add(cargo);
  };
  for (const v of vinculos) {
    add(v.userId, v.cargo);
    for (const c of (v.cargos ?? [])) add(v.userId, c);
  }
  for (const d of donos) add(d.ownerId, 'GESTOR');
  return membros.map(m => ({ ...m, perfisGlobais: [...(perfisPorUser.get(m.user.id) ?? [])] }));
}

// ─── Expediente de trabalho do MEMBRO (via SQL raw — colunas novas em tb_membros_equipe) ──
// Valida e normaliza os campos do body. Cada campo: undefined = não altera; ''/[] = limpa.
function parseExpedienteTrabalho(body) {
  let dias; // undefined = não enviado
  if (body.diasTrabalho !== undefined) {
    const arr = Array.isArray(body.diasTrabalho)
      ? body.diasTrabalho
      : String(body.diasTrabalho).split(',').map(s => s.trim()).filter(Boolean);
    if (arr.length === 0) dias = null;
    else {
      const nums = [...new Set(arr.map(Number))].sort((a, b) => a - b);
      if (nums.some(n => !Number.isInteger(n) || n < 0 || n > 6)) return { erro: 'Dias de trabalho inválidos (0=Dom … 6=Sáb).' };
      dias = nums.join(',');
    }
  }
  const parseHora = (v) => {
    if (v === undefined) return undefined;
    const s = String(v).trim();
    if (s === '') return null;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) return '__ERRO__';
    return s;
  };
  const hi = parseHora(body.horaInicioTrabalho);
  const hf = parseHora(body.horaFimTrabalho);
  if (hi === '__ERRO__' || hf === '__ERRO__') return { erro: 'Horário de trabalho inválido — use HH:MM.' };
  if (hi && hf && hi >= hf) return { erro: 'A hora de início do trabalho deve ser menor que a de término.' };
  return { diasTrabalho: dias, horaInicioTrabalho: hi, horaFimTrabalho: hf };
}

// Grava só os campos enviados (undefined = não altera).
async function gravarExpedienteTrabalho(membroId, exp) {
  const sets = [], vals = [];
  let i = 1;
  if (exp.diasTrabalho       !== undefined) { sets.push(`"diasTrabalho"=$${i++}`);       vals.push(exp.diasTrabalho); }
  if (exp.horaInicioTrabalho !== undefined) { sets.push(`"horaInicioTrabalho"=$${i++}`); vals.push(exp.horaInicioTrabalho); }
  if (exp.horaFimTrabalho    !== undefined) { sets.push(`"horaFimTrabalho"=$${i++}`);    vals.push(exp.horaFimTrabalho); }
  if (sets.length === 0) return;
  vals.push(Number(membroId));
  await prisma.$executeRawUnsafe(`UPDATE schs2vet.tb_membros_equipe SET ${sets.join(', ')} WHERE id=$${i}`, ...vals);
}

// ─── Locais de trabalho do MEMBRO (múltiplos por membro) ──────────────────────
// Valida a lista body.locaisTrabalho = [{ localizacaoId, diasTrabalho, horaInicioTrabalho, horaFimTrabalho, especialidadeIds }].
// undefined = não altera; [] = limpa todos. Cada local reaproveita a validação de
// dias/horário do expediente único.
const DIAS_LABEL = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// Tempo de consulta por especialidade (minutos). O teto de 8h evita bloquear o dia
// inteiro por engano de digitação; o piso de 5min evita grades absurdas.
const TEMPO_CONSULTA_MIN = 5;
const TEMPO_CONSULTA_MAX = 480;
// Sem tempo próprio no local e sem padrão na empresa: a grade de 1h que a agenda
// sempre teve (espelhado em PASSO_PADRAO_MIN/DURACAO_PADRAO_MIN).
const TEMPO_CONSULTA_PADRAO_SISTEMA = 60;

// CSV de IDs ("3,7,12") → [3,7,12]. Vazio/null → [].
function csvParaIds(csv) {
  if (!csv) return [];
  return String(csv).split(',').map(s => Number(s.trim())).filter(Number.isInteger);
}

// Duas linhas de trabalho do MESMO profissional não podem coincidir: se compartilham
// algum dia da semana e as faixas de horário se cruzam, ele estaria em dois lugares (ou
// em duas especialidades) ao mesmo tempo. Local sem horário é tratado como o dia inteiro.
//
// O MESMO local pode se repetir — é assim que o profissional é clínico seg/qua/sex e
// dermatologista ter/qui na mesma Hípica. Cada linha é um turno com seus dias, horário
// e especialidades. O que esta função garante é que os turnos não se sobreponham.
//
// Dias em branco = herda os dias da empresa. Entre locais DIFERENTES isso segue fora do
// confronto (regra antiga, preservada: cadastro sem dias não trava o salvamento); no
// MESMO local as duas linhas cairiam exatamente sobre os mesmos dias herdados, então a
// sobreposição é certa e precisa ser barrada — senão a agenda teria duas grades
// concorrentes para o mesmo lugar no mesmo dia.
function conflitoEntreLocais(locais) {
  const diasDe = (l) => (l.diasTrabalho ? String(l.diasTrabalho).split(',').map(Number) : []);
  const faixaDe = (l) => [l.horaInicioTrabalho || '00:00', l.horaFimTrabalho || '23:59'];

  for (let i = 0; i < locais.length; i++) {
    for (let j = i + 1; j < locais.length; j++) {
      const mesmoLocal = Number(locais[i].localizacaoId) === Number(locais[j].localizacaoId);
      const diasA = diasDe(locais[i]);
      const diasB = diasDe(locais[j]);
      // null = "todos os dias herdados da empresa" (só acontece no mesmo local)
      const comuns = (mesmoLocal && (diasA.length === 0 || diasB.length === 0))
        ? null
        : diasA.filter(d => diasB.includes(d));
      if (comuns !== null && comuns.length === 0) continue;

      const [iniA, fimA] = faixaDe(locais[i]);
      const [iniB, fimB] = faixaDe(locais[j]);
      if (iniA < fimB && iniB < fimA) {
        const dias = comuns === null
          ? 'todos os dias herdados da empresa'
          : comuns.sort((a, b) => a - b).map(d => DIAS_LABEL[d]).join(', ');
        if (mesmoLocal) {
          return `Este local já tem outro horário em ${dias} (${iniA}–${fimA} e ${iniB}–${fimB}). `
               + 'Para repetir o local, informe dias ou horários que não se sobreponham.';
        }
        return `Os locais de trabalho não podem coincidir: há sobreposição em ${dias} `
             + `(${iniA}–${fimA} e ${iniB}–${fimB}).`;
      }
    }
  }
  return null;
}

// opts.especialidadesPadrao — IDs assumidos no local que não informar especialidade
//   (só o VETERINÁRIO passa este parâmetro; ver especialidadesPadraoVeterinario).
// opts.semEspecialidade — perfil sem atuação clínica (estagiário, enfermeiro, secretaria,
//   financeiro…): o local nunca guarda especialidade nem tempo de consulta.
function parseLocaisTrabalho(body, opts = {}) {
  if (body.locaisTrabalho === undefined) return { locais: undefined };
  if (!Array.isArray(body.locaisTrabalho)) return { erro: 'locaisTrabalho deve ser uma lista.' };

  const padrao = opts.semEspecialidade || !Array.isArray(opts.especialidadesPadrao)
    ? [] : opts.especialidadesPadrao;
  const locais = [];
  for (const l of body.locaisTrabalho) {
    const localizacaoId = Number(l?.localizacaoId);
    if (!Number.isInteger(localizacaoId) || localizacaoId <= 0) {
      return { erro: 'Selecione o local de trabalho.' };
    }
    // Reusa a mesma validação de dias/horário do expediente único
    const exp = parseExpedienteTrabalho(l);
    if (exp.erro) return { erro: exp.erro };
    // Especialidades POR LOCAL (IDs do catálogo tb_especialidades) → CSV.
    // Vazio + padrão informado (veterinário) → assume Clínica Médica.
    let espIds = opts.semEspecialidade ? [] : [...new Set(
      (Array.isArray(l?.especialidadeIds) ? l.especialidadeIds : [])
        .map(Number).filter(Number.isInteger),
    )];
    if (espIds.length === 0 && padrao.length > 0) espIds = [...padrao];

    // Tempo de consulta POR especialidade — OPCIONAL. O que não for informado herda o
    // padrão configurado na empresa (EmpresaConfiguracao.tempoConsultaPadraoMin) na hora
    // de montar a grade; por isso a ausência é gravada como ausência, e não congelada
    // aqui — mudou o padrão da empresa, muda a agenda de quem não configurou.
    const temposIn = (l?.temposConsulta && typeof l.temposConsulta === 'object') ? l.temposConsulta : {};
    const tempos = {};
    for (const id of espIds) {
      const bruto = temposIn[id] ?? temposIn[String(id)];
      if (bruto === undefined || bruto === null || bruto === '') continue; // herda o padrão da empresa
      const min = Number(bruto);
      if (!Number.isInteger(min) || min < TEMPO_CONSULTA_MIN || min > TEMPO_CONSULTA_MAX) {
        return { erro: `O tempo de consulta deve ficar entre ${TEMPO_CONSULTA_MIN} e ${TEMPO_CONSULTA_MAX} minutos (deixe em branco para usar o padrão da empresa).` };
      }
      // Múltiplo de 5 apenas — a grade é regerada a partir do início do expediente
      // a cada dia, então tempos que não fecham a hora (45, 90…) são válidos e não
      // desalinham nada. Espelha TEMPOS_CONSULTA do UsuarioFormModal.
      if (min % 5 !== 0) {
        return { erro: 'O tempo de consulta deve ser um múltiplo de 5 minutos.' };
      }
      tempos[String(id)] = min;
    }

    locais.push({
      localizacaoId,
      // Dias/horário em branco = herda o expediente da empresa (mesma regra do tempo).
      diasTrabalho:       exp.diasTrabalho       ?? null,
      horaInicioTrabalho: exp.horaInicioTrabalho ?? null,
      horaFimTrabalho:    exp.horaFimTrabalho    ?? null,
      especialidadesIds:  espIds.length ? espIds.join(',') : null,
      temposConsulta:     Object.keys(tempos).length ? tempos : null,
    });
  }
  // Ninguém trabalha em dois lugares (nem em duas especialidades) ao mesmo tempo.
  // O MESMO local PODE se repetir com outros dias/horário/especialidade — é o turno,
  // não o lugar, que é único. Quem garante isso é o conflito acima.
  const conflito = conflitoEntreLocais(locais);
  if (conflito) return { erro: conflito };

  return { locais };
}

// Agrega os locais no expediente ÚNICO de tb_membros_equipe (ponte p/ a Agenda, que
// ainda lê esses campos): união dos dias, menor início e maior fim. É deliberadamente
// grosseiro — quando a Agenda passar a ser por local, esta agregação sai.
function agregarExpediente(locais) {
  if (!locais || locais.length === 0) {
    return { diasTrabalho: null, horaInicioTrabalho: null, horaFimTrabalho: null };
  }
  const dias = new Set();
  let inicio = null, fim = null;
  for (const l of locais) {
    (l.diasTrabalho ? String(l.diasTrabalho).split(',') : []).forEach(d => d && dias.add(Number(d)));
    if (l.horaInicioTrabalho && (inicio === null || l.horaInicioTrabalho < inicio)) inicio = l.horaInicioTrabalho;
    if (l.horaFimTrabalho    && (fim === null || l.horaFimTrabalho > fim))          fim = l.horaFimTrabalho;
  }
  return {
    diasTrabalho:       dias.size ? [...dias].sort((a, b) => a - b).join(',') : null,
    horaInicioTrabalho: inicio,
    horaFimTrabalho:    fim,
  };
}

// Substitui TODOS os locais do membro (delete + insert) e sincroniza o expediente
// agregado. Passar `tx` quando já houver transação em andamento.
async function gravarLocaisTrabalho(client, membroId, locais) {
  if (locais === undefined) return; // não enviado → não altera
  await client.membroLocalTrabalho.deleteMany({ where: { membroEquipeId: Number(membroId) } });
  if (locais.length > 0) {
    await client.membroLocalTrabalho.createMany({
      data: locais.map(l => ({ membroEquipeId: Number(membroId), ...l })),
    });
  }
  // Espelha no expediente único (Agenda) via os helpers já existentes
  await gravarExpedienteTrabalho(membroId, agregarExpediente(locais));
}

// Valida cada local de trabalho contra o EXPEDIENTE DA EMPRESA (EmpresaConfiguracao):
// os dias devem estar entre os dias de atendimento e o horário dentro da faixa da empresa.
// Todo membro fica RESTRITO ao dia/horário da empresa. Empresa sem restrição (campos
// null) → não limita. Retorna a 1ª mensagem de erro encontrada ou null (tudo ok).
async function validarLocaisContraExpedienteEmpresa(req, locais) {
  if (!Array.isArray(locais) || locais.length === 0) return null;
  const escopo = await resolverEscopoConfiguracaoMembro(req);
  if (!escopo) return null;
  const config = await buscarConfiguracao(escopo);
  if (!config) return null;

  const diasEmpresa = config.diasAtendimento
    ? String(config.diasAtendimento).split(',').map(Number).filter(n => n >= 0 && n <= 6)
    : null; // null/vazio = todos os dias
  const iniEmpresa = config.horaInicioAtendimento || null;
  const fimEmpresa = config.horaFimAtendimento || null;
  if ((!diasEmpresa || diasEmpresa.length === 0) && !iniEmpresa && !fimEmpresa) return null;

  for (const l of locais) {
    const dias = l.diasTrabalho
      ? String(l.diasTrabalho).split(',').map(Number).filter(n => n >= 0 && n <= 6)
      : [];
    if (diasEmpresa && diasEmpresa.length > 0) {
      const fora = dias.filter(d => !diasEmpresa.includes(d));
      if (fora.length > 0) {
        const permit = [...diasEmpresa].sort((a, b) => a - b).map(d => DIAS_LABEL[d]).join(', ');
        return `Dias fora do expediente da empresa (permitido: ${permit}).`;
      }
    }
    // Horário vazio no local = herda o expediente da empresa (dentro do limite, ok).
    if (iniEmpresa && l.horaInicioTrabalho && l.horaInicioTrabalho < iniEmpresa) {
      return `Horário de entrada antes do expediente da empresa (a partir de ${iniEmpresa}).`;
    }
    if (fimEmpresa && l.horaFimTrabalho && l.horaFimTrabalho > fimEmpresa) {
      return `Horário de saída após o expediente da empresa (até ${fimEmpresa}).`;
    }
  }
  return null;
}

// Carrega os locais de cada membro (com nome da localização) e anexa em `locaisTrabalho`.
async function anexarLocaisTrabalho(membros) {
  const ids = membros.map(m => m.id).filter(Boolean);
  if (ids.length === 0) return membros;
  const rows = await prisma.membroLocalTrabalho.findMany({
    where:   { membroEquipeId: { in: ids } },
    include: { localizacao: { select: { id: true, nome: true } } },
    orderBy: { id: 'asc' },
  });
  const porMembro = new Map();
  for (const r of rows) {
    if (!porMembro.has(r.membroEquipeId)) porMembro.set(r.membroEquipeId, []);
    porMembro.get(r.membroEquipeId).push({
      localizacaoId:      r.localizacaoId,
      localizacaoNome:    r.localizacao?.nome ?? null,
      diasTrabalho:       r.diasTrabalho,
      horaInicioTrabalho: r.horaInicioTrabalho,
      horaFimTrabalho:    r.horaFimTrabalho,
      especialidadeIds:   csvParaIds(r.especialidadesIds),
      temposConsulta:     r.temposConsulta ?? {},
    });
  }
  return membros.map(m => ({ ...m, locaisTrabalho: porMembro.get(m.id) ?? [] }));
}

// Anexa diasTrabalho/horaInicioTrabalho/horaFimTrabalho a uma lista de membros já carregados.
// Resolução POR PROFISSIONAL: usa o expediente do vínculo do contexto; se ele estiver
// vazio, herda o expediente que o profissional definiu em QUALQUER vínculo (o mais
// recente). Assim o expediente "definido uma vez" aparece em qualquer equipe/agenda.
async function anexarExpedienteTrabalho(membros) {
  const ids     = membros.map(m => m.id).filter(Boolean);
  const userIds = [...new Set(membros.map(m => m.user?.id).filter(Boolean))];
  if (ids.length === 0) return membros;
  const [rowsMembro, rowsUser] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT id, "diasTrabalho", "horaInicioTrabalho", "horaFimTrabalho"
         FROM schs2vet.tb_membros_equipe WHERE id IN (${ids.map((_, i) => `$${i + 1}`).join(', ')})`,
      ...ids,
    ),
    userIds.length
      ? prisma.$queryRawUnsafe(
          `SELECT DISTINCT ON ("userId") "userId", "diasTrabalho", "horaInicioTrabalho", "horaFimTrabalho"
             FROM schs2vet.tb_membros_equipe
            WHERE "userId" IN (${userIds.map((_, i) => `$${i + 1}`).join(', ')})
              AND ("diasTrabalho" IS NOT NULL OR "horaInicioTrabalho" IS NOT NULL OR "horaFimTrabalho" IS NOT NULL)
            ORDER BY "userId", id DESC`,
          ...userIds,
        )
      : [],
  ]);
  const porMembro = new Map(rowsMembro.map(r => [r.id, r]));
  const porUser   = new Map(rowsUser.map(r => [r.userId, r]));
  return membros.map(m => {
    const e = porMembro.get(m.id) ?? {};
    const u = porUser.get(m.user?.id) ?? {};
    return {
      ...m,
      diasTrabalho:       e.diasTrabalho       ?? u.diasTrabalho       ?? null,
      horaInicioTrabalho: e.horaInicioTrabalho ?? u.horaInicioTrabalho ?? null,
      horaFimTrabalho:    e.horaFimTrabalho    ?? u.horaFimTrabalho    ?? null,
    };
  });
}

const EquipeController = {

  // ── Empresas ────────────────────────────────────────────────────────────────

  // 🔴 MODELO 2026-08-17: o ADMIN da plataforma cria só o GESTOR (dados básicos +
  // plano). A empresa nasce JUNTO — é o tenant que o vínculo GESTOR precisa —, mas com
  // identidade em branco (nome placeholder, sem documento, sem espécies): é o GESTOR
  // quem completa isso depois em Cadastro da Empresa (EmpresaCadastroController.salvar),
  // sob obrigatoriedade própria (gate de onboarding). Reverte o modelo de 2026-08-06, em
  // que o Admin também escolhia nome/CNPJ/espécies/telefone da empresa aqui.
  // A rota é gateada por `authorize('ADMIN')`; aqui a checagem é redundante mas explícita.
  criarGestor: async (req, res) => {
    try {
      if (req.user?.role !== 'ADMIN' && req.user?.userTypeGlobal !== 'ADMIN' && req.user?.userType !== 'ADMIN') {
        return res.status(403).json({ sucesso: false, mensagem: 'Apenas o administrador da plataforma cria gestores.' });
      }
      const { fullName, email, telefone, cep, endereco, complemento, bairro, cidade, estado, planoId } = req.body;

      const fullNameTrim = String(fullName ?? '').trim();
      if (!fullNameTrim) return res.status(400).json({ sucesso: false, mensagem: 'Nome é obrigatório' });

      const emailTrim = String(email ?? '').trim();
      if (!emailTrim) return res.status(400).json({ sucesso: false, mensagem: 'E-mail é obrigatório' });

      // TELEFONE e ENDEREÇO são o contato pessoal do gestor na plataforma — não da
      // empresa (que ainda não existe de verdade; é ele quem vai preenchê-la depois).
      const telefoneTrim = String(telefone ?? '').trim();
      if (!telefoneTrim) {
        return res.status(400).json({ sucesso: false, mensagem: 'Telefone é obrigatório', code: 'TELEFONE_OBRIGATORIO' });
      }
      const enderecoTrim = { cep: String(cep ?? '').trim(), endereco: String(endereco ?? '').trim(), bairro: String(bairro ?? '').trim(), cidade: String(cidade ?? '').trim(), estado: String(estado ?? '').trim() };
      if (!enderecoTrim.cep || !enderecoTrim.endereco || !enderecoTrim.bairro || !enderecoTrim.cidade || !enderecoTrim.estado) {
        return res.status(400).json({ sucesso: false, mensagem: 'Endereço é obrigatório (CEP, logradouro, bairro, cidade e UF).', code: 'ENDERECO_OBRIGATORIO' });
      }

      // PLANO obrigatório e ativo — a empresa nasce com uma assinatura.
      const planoIdNum = Number(planoId);
      if (!Number.isInteger(planoIdNum)) {
        return res.status(400).json({ sucesso: false, mensagem: 'Selecione um plano para o gestor.', code: 'PLANO_OBRIGATORIO' });
      }
      const plano = await prisma.plano.findUnique({ where: { id: planoIdNum }, select: { id: true, ativo: true, validadeDias: true } });
      if (!plano || !plano.ativo) return res.status(400).json({ sucesso: false, mensagem: 'Plano inválido ou inativo.' });

      // Resolve/cria o usuário gestor (find-or-create por e-mail, como o membro direto).
      // Usuário novo nasce VETERINARIO com senha padrão + troca obrigatória. Usuário que
      // JÁ existia mantém os próprios dados — o telefone/endereço digitados aqui só valem
      // para conta nova; quem já tem login administra o próprio cadastro.
      const SENHA_INICIAL = 'Inicial_001';
      const emailNorm = normalizeEmail(emailTrim);
      let usuario = await findUserByEmail(prisma, emailNorm);
      let usuarioNovo = false;
      if (!usuario) {
        usuario = await prisma.user.create({
          data: {
            fullName: fullNameTrim,
            email:    emailNorm,
            phone:    telefoneTrim,
            cep:               enderecoTrim.cep,
            endereco:          enderecoTrim.endereco,
            complemento:       String(complemento ?? '').trim() || null,
            bairro:            enderecoTrim.bairro,
            cidade:            enderecoTrim.cidade,
            estado:            enderecoTrim.estado.toUpperCase(),
            passwordHash: await bcrypt.hash(SENHA_INICIAL, 10),
            role:     'USER',
            userType: 'VETERINARIO',
            mustChangePassword: true,
          },
        });
        usuarioNovo = true;
      }
      const donoId = usuario.id;

      // Nome da empresa nasce PLACEHOLDER — o gestor troca isso na primeira visita a
      // Cadastro da Empresa (obrigatório pelo gate de onboarding, ver ProtectedRoute).
      // Equipe herda o mesmo nome por ora (regra 36-d).
      const nomePlaceholder = `Empresa de ${usuario.fullName}`;

      const fimEm = plano.validadeDias ? new Date(Date.now() + plano.validadeDias * 86400000) : null;

      // ⚠️ Sob ESCOPO DE PLATAFORMA: criar uma empresa NOVA insere linhas em tabelas com
      // RLS (equipe, membro, usuario_empresa) cujo `empresaId` é o da empresa recém-criada
      // — que NÃO é o tenant do contexto do ADMIN. O `WITH CHECK` das policies recusaria
      // (`empresa_id = app_empresa_id()` falha). Criar tenant é operação de plataforma.
      const empresa = await comEscopoPlataforma(() => prisma.$transaction(async (tx) => {
        const emp = await tx.empresa.create({
          data: {
            nome:    nomePlaceholder,
            ownerId: donoId,
            // cnpj/documento/telefone/endereco ficam null — o Gestor preenche depois.
          },
        });
        const equipe = await tx.equipe.create({ data: { nome: nomePlaceholder, empresaId: emp.id } });
        await tx.membroEquipe.create({ data: { equipeId: equipe.id, userId: donoId, cargo: 'GESTOR' } });
        await salvarVinculo(tx, donoId, emp.id, { perfil: 'GESTOR' });
        // Assinatura: liga a empresa ao plano, com o vencimento derivado da validade.
        await tx.assinaturaEmpresa.create({
          data: { empresaId: emp.id, planoId: plano.id, status: 'ATIVA', fimEm },
        });
        // Configuração nasce VAZIA (sem espécies) — documento ainda não existe, então o
        // escopo é o da "empresa pessoal" (equipe) por ora; o Gestor migra isso ao
        // informar o CNPJ, se for o caso (ver EmpresaCadastroController.salvar).
        await tx.empresaConfiguracao.create({
          data: { empresaId: emp.id, equipeId: equipe.id },
        });
        return emp;
      }));
      // Instância de WhatsApp exclusiva da clínica (Evolution API) — best-effort.
      require('../services/whatsappService').provisionarPorEmpresa(empresa.id).catch(() => {});

      // O gestor precisa SABER que tem acesso — e, se a conta nasceu agora, com qual
      // senha. Fire-and-forget: falha de e-mail não desfaz o gestor já criado.
      emailService.enviarAcessoGestor({
        email:        usuario.email,
        nomeGestor:   usuario.fullName || usuario.email,
        empresaNome:  empresa.nome,
        equipeName:   nomePlaceholder,
        usuarioCriado: usuarioNovo,
        senhaInicial:  usuarioNovo ? SENHA_INICIAL : null,
      }).catch(err => console.error('[emailService] Falha ao enviar acesso de gestor:', err?.message));

      res.status(201).json({ sucesso: true, dados: empresa });
    } catch (err) {
      console.error('Erro ao criar gestor:', err);
      if (err.code === 'P2002') {
        return res.status(409).json({
          sucesso:  false,
          mensagem: 'Já existe uma empresa com este nome para este gestor.',
          code:     'EMPRESA_DUPLICADA',
        });
      }
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // PATCH /equipes/empresas/:id/status — ADMIN inativa/reativa a empresa.
  // `Empresa.status` governa o ACESSO (SUSPENSA/CANCELADA barram o login — D3); a
  // assinatura só descreve a situação comercial. Empresa inativada some do seletor de
  // contexto de todos (menos o dono, que nunca se tranca para fora — ver meusContextos).
  alterarStatusEmpresa: async (req, res) => {
    try {
      const id = Number(req.params.id);
      const STATUS_VALIDOS = ['ATIVA', 'SUSPENSA', 'CANCELADA'];
      const status = String(req.body?.status || '').toUpperCase();
      if (!STATUS_VALIDOS.includes(status)) {
        return res.status(400).json({ sucesso: false, mensagem: 'Status inválido (ATIVA | SUSPENSA | CANCELADA).' });
      }
      const empresa = await prisma.empresa.findUnique({ where: { id }, select: { id: true } });
      if (!empresa) return res.status(404).json({ sucesso: false, mensagem: 'Empresa não encontrada' });

      const atualizada = await prisma.empresa.update({
        where: { id },
        data:  { status, canceladoEm: status === 'ATIVA' ? null : new Date() },
        select: { id: true, nome: true, status: true, canceladoEm: true },
      });
      res.json({ sucesso: true, dados: atualizada });
    } catch (err) {
      console.error('[EquipeController.alterarStatusEmpresa]', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao alterar o status da empresa' });
    }
  },

  listarEmpresas: async (req, res) => {
    try {
      const userId = req.user.id;

      // ⚠️ O ADMIN da PLATAFORMA vê TODAS as empresas. Ele é quem as cria (POST
      // /equipes/empresas é authorize('ADMIN')), mas não é dono nem gestor de nenhuma —
      // com o filtro de posse a tela de criação abria com a lista VAZIA, sem nenhum
      // cliente à vista. Quem administra o SaaS precisa enxergar a carteira inteira.
      // `role`/`userTypeGlobal`, NUNCA `userType`: este é o tipo na EMPRESA ATIVA e vira
      // GESTOR/VETERINARIO conforme o vínculo (armadilha 36-e).
      // Sem escopoPlataformaSeAdmin de propósito: `tb_empresas` é CONTROL PLANE e não
      // tem RLS (ver o cabeçalho de escopoPlataforma.js).
      const ehAdminPlataforma = req.user.role === 'ADMIN' || req.user.userTypeGlobal === 'ADMIN';

      let where;
      if (ehAdminPlataforma) {
        where = {};
      } else {
        // Empresas onde é owner OU onde é gestor convidado (cargo: 'GESTOR')
        const membroGestor = await prisma.membroEquipe.findMany({
          where:   { userId, cargo: 'GESTOR' },
          select:  { equipe: { select: { empresaId: true } } },
        });
        const empresaIdsGestor = membroGestor.map(m => m.equipe.empresaId).filter(Boolean);
        where = { OR: [{ ownerId: userId }, { id: { in: empresaIdsGestor } }] };
      }

      const buscarEmpresas = () => prisma.empresa.findMany({
        where,
        include: {
          // ⚠️ `equipes`, `configuracoes` e `assinatura` são tabelas com RLS FORÇADO
          // (tb_equipes, tb_empresa_configuracoes, tb_assinaturas_empresa). O ADMIN da
          // plataforma navega SEM `req.empresaId` (não está "dentro" de nenhuma
          // empresa), então `tenantRls` não carimba tenant nenhum e a policy filtra
          // essas relações para VAZIO — a empresa em si aparece (tb_empresas não tem
          // RLS), mas equipe, espécie e plano vinham sempre nulos. Por isso a consulta
          // roda dentro de `comEscopoPlataforma` quando é o ADMIN pedindo.
          equipes: { include: { _count: { select: { membros: true } } } },
          // Espécies atendidas para a tela de edição preencher os campos. Vem a
          // configuração de QUALQUER escopo (empresa ou equipe) — a tela lê a primeira
          // que tenha espécies, e é o backend que decide onde gravar de volta.
          configuracoes: { select: { equipeId: true, especiesAtendidas: true } },
          // Plano atual, para a tela de edição pré-selecionar o mesmo formulário da
          // criação. Legado sem assinatura → null, a tela mostra "Selecione".
          assinatura: { select: { planoId: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      const empresas = ehAdminPlataforma ? await comEscopoPlataforma(buscarEmpresas) : await buscarEmpresas();
      res.json({ sucesso: true, dados: empresas });
    } catch (err) {
      console.error('Erro ao listar empresas:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // GET /equipes/meus-contextos
  // Opções de contexto ativo do usuário logado — TODOS os vínculos, não só de gestor:
  // empresas onde é dono + equipes onde tem cargo (GESTOR, VETERINARIO, FORNECEDOR...).
  // Permite que um usuário multi-perfil (ex: FORNECEDOR numa equipe que assinou a
  // aplicação e virou GESTOR da própria empresa) alterne entre os perfis no Sidebar.
  // Empresa CNPJ → opção no nível da empresa; empresa pessoal (CPF) → opção por equipe.
  meusContextos: async (req, res) => {
    try {
      const userId = req.user.id;

      const CARGO_LABEL = {
        GESTOR: 'Gestor', VETERINARIO: 'Veterinário', ESTAGIARIO: 'Estagiário',
        FORNECEDOR: 'Fornecedor', SECRETARIA: 'Secretária', FINANCEIRO: 'Financeiro',
        ENFERMEIRO: 'Enfermeiro',
      };
      const labelCargo = c => CARGO_LABEL[c] ?? (c ? c.charAt(0) + c.slice(1).toLowerCase() : '');

      // 🔴 LEITURA CROSS-EMPRESA, escopada ao PRÓPRIO usuário. "Quais empresas eu
      // pertenço" atravessa tenants por natureza: `membroEquipe`/`animal`/
      // `proprietarioPerfil` têm RLS por empresa, então sob o carimbo da empresa ATIVA
      // (que o `authenticate` já aplicou) esta lista via só ela — e o profissional
      // multi-clínica (ex.: membro de 5 empresas) via 1 opção no seletor e não
      // conseguia TROCAR para as outras 4 pela UI. `comEscopoPlataforma` levanta o
      // filtro de tenant; o `where: { userId }` de CADA query é o que mantém a leitura
      // restrita aos vínculos DESTA pessoa — nunca os de terceiros.
      const [empresasOwned, membros] = await comEscopoPlataforma(() => Promise.all([
        prisma.empresa.findMany({
          where:   { ownerId: userId },
          select:  { id: true, nome: true, cnpj: true, cidade: true, estado: true, equipes: { select: { id: true, nome: true }, orderBy: { id: 'asc' } } },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.membroEquipe.findMany({
          where:   { userId },
          select:  { cargo: true, equipe: { select: { id: true, nome: true, empresa: { select: { id: true, nome: true, cnpj: true, ownerId: true, cidade: true, estado: true } } } } },
          orderBy: { createdAt: 'asc' },
        }),
      ]));

      // Empresa que revogou o acesso desta pessoa não aparece no seletor — ela não
      // deve poder trabalhar por lá nem saber que o vínculo segue cadastrado.
      // O dono nunca é barrado da própria empresa (senão ele se trancaria para fora).
      // Também cross-empresa (lê tb_usuario_empresa por user_id) — já se auto-escopa
      // com `comEscopoPlataforma` dentro da própria função (lib/usuarioEmpresa).
      const semAcesso = await empresasSemAcesso(userId);
      const idsProprios = new Set(empresasOwned.map(e => e.id));

      const opcoes = [];
      const visto  = new Set();
      // Empresas que já ganharam uma opção Gestor/cargo (dono OU membro de equipe),
      // independente de QUAL equipe — usado só para barrar o bloco PROPRIETÁRIO
      // abaixo (ver ali). Precisa ser por EMPRESA, não por (empresa,equipe): o
      // cadastro de cliente não tem granularidade de equipe (ProprietarioPerfil/
      // Animal são por empresa), então "equipeId: null" do bloco cliente não bate
      // com o equipeId ESPECÍFICO de uma opção Gestor/cargo — dedupe só por chave
      // (empresaId:equipeId) deixava a opção "· Proprietário" vazar sempre que o
      // vínculo profissional daquela empresa tinha equipeId != null (qualquer
      // cargo não-GESTOR, e GESTOR de empresa ainda sem documento/CNPJ — ver
      // `criarGestor`, que hoje nasce tratada como "empresa pessoal" até o Cadastro
      // da Empresa ser preenchido).
      const empresasComPapelProfissional = new Set();
      const add = (o) => {
        if (semAcesso.has(o.empresaId) && !idsProprios.has(o.empresaId)) return;
        // Chave por (empresaId, equipeId) — DE PROPÓSITO sem o cargo. Mais de um
        // papel na mesma empresa (ex.: dona que TAMBÉM é cliente dela) não vira duas
        // opções no seletor: as permissões já somam automaticamente por trás
        // (`EquipeController.minhasPermissoes`/`checkPermission` — ver `ajusteperfil`
        // na memória). O seletor é para trocar de EMPRESA (multi-tenant), não de
        // papel dentro da mesma empresa.
        const k = `${o.empresaId}:${o.equipeId ?? ''}`;
        if (visto.has(k)) return;
        visto.add(k);
        opcoes.push(o);
      };

      // Empresas próprias: dono = gestor delas
      for (const emp of empresasOwned) {
        empresasComPapelProfissional.add(emp.id);
        if (!emp.cnpj && emp.equipes.length > 0) {
          for (const eq of emp.equipes) {
            add({ empresaId: emp.id, equipeId: eq.id, nome: eq.nome, label: `${eq.nome} · Gestor`, cargo: 'GESTOR', cidade: emp.cidade, estado: emp.estado });
          }
        } else {
          add({ empresaId: emp.id, equipeId: null, nome: emp.nome, label: `${emp.nome} · Gestor`, cargo: 'GESTOR', cidade: emp.cidade, estado: emp.estado });
        }
      }

      // Vínculos de equipe (gestor convidado e cargos não-gestores)
      for (const m of membros) {
        const emp = m.equipe?.empresa;
        if (!emp) continue;
        if (emp.ownerId === userId) continue; // já coberto acima
        empresasComPapelProfissional.add(emp.id);
        if (m.cargo === 'GESTOR' && emp.cnpj) {
          add({ empresaId: emp.id, equipeId: null, nome: emp.nome, label: `${emp.nome} · Gestor`, cargo: 'GESTOR', cidade: emp.cidade, estado: emp.estado });
        } else {
          add({ empresaId: emp.id, equipeId: m.equipe.id, nome: m.equipe.nome, label: `${m.equipe.nome} · ${labelCargo(m.cargo)}`, cargo: m.cargo, cidade: emp.cidade, estado: emp.estado });
        }
      }

      // ── PROPRIETÁRIO: uma opção por EMPRESA em que a pessoa é SÓ cliente ──────
      // Mesmo modelo do vet que é gestor numa empresa e prestador em outra: ele
      // escolhe a clínica e vê o que aquela clínica liberou (permissões resolvidas
      // pela empresa ativa) e o cadastro que aquela clínica mantém dele
      // (lib/proprietarioPerfil). Isolamento multi-tenant entre empresas diferentes
      // continua valendo à risca — isto NUNCA soma nada entre empresas distintas.
      //
      // ⚠️ Gate por `userType !== 'ADMIN'` (não `userType === 'PROPRIETARIO'`) e
      // busca por USUÁRIO, não pelo contexto ativo — acha cliente em QUALQUER
      // empresa da pessoa, inclusive as que ela também gerencia/atende como
      // profissional. Nessas, `empresasComPapelProfissional` já marcou a empresa e
      // o `add()` abaixo nem chega a ser chamado — é o `minhasPermissoes`/
      // `checkPermission` que soma a Matriz do PROPRIETARIO por trás (ver
      // `ajusteperfil`), não uma segunda entrada no seletor. Checar o Set aqui (e
      // não confiar só no dedupe por chave dentro de `add()`) é o que cobre a
      // empresa pessoal/sem documento ainda (Gestor com `equipeId` específico) e o
      // cargo não-GESTOR (equipeId da equipe) — nenhum dos dois bate com o
      // `equipeId: null` fixo que o cadastro de cliente usa.
      if (req.user.userType !== 'ADMIN') {
        // Mesmo caso: o cliente atendido por várias clínicas precisa ver todas no
        // seletor. `animal`/`proprietarioPerfil` têm RLS por empresa → escopo de
        // plataforma + `where: { userId }` (só os vínculos deste cliente).
        const [animais, perfis] = await comEscopoPlataforma(() => Promise.all([
          prisma.animal.findMany({
            // `empresaId: { not: null }` REMOVIDO — coluna NOT NULL desde a fase 5
            // torna o filtro inválido no Prisma (ver auth.js/permissao.middleware).
            where:  { userId, ativo: true },
            select: { empresa: { select: { id: true, nome: true, cidade: true, estado: true } } },
          }),
          prisma.proprietarioPerfil.findMany({
            where:  { userId, ativo: true },
            select: { empresa: { select: { id: true, nome: true, cidade: true, estado: true } } },
          }),
        ]));
        const empresasDoCliente = new Map();
        for (const r of [...animais, ...perfis]) {
          if (r.empresa) empresasDoCliente.set(r.empresa.id, r.empresa);
        }
        for (const emp of empresasDoCliente.values()) {
          if (empresasComPapelProfissional.has(emp.id)) continue;
          add({ empresaId: emp.id, equipeId: null, nome: emp.nome, label: `${emp.nome} · Proprietário`, cargo: 'PROPRIETARIO', cidade: emp.cidade, estado: emp.estado });
        }
      }

      res.json({ sucesso: true, dados: opcoes });
    } catch (err) {
      console.error('Erro ao listar contextos do usuário:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Configurações (logotipo + dia de fechamento de fatura) ────────────────────
  // Única por empresa (CNPJ) ou por equipe (empresa pessoal) — ver resolverEscopoConfiguracao.
  // Sem checagem de role explícita: getEmpresaDoGestor só resolve empresa para quem é
  // ownerId ou tem cargo GESTOR — não-gestor cai em 404 naturalmente (mesmo padrão de
  // renomearEquipe/listarEmpresas).

  obterConfiguracao: async (req, res) => {
    try {
      const escopo = await resolverEscopoConfiguracao(req);
      if (!escopo) return res.status(404).json({ sucesso: false, mensagem: 'Empresa não encontrada' });

      const config = await buscarConfiguracao(escopo);

      // Fuso EFETIVO da clínica, deduzido do endereço (CEP/UF). Read-only na tela:
      // o gestor não escolhe fuso, só confere o que foi detectado.
      const fusoDetectado = await fusoDaEmpresa(escopo.empresaId);

      // Plano da empresa (SOMENTE LEITURA para o gestor — quem edita é o ADMIN).
      // Só nome + valor aparecem na tela; validade/vencimento vão junto para exibição.
      const assinatura = escopo.empresaId
        ? await prisma.assinaturaEmpresa.findUnique({
            where:  { empresaId: escopo.empresaId },
            select: { status: true, fimEm: true, plano: { select: { nome: true, precoMensal: true, limiteUsuarios: true, validadeDias: true } } },
          })
        : null;

      // Mesma resolução de compat que deveFecharHoje (faturaUtils.js): nunca retorna
      // tipoFechamento null pro frontend — sempre o efetivamente aplicado hoje.
      const tipoFechamentoEfetivo = config?.tipoFechamento
        ?? (config?.diaFechamentoFatura != null ? 'DIA_FIXO' : 'ULTIMO_DIA_MES');

      res.json({
        sucesso: true,
        dados: {
          // true = já existe registro salvo (gestor completou Configurações ao
          // menos uma vez) — usado pelo ProtectedRoute no gate de primeiro acesso.
          configurado:         !!config,
          logoUrl:             config?.logoUrl             ?? null,
          tipoFechamento:      tipoFechamentoEfetivo,
          diaFechamentoFatura: config?.diaFechamentoFatura  ?? null,
          whatsapp:            config?.whatsapp             ?? null,
          diasAtendimento:       config?.diasAtendimento       ?? null,
          horaInicioAtendimento: config?.horaInicioAtendimento ?? null,
          horaFimAtendimento:    config?.horaFimAtendimento    ?? null,
          especiesAtendidas:     parseEspeciesAtendidas(config?.especiesAtendidas),
          // null = ainda não configurado; o sistema aplica TEMPO_CONSULTA_PADRAO_SISTEMA
          tempoConsultaPadraoMin: config?.tempoConsultaPadraoMin ?? null,
          tempoConsultaPadraoSistema: TEMPO_CONSULTA_PADRAO_SISTEMA,
          // null = sem validade (o orçamento não expira)
          validadeOrcamentoDias: config
            ? await lerValidade(prisma, escopo.empresaId, escopo.equipeId)
            : null,
          // Fuso EFETIVO da clínica — DEDUZIDO do endereço (CEP/UF) que o cadastro
          // já coletou. O gestor não escolhe fuso: a tela só EXIBE qual foi detectado,
          // para ele conferir. Ver lib/fusoEmpresa.js#fusoPorEndereco.
          fusoHorario: fusoDetectado,
          fusoLabel:   rotuloFuso(fusoDetectado),
          // PLANO da empresa (read-only p/ gestor) — null se a empresa não tem assinatura.
          plano: assinatura?.plano
            ? {
                nome:           assinatura.plano.nome,
                valor:          assinatura.plano.precoMensal,
                limiteUsuarios: assinatura.plano.limiteUsuarios,
                validadeDias:   assinatura.plano.validadeDias,
                status:         assinatura.status,
                fimEm:          assinatura.fimEm,
              }
            : null,
        },
      });
    } catch (err) {
      console.error('Erro ao obter configuração:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // Espécies atendidas pela empresa do contexto ativo — leitura para QUALQUER membro
  // (usado no Cadastro Pessoal do membro convidado para filtrar as especialidades).
  obterEspeciesAtendidas: async (req, res) => {
    try {
      const especies = await resolverEspeciesAtendidas(req, req.query.equipeId ? Number(req.query.equipeId) : null);
      return res.json({ sucesso: true, dados: { especiesAtendidas: especies } });
    } catch (err) {
      console.error('Erro ao obter espécies atendidas:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // Expediente de atendimento do contexto ativo — leitura para QUALQUER membro
  // (usado pelo Agendamento para liberar apenas os horários configurados).
  obterHorarioAtendimento: async (req, res) => {
    try {
      const escopo = await resolverEscopoConfiguracaoMembro(req);
      // tempoConsultaPadrao vem sempre resolvido (nunca null): é o que a Agenda e o
      // cadastro de locais usam para a especialidade sem tempo próprio.
      const vazio = {
        diasAtendimento: null, horaInicioAtendimento: null, horaFimAtendimento: null,
        tempoConsultaPadrao: TEMPO_CONSULTA_PADRAO_SISTEMA,
      };
      if (!escopo) return res.json({ sucesso: true, dados: vazio });
      const config = await buscarConfiguracao(escopo);
      const tempoPadrao = Number(config?.tempoConsultaPadraoMin);
      return res.json({
        sucesso: true,
        dados: {
          diasAtendimento:       config?.diasAtendimento       ?? null,
          horaInicioAtendimento: config?.horaInicioAtendimento ?? null,
          horaFimAtendimento:    config?.horaFimAtendimento    ?? null,
          tempoConsultaPadrao:   Number.isInteger(tempoPadrao) && tempoPadrao > 0
            ? tempoPadrao : TEMPO_CONSULTA_PADRAO_SISTEMA,
        },
      });
    } catch (err) {
      console.error('Erro ao obter horário de atendimento:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // Logotipo + nome da empresa do contexto ativo — leitura por QUALQUER membro
  // (usado pelo Sidebar para exibir a logomarca no lugar do texto padrão).
  obterLogo: async (req, res) => {
    try {
      const escopo = await resolverEscopoConfiguracaoMembro(req);
      // `fusoHorario` viaja JUNTO da marca de propósito: esta é a única rota de
      // configuração que QUALQUER membro pode ler (`/equipes/configuracoes` é
      // gestor-only), e o fuso precisa chegar à enfermeira que abre o plantão, não
      // só a quem administra a clínica. null = empresa não escolheu → o front usa o
      // fuso do dispositivo, como sempre fez.
      const vazio = { logoUrl: null, empresaNome: null, fusoHorario: null };
      if (!escopo) return res.json({ sucesso: true, dados: vazio });
      const [config, empresa, fuso] = await Promise.all([
        buscarConfiguracao(escopo),
        prisma.empresa.findUnique({ where: { id: escopo.empresaId }, select: { nome: true } }),
        fusoDaEmpresa(escopo.empresaId).catch(() => null),
      ]);
      return res.json({
        sucesso: true,
        dados: {
          logoUrl:     config?.logoUrl ?? null,
          empresaNome: empresa?.nome ?? null,
          fusoHorario: fuso ?? null,
        },
      });
    } catch (err) {
      console.error('Erro ao obter logo:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  salvarConfiguracao: async (req, res) => {
    try {
      const escopo = await resolverEscopoConfiguracao(req);
      if (!escopo) return res.status(404).json({ sucesso: false, mensagem: 'Empresa não encontrada' });

      const {
        tipoFechamento, diaFechamentoFatura, removerLogo, whatsapp,
        diasAtendimento, horaInicioAtendimento, horaFimAtendimento,
        especiesAtendidas, tempoConsultaPadraoMin, validadeOrcamentoDias, fusoHorario,
      } = req.body;

      // Fuso da clínica. undefined = não altera; vazio = volta ao padrão do sistema.
      const fuso = normalizarFuso(fusoHorario);
      if (fuso.erro) return res.status(400).json({ sucesso: false, mensagem: fuso.erro });
      const fusoFinal = fuso.valor;

      // Validade do orçamento em dias. undefined = não altera; vazio = sem validade.
      const validade = normalizarValidade(validadeOrcamentoDias);
      if (validade.erro) return res.status(400).json({ sucesso: false, mensagem: validade.erro });
      const validadeFinal = validade.valor;

      // Tempo de consulta padrão da empresa. undefined = não altera; vazio = remove
      // (volta ao padrão do sistema). Mesmas regras do tempo por especialidade.
      let tempoPadraoFinal;
      if (tempoConsultaPadraoMin !== undefined) {
        const s = String(tempoConsultaPadraoMin).trim();
        if (s === '') {
          tempoPadraoFinal = null;
        } else {
          const n = Number(s);
          if (!Number.isInteger(n) || n < TEMPO_CONSULTA_MIN || n > TEMPO_CONSULTA_MAX || n % 5 !== 0) {
            return res.status(400).json({
              sucesso: false,
              mensagem: `Tempo de consulta padrão inválido — informe múltiplos de 5 entre ${TEMPO_CONSULTA_MIN} e ${TEMPO_CONSULTA_MAX} minutos.`,
            });
          }
          tempoPadraoFinal = n;
        }
      }

      // Espécies atendidas — aceita array [1,2] ou CSV "1,2". undefined = não altera.
      // OBRIGATÓRIO quando informado: sem espécie, o cadastro de profissionais não tem
      // de onde tirar as especialidades. Persiste como CSV de IDs.
      let especiesFinal;
      if (especiesAtendidas !== undefined) {
        const arr = Array.isArray(especiesAtendidas)
          ? especiesAtendidas
          : String(especiesAtendidas).split(',').map(s => s.trim()).filter(Boolean);
        const nums = [...new Set(arr.map(Number))].filter(Number.isInteger).sort((a, b) => a - b);
        if (!nums.length) {
          return res.status(400).json({ sucesso: false, mensagem: 'Selecione ao menos uma espécie atendida.' });
        }
        especiesFinal = nums.join(',');
      }

      // WhatsApp da empresa — normaliza para somente dígitos (DDD+número, DDI opcional).
      // undefined = não altera; string vazia = remove o número.
      let whatsappFinal;
      if (whatsapp !== undefined) {
        const digitos = String(whatsapp).replace(/\D/g, '');
        if (digitos === '') {
          whatsappFinal = null;
        } else if (digitos.length < 10 || digitos.length > 15) {
          return res.status(400).json({ sucesso: false, mensagem: 'WhatsApp inválido — informe DDD + número (10 a 15 dígitos).' });
        } else {
          whatsappFinal = digitos;
        }
      }

      // Expediente de atendimento. undefined = não altera. OBRIGATÓRIO quando informado:
      // é dele que a Agenda gera a grade de horários — sem dia ou sem faixa não há grade.
      const parseHora = (v) => {
        if (v === undefined) return undefined;
        const s = String(v).trim();
        if (s === '') throw new Error('Informe o horário de abertura e de fechamento.');
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw new Error('Horário de atendimento inválido — use HH:MM.');
        return s;
      };
      let diasFinal;
      if (diasAtendimento !== undefined) {
        // Aceita array [1,2,..] ou CSV "1,2,..".
        const arr = Array.isArray(diasAtendimento)
          ? diasAtendimento
          : String(diasAtendimento).split(',').map(s => s.trim()).filter(Boolean);
        if (arr.length === 0) {
          return res.status(400).json({ sucesso: false, mensagem: 'Selecione ao menos um dia de atendimento.' });
        }
        const nums = [...new Set(arr.map(Number))].sort((a, b) => a - b);
        if (nums.some(n => !Number.isInteger(n) || n < 0 || n > 6)) {
          return res.status(400).json({ sucesso: false, mensagem: 'Dias de atendimento inválidos (0=Dom … 6=Sáb).' });
        }
        diasFinal = nums.join(',');
      }
      let horaInicioFinal, horaFimFinal;
      try {
        horaInicioFinal = parseHora(horaInicioAtendimento);
        horaFimFinal    = parseHora(horaFimAtendimento);
      } catch (e) {
        return res.status(400).json({ sucesso: false, mensagem: e.message });
      }
      if (horaInicioFinal && horaFimFinal && horaInicioFinal >= horaFimFinal) {
        return res.status(400).json({ sucesso: false, mensagem: 'A hora de início deve ser menor que a de término.' });
      }

      let tipoFinal;
      let diaFinal;
      if (tipoFechamento === undefined) {
        tipoFinal = undefined; // não altera
        diaFinal  = undefined;
      } else {
        if (!TIPOS_FECHAMENTO_VALIDOS.includes(tipoFechamento)) {
          return res.status(400).json({ sucesso: false, mensagem: `tipoFechamento deve ser um de: ${TIPOS_FECHAMENTO_VALIDOS.join(', ')}` });
        }
        tipoFinal = tipoFechamento;

        if (tipoFechamento === 'ULTIMO_DIA_MES') {
          diaFinal = null; // ignora qualquer valor enviado
        } else {
          const n = Number(diaFechamentoFatura);
          // Dia fixo limitado a 28 para existir em todos os meses do ano.
          const limite = tipoFechamento === 'DIA_UTIL' ? 10 : 28;
          if (!Number.isInteger(n) || n < 1 || n > limite) {
            return res.status(400).json({
              sucesso: false,
              mensagem: tipoFechamento === 'DIA_UTIL'
                ? 'Para dia útil, informe um número entre 1 e 10.'
                : 'Para dia fixo, informe um número entre 1 e 28.',
            });
          }
          diaFinal = n;
        }
      }

      const existente = await buscarConfiguracao(escopo);

      let logoUrlFinal;
      if (req.file) {
        logoUrlFinal = await storage.upload(req.file, 'empresas', {
          empresaId:   escopo?.empresaId ?? req.empresaId ?? null,
          criadoPorId: req.user?.id ?? null,
        });
        if (existente?.logoUrl) await storage.delete(existente.logoUrl);
      } else if (removerLogo === 'true' || removerLogo === true) {
        if (existente?.logoUrl) await storage.delete(existente.logoUrl);
        logoUrlFinal = null;
      }

      // Não usar upsert: Prisma rejeita null em chave única composta (empresa CNPJ = equipeId null).
      const config = existente
        ? await prisma.empresaConfiguracao.update({
            where: { id: existente.id },
            data: {
              ...(tipoFinal     !== undefined && { tipoFechamento: tipoFinal, diaFechamentoFatura: diaFinal }),
              ...(logoUrlFinal  !== undefined && { logoUrl: logoUrlFinal }),
              ...(whatsappFinal !== undefined && { whatsapp: whatsappFinal }),
              ...(diasFinal        !== undefined && { diasAtendimento: diasFinal }),
              ...(horaInicioFinal  !== undefined && { horaInicioAtendimento: horaInicioFinal }),
              ...(horaFimFinal     !== undefined && { horaFimAtendimento: horaFimFinal }),
              ...(especiesFinal    !== undefined && { especiesAtendidas: especiesFinal }),
              ...(tempoPadraoFinal !== undefined && { tempoConsultaPadraoMin: tempoPadraoFinal }),
            },
          })
        : await prisma.empresaConfiguracao.create({
            data: {
              empresaId:           escopo.empresaId,
              equipeId:            escopo.equipeId,
              tipoFechamento:      tipoFinal ?? null,
              diaFechamentoFatura: diaFinal  ?? null,
              logoUrl:             logoUrlFinal ?? null,
              whatsapp:            whatsappFinal ?? null,
              diasAtendimento:       diasFinal       ?? null,
              horaInicioAtendimento: horaInicioFinal ?? null,
              horaFimAtendimento:    horaFimFinal    ?? null,
              especiesAtendidas:     especiesFinal   ?? null,
              tempoConsultaPadraoMin: tempoPadraoFinal ?? null,
            },
          });

      // Validade do orçamento: gravada por SQL cru DEPOIS do upsert (a linha já existe).
      // Ver lib/validadeOrcamento.js para o porquê de não ir junto no update/create.
      await salvarValidade(prisma, escopo.empresaId, escopo.equipeId, validadeFinal);
      const validadeAtual = validadeFinal !== undefined
        ? validadeFinal
        : await lerValidade(prisma, escopo.empresaId, escopo.equipeId);

      // Fuso: o gestor NÃO envia este campo (a tela só exibe o detectado), então
      // `fusoFinal` é `undefined` no fluxo normal e nada é gravado. O caminho de
      // escrita segue existindo como OVERRIDE do ADMIN para o caso raro em que o
      // endereço não decide sozinho (extremo oeste do AM). Ver lib/fusoEmpresa.js.
      await salvarFuso(prisma, escopo.empresaId, escopo.equipeId, fusoFinal);
      const fusoAtual = await fusoDaEmpresa(escopo.empresaId);

      res.json({
        sucesso: true,
        dados: {
          logoUrl:             config.logoUrl,
          tipoFechamento:      config.tipoFechamento ?? (config.diaFechamentoFatura != null ? 'DIA_FIXO' : 'ULTIMO_DIA_MES'),
          diaFechamentoFatura: config.diaFechamentoFatura,
          whatsapp:            config.whatsapp,
          diasAtendimento:       config.diasAtendimento,
          horaInicioAtendimento: config.horaInicioAtendimento,
          horaFimAtendimento:    config.horaFimAtendimento,
          especiesAtendidas:     parseEspeciesAtendidas(config.especiesAtendidas),
          tempoConsultaPadraoMin: config.tempoConsultaPadraoMin ?? null,
          tempoConsultaPadraoSistema: TEMPO_CONSULTA_PADRAO_SISTEMA,
          validadeOrcamentoDias:  validadeAtual,
          fusoHorario:            fusoAtual,
          fusoLabel:              rotuloFuso(fusoAtual),
        },
      });
    } catch (err) {
      console.error('Erro ao salvar configuração:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Equipes ─────────────────────────────────────────────────────────────────

  criarEquipe: async (req, res) => {
    try {
      const { nome, empresaId } = req.body;
      if (!nome?.trim() || !empresaId) {
        return res.status(400).json({ sucesso: false, mensagem: 'nome e empresaId são obrigatórios' });
      }

      // Verifica se o usuário é owner ou gestor da empresa
      const userId    = req.user.id;
      const empresaId_n = Number(empresaId);
      const membro    = await prisma.membroEquipe.findFirst({
        where: { userId, cargo: 'GESTOR', equipe: { empresaId: empresaId_n } },
      });
      const empresa = await prisma.empresa.findFirst({
        where: { id: empresaId_n, OR: [{ ownerId: userId }, { id: membro ? empresaId_n : -1 }] },
      });
      if (!empresa) return res.status(404).json({ sucesso: false, mensagem: 'Empresa não encontrada' });

      // Duplicidade: nome de equipe único dentro da empresa
      const equipeDuplicada = await prisma.equipe.findFirst({
        where: { empresaId: empresaId_n, nome: { equals: nome.trim(), mode: 'insensitive' } },
      });
      if (equipeDuplicada) {
        return res.status(409).json({ sucesso: false, mensagem: 'Já existe uma equipe com este nome nesta empresa.' });
      }

      // A empresa nasce com UMA equipe (invariante do gestor — ver `criarEmpresa`).
      // Quando essa equipe ainda é a AUTOMÁTICA — nome igual ao da empresa, ou o
      // legado "Equipe Principal" — e está intocada (só o gestor, sem paciente e sem
      // convite), a equipe que o gestor criar RENOMEIA ela em vez de virar uma
      // segunda: é o nome que ele quer ver no seletor de contexto, e evita a empresa
      // ficar com "PatriciaVet" + a equipe automática.
      // O nome é o que distingue automática de escolhida: sem isso, TODA equipe nova
      // renomeava a única existente enquanto ela estivesse vazia, e o gestor perdia a
      // equipe anterior ao criar a segunda.
      const equipesDaEmpresa = await prisma.equipe.findMany({
        where:  { empresaId: empresaId_n },
        select: {
          id: true, nome: true,
          _count: { select: { membros: true, animais: true, convites: true } },
        },
      });
      const soUma = equipesDaEmpresa.length === 1 ? equipesDaEmpresa[0] : null;
      const nomeAutomatico = soUma && (
        soUma.nome.trim().toLowerCase() === empresa.nome.trim().toLowerCase()
        || soUma.nome.trim().toLowerCase() === 'equipe principal'
      );
      const inicialIntocada = nomeAutomatico
        && soUma._count.membros  <= 1
        && soUma._count.animais  === 0
        && soUma._count.convites === 0
        ? soUma
        : null;

      if (inicialIntocada) {
        const renomeada = await prisma.equipe.update({
          where: { id: inicialIntocada.id },
          data:  { nome: nome.trim() },
        });
        return res.status(200).json({ sucesso: true, dados: renomeada, renomeada: true });
      }

      const equipe = await prisma.equipe.create({
        data: { nome: nome.trim(), empresaId: empresaId_n },
      });
      res.status(201).json({ sucesso: true, dados: equipe });
    } catch (err) {
      console.error('Erro ao criar equipe:', err);
      if (err.code === 'P2002') return res.status(409).json({ sucesso: false, mensagem: 'Já existe uma equipe com este nome nesta empresa.' });
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Convites ─────────────────────────────────────────────────────────────────

  listarConvites: async (req, res) => {
    try {
      const selectBase = { id: true, email: true, cargo: true, status: true, createdAt: true, expiresAt: true };

      // ADMIN: todos os convites de todas as equipes
      if ((req.user.role === 'ADMIN' || req.user.userType === 'ADMIN')) {
        const convites = await prisma.conviteEquipe.findMany({
          orderBy: { createdAt: 'desc' },
          select:  { ...selectBase, equipe: { select: { nome: true, empresa: { select: { nome: true } } } } },
        });
        return res.json({ sucesso: true, dados: convites });
      }

      const vetUserId = req.user.id;
      const empresa   = await getEmpresaDoGestor(vetUserId, req.empresaId);
      if (!empresa) return res.json({ sucesso: true, dados: [] });

      const equipe = await getEquipeAtiva(empresa.id, req.equipeId);
      if (!equipe)  return res.json({ sucesso: true, dados: [] });

      const convites = await prisma.conviteEquipe.findMany({
        where:   { equipeId: equipe.id },
        orderBy: { createdAt: 'desc' },
        select:  { ...selectBase, equipe: { select: { nome: true, empresa: { select: { nome: true } } } } },
      });
      res.json({ sucesso: true, dados: convites });
    } catch (err) {
      console.error('Erro ao listar convites:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Renomear equipe (apenas gestores da equipe) ────────────────────────────────

  renomearEquipe: async (req, res) => {
    try {
      const equipeId = Number(req.params.equipeId);
      const { nome } = req.body;

      if (!nome?.trim()) {
        return res.status(400).json({ sucesso: false, mensagem: 'Nome da equipe é obrigatório.' });
      }

      // Verifica que o usuário é gestor da equipe (ADMIN tem acesso irrestrito)
      if ((req.user.role !== 'ADMIN' && req.user.userType !== 'ADMIN')) {
        const membro = await prisma.membroEquipe.findUnique({
          where: { equipeId_userId: { equipeId, userId: req.user.id } },
        });
        if (!membro || membro.cargo !== 'GESTOR') {
          return res.status(403).json({ sucesso: false, mensagem: 'Apenas gestores podem renomear a equipe.' });
        }
      }

      const equipe = await prisma.equipe.update({
        where: { id: equipeId },
        data:  { nome: nome.trim() },
        select: { id: true, nome: true },
      });

      return res.json({ sucesso: true, dados: equipe });
    } catch (err) {
      console.error('Erro ao renomear equipe:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Admin: todas as empresas com gestores e membros agrupados ─────────────────

  listarTodasEmpresasAdmin: async (req, res) => {
    try {
      if ((req.user.role !== 'ADMIN' && req.user.userType !== 'ADMIN')) {
        return res.status(403).json({ sucesso: false, mensagem: 'Acesso restrito a administradores.' });
      }

      const empresas = await prisma.empresa.findMany({
        orderBy: { createdAt: 'asc' },
        include: {
          equipes: {
            orderBy: { createdAt: 'asc' },
            include: {
              membros: {
                where:   { NOT: { user: { role: 'ADMIN' } } },
                orderBy: { createdAt: 'asc' },
                include: {
                  user: { select: { id: true, fullName: true, email: true, ativo: true } },
                },
              },
            },
          },
        },
      });

      // Ordena membros de cada equipe: GESTOR primeiro, depois alfabético
      const dados = empresas.map(emp => ({
        id:     emp.id,
        nome:   emp.nome,
        cnpj:   emp.cnpj ?? null,
        equipes: emp.equipes.map(eq => ({
          id:   eq.id,
          nome: eq.nome,
          membros: eq.membros.sort((a, b) => {
            if (a.cargo === 'GESTOR' && b.cargo !== 'GESTOR') return -1;
            if (b.cargo === 'GESTOR' && a.cargo !== 'GESTOR') return  1;
            return (a.user.fullName ?? '').localeCompare(b.user.fullName ?? '');
          }),
        })),
      }));

      return res.json({ sucesso: true, dados });
    } catch (err) {
      console.error('Erro ao listar todas as empresas:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Membros ─────────────────────────────────────────────────────────────────

  listarMembros: async (req, res) => {
    try {
      const vetUserId    = req.user.id;
      const equipeIdParam = req.query.equipeId ? Number(req.query.equipeId) : null;

      // ADMIN: acesso irrestrito a qualquer equipe
      if ((req.user.role === 'ADMIN' || req.user.userType === 'ADMIN')) {
        const todasEquipes = await prisma.equipe.findMany({
          include: { empresa: { select: { nome: true } } },
          orderBy: { createdAt: 'asc' },
        });
        const equipe = equipeIdParam
          ? todasEquipes.find(e => e.id === equipeIdParam)
          : todasEquipes[0];

        if (!equipe) {
          return res.json({ sucesso: true, dados: [], equipeId: null, isGestor: true, todasEquipes: [] });
        }

        const membros = await prisma.membroEquipe.findMany({
          where:   { equipeId: equipe.id, NOT: { user: { role: 'ADMIN' } } },
          include: {
            user:   { select: { id: true, fullName: true, email: true, phone: true, ativo: true, bloqueadoEm: true, createdAt: true, userType: true, cep: true, endereco: true, complemento: true, bairro: true, cidade: true, estado: true, fornecedorPerfil: { select: { tipoServico: true } }, vetPerfil: { select: { subespecialidades: { select: { nome: true } } } }, especialidades: { where: { empresaId: equipe.empresaId }, select: { especialidadeId: true, especialidade: { select: { id: true, nome: true } } } } } },
            equipe: { select: { nome: true } },
          },
          orderBy: { createdAt: 'desc' },
        });

        return res.json({
          sucesso: true,
          // Cadastro do profissional é o DESTA empresa (ver lib/profissionalPerfil.js).
          // A remuneração/acesso e a trilha de ativação/inativação vêm por fora
          // (colunas novas, SQL cru) para o formulário de edição reabrir com o que
          // já foi acordado, e para as colunas de "desde quando"/"por quem" das
          // abas Ativos/Inativos (ver Equipe.tsx).
          dados:        await anexarTrilhaAtivacaoEmRelacao(await anexarFotoEmRelacao(await anexarPagamentoEmRelacao(await aplicarPerfilProfEmRelacao(
            await anexarLocaisTrabalho(await anexarExpedienteTrabalho(await anexarPerfisGlobais(membros, { todos: true }))), // ADMIN da plataforma vê tudo
            'user', equipe.empresaId), 'user', equipe.empresaId), 'user', equipe.empresaId), 'user'),
          equipeId:     equipe.id,
          isGestor:      true,
          todasEquipes: todasEquipes.map(e => ({ id: e.id, nome: e.nome, empresaNome: e.empresa?.nome ?? '' })),
        });
      }

      // Owner OU gestor convidado (cargo: 'GESTOR') — ambos têm isGestor=true
      const empresa = await getEmpresaDoGestor(vetUserId, req.empresaId);
      const isGestor = !!empresa;

      if (!empresa) {
        // Não é gestor, mas PODE ser MEMBRO de uma equipe (ex.: vet convidado). Devolve o
        // roster da equipe dele (contexto ativo) para telas como a Agenda poderem listar
        // os profissionais — SEM privilégios de gestão (isGestor:false) e com dados enxutos
        // (sem contato) por privacidade. Isolado à equipe do próprio membro.
        let vinculo = null;
        if (equipeIdParam) {
          vinculo = await prisma.membroEquipe.findFirst({ where: { userId: vetUserId, equipeId: equipeIdParam }, select: { equipeId: true } });
        }
        if (!vinculo && req.equipeId) {
          vinculo = await prisma.membroEquipe.findFirst({ where: { userId: vetUserId, equipeId: Number(req.equipeId) }, select: { equipeId: true } });
        }
        if (!vinculo && req.empresaId) {
          vinculo = await prisma.membroEquipe.findFirst({ where: { userId: vetUserId, equipe: { empresaId: Number(req.empresaId) } }, orderBy: { createdAt: 'desc' }, select: { equipeId: true } });
        }
        // Só sem contexto ativo é que se procura vínculo em qualquer empresa. Com
        // contexto e sem vínculo nele, devolver o "mais antigo" entregaria o ROSTER
        // de outra clínica na tela desta — vazamento entre empresas.
        if (!vinculo && !req.empresaId && !req.equipeId) {
          vinculo = await prisma.membroEquipe.findFirst({ where: { userId: vetUserId }, orderBy: { createdAt: 'asc' }, select: { equipeId: true } });
        }
        if (!vinculo) return res.json({ sucesso: true, dados: [], equipeId: null, isGestor: false });

        const equipeDoVinculo = await prisma.equipe.findUnique({
          where: { id: vinculo.equipeId }, select: { empresaId: true },
        });

        const membrosDaEquipe = await prisma.membroEquipe.findMany({
          where:   { equipeId: vinculo.equipeId, NOT: { user: { role: 'ADMIN' } } },
          include: {
            user:   { select: { id: true, fullName: true, ativo: true, createdAt: true, userType: true, fornecedorPerfil: { select: { tipoServico: true } }, vetPerfil: { select: { subespecialidades: { select: { nome: true } } } }, especialidades: { where: { empresaId: equipeDoVinculo?.empresaId ?? -1 }, select: { especialidadeId: true, especialidade: { select: { id: true, nome: true } } } } } },
            equipe: { select: { nome: true } },
          },
          orderBy: { createdAt: 'desc' },
        });
        return res.json({
          sucesso:  true,
          dados:    await anexarTrilhaAtivacaoEmRelacao(await anexarFotoEmRelacao(await aplicarPerfilProfEmRelacao(
            await anexarLocaisTrabalho(await anexarExpedienteTrabalho(membrosDaEquipe)),
            'user', equipeDoVinculo?.empresaId ?? null), 'user', equipeDoVinculo?.empresaId ?? null), 'user'),
          equipeId: vinculo.equipeId,
          isGestor: false,
        });
      }

      const equipes = await prisma.equipe.findMany({ where: { empresaId: empresa.id }, orderBy: { createdAt: 'asc' } });
      if (equipes.length === 0) return res.json({ sucesso: true, dados: [], equipeId: null, isGestor: false });

      // Prioridade: query param explícito > equipe ativa do seletor (req.equipeId) > primeira
      const equipeAlvoId = equipeIdParam ?? req.equipeId;
      const equipeAlvo = equipeAlvoId ? equipes.find(e => e.id === equipeAlvoId) ?? equipes[0] : equipes[0];

      const membros = await prisma.membroEquipe.findMany({
        where:   { equipeId: equipeAlvo.id, NOT: { user: { role: 'ADMIN' } } },
        include: {
          user:   { select: { id: true, fullName: true, email: true, phone: true, ativo: true, createdAt: true, userType: true, cep: true, endereco: true, complemento: true, bairro: true, cidade: true, estado: true, fornecedorPerfil: { select: { tipoServico: true } }, vetPerfil: { select: { subespecialidades: { select: { nome: true } } } }, especialidades: { where: { empresaId: empresa.id }, select: { especialidadeId: true, especialidade: { select: { id: true, nome: true } } } } } },
          equipe: { select: { nome: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      res.json({
        sucesso: true,
        // Perfis restritos à PRÓPRIA empresa — o que o membro é em outras empresas não aparece
        dados:        await anexarTrilhaAtivacaoEmRelacao(await anexarFotoEmRelacao(await anexarPagamentoEmRelacao(await aplicarPerfilProfEmRelacao(
          await anexarLocaisTrabalho(await anexarExpedienteTrabalho(await anexarPerfisGlobais(membros, { empresaId: empresa.id }))),
          'user', empresa.id), 'user', empresa.id), 'user', empresa.id), 'user'),
        equipeId:     equipeAlvo.id,
        isGestor,
        empresaId:    empresa.id,
        todasEquipes: equipes.map(e => ({ id: e.id, nome: e.nome, empresaId: empresa.id, empresaNome: empresa.nome ?? '' })),
      });
    } catch (err) {
      console.error('Erro ao listar membros:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },
  listarMembrosPorEquipe: async (req, res) => {
    try {
      const { equipeId } = req.params;
      const equipeIdN = Number(equipeId);
      const isAdminReq = req.user.role === 'ADMIN' || req.user.userType === 'ADMIN';

      // ⚠️ `tb_equipes`, `tb_membros_equipe` e `tb_profissional_perfis` (usada dentro de
      // `aplicarPerfilProfEmRelacao`) têm RLS forçado. O ADMIN navega SEM `req.empresaId`
      // — `tenantRls` não carimba tenant nenhum, e a policy filtra tudo isto para VAZIO.
      // Por isso a leitura inteira roda dentro de `comEscopoPlataforma` quando é o ADMIN
      // pedindo; sem isso o painel de equipe em `/admin/empresas` mostrava "sem membros"
      // mesmo com gente cadastrada pelo gestor.
      const buscar = async () => {
        const equipe = await prisma.equipe.findUnique({ where: { id: equipeIdN }, select: { empresaId: true } });

        // Garante que o solicitante pertence à mesma empresa da equipe (isolamento multi-empresa)
        if (!isAdminReq) {
          const empresa = await getEmpresaDoGestor(req.user.id, req.empresaId);
          if (empresa) {
            if (!equipe || equipe.empresaId !== empresa.id) {
              const negado = new Error('Acesso não autorizado a esta equipe.');
              negado.status = 403;
              throw negado;
            }
          }
        }

        const membros = await prisma.membroEquipe.findMany({
          where:   { equipeId: equipeIdN, NOT: { user: { role: 'ADMIN' } } },
          include: { user: { select: { id: true, fullName: true, email: true, phone: true, ativo: true, userType: true } } },
          orderBy: { createdAt: 'desc' },
        });
        // Perfis restritos à empresa desta equipe (ADMIN da plataforma vê tudo)
        return aplicarPerfilProfEmRelacao(
          await anexarPerfisGlobais(
            membros,
            isAdminReq ? { todos: true } : { empresaId: equipe?.empresaId ?? null },
          ),
          'user', equipe?.empresaId ?? null,
        );
      };

      const dados = isAdminReq ? await comEscopoPlataforma(buscar) : await buscar();
      res.json({ sucesso: true, dados });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ sucesso: false, mensagem: err.message });
      console.error('Erro ao listar membros por equipe:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Fornecedores disponíveis para inclusão como FORNECEDOR ──────────────────

  getFornecedoresPorEquipe: async (req, res) => {
    try {
      const equipeIdN = Number(req.params.equipeId);

      // Isolamento: verifica que o solicitante pertence à empresa desta equipe
      if ((req.user.role !== 'ADMIN' && req.user.userType !== 'ADMIN')) {
        const empresa = await getEmpresaDoGestor(req.user.id, req.empresaId);
        if (empresa) {
          const equipe = await prisma.equipe.findUnique({ where: { id: equipeIdN }, select: { empresaId: true } });
          if (!equipe || equipe.empresaId !== empresa.id) {
            return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado.' });
          }
        }
      }

      // IDs já membros da equipe (para excluir do resultado)
      const membroIds = await prisma.membroEquipe.findMany({
        where:  { equipeId: equipeIdN },
        select: { userId: true },
      });
      const idsJaMembros = membroIds.map(m => m.userId);

      const fornecedores = await prisma.user.findMany({
        where:   { userType: 'FORNECEDOR', ativo: true, id: { notIn: idsJaMembros } },
        select:  { id: true, fullName: true, email: true, phone: true },
        orderBy: { fullName: 'asc' },
      });

      res.json({ sucesso: true, dados: fornecedores });
    } catch (err) {
      console.error('Erro ao listar fornecedores por equipe:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ─── Designações de Prestador ─────────────────────────────────────────────

  // O `local` do animal vai no payload (localização cadastrada + o campo textual
  // legado como fallback): é por ele que a tela "Gerenciar Acesso" filtra a lista de
  // disponíveis e resolve o "inserir todos deste local".
  getDesignacoesPrestador: async (req, res) => {
    try {
      const equipeIdN    = Number(req.params.equipeId);
      const prestadorIdN = Number(req.params.userId);

      // Valida acesso: ADMIN ou gestor/dono da empresa desta equipe
      if ((req.user.role !== 'ADMIN' && req.user.userType !== 'ADMIN')) {
        const empresa = await getEmpresaDoGestor(req.user.id, req.empresaId);
        const equipe  = await prisma.equipe.findUnique({ where: { id: equipeIdN }, select: { empresaId: true } });
        if (!empresa || !equipe || equipe.empresaId !== empresa.id)
          return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado.' });
      }

      const equipe = await prisma.equipe.findUnique({ where: { id: equipeIdN }, select: { empresaId: true } });

      const [designacoes, animaisDisponiveis] = await Promise.all([
        prisma.designacaoPrestador.findMany({
          where: { equipeId: equipeIdN, prestadorId: prestadorIdN },
          include: { animal: { select: ANIMAL_DESIGNACAO_SELECT } },
          orderBy: [{ ativo: 'desc' }, { animal: { nome: 'asc' } }],
        }),
        prisma.animal.findMany({
          where: {
            ativo: true,
            OR: [
              { equipeId: equipeIdN },
              ...(equipe?.empresaId ? [{ empresaId: equipe.empresaId }] : []),
            ],
            NOT: {
              designacoes: { some: { prestadorId: prestadorIdN, equipeId: equipeIdN, ativo: true } },
            },
          },
          select:  ANIMAL_DESIGNACAO_SELECT,
          orderBy: { nome: 'asc' },
        }),
      ]);

      res.json({ sucesso: true, dados: { designacoes, animaisDisponiveis } });
    } catch (err) {
      console.error('Erro ao listar designações:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  addDesignacaoPrestador: async (req, res) => {
    try {
      const equipeIdN    = Number(req.params.equipeId);
      const prestadorIdN = Number(req.params.userId);
      const { animalId, motivo } = req.body;

      if (!animalId) return res.status(400).json({ sucesso: false, mensagem: 'animalId é obrigatório' });

      if ((req.user.role !== 'ADMIN' && req.user.userType !== 'ADMIN')) {
        const empresa = await getEmpresaDoGestor(req.user.id, req.empresaId);
        const equipe  = await prisma.equipe.findUnique({ where: { id: equipeIdN }, select: { empresaId: true } });
        if (!empresa || !equipe || equipe.empresaId !== empresa.id)
          return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado.' });
      }

      const designacao = await prisma.designacaoPrestador.upsert({
        where: { animalId_prestadorId_equipeId: { animalId: Number(animalId), prestadorId: prestadorIdN, equipeId: equipeIdN } },
        create: {
          animalId:    Number(animalId),
          prestadorId: prestadorIdN,
          equipeId:    equipeIdN,
          motivo:      motivo?.trim() || null,
          criadoPorId: req.user.id,
          ativo:       true,
          dataInicio:  new Date(),
        },
        update: {
          ativo:      true,
          dataFim:    null,
          motivo:     motivo?.trim() || null,
          dataInicio: new Date(),
        },
        include: { animal: { select: ANIMAL_DESIGNACAO_SELECT } },
      });

      res.status(201).json({ sucesso: true, dados: designacao });
    } catch (err) {
      console.error('Erro ao adicionar designação:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // POST /:equipeId/prestadores/:userId/designacoes/lote — body: { animalIds[], motivo? }
  // Concede acesso a VÁRIOS animais de uma vez ("inserir todos", filtrado por local
  // ou não). Um POST por animal deixaria o botão fazendo N requisições e podendo
  // parar no meio; aqui a lista inteira entra numa transaction — ou tudo, ou nada.
  addDesignacoesPrestadorLote: async (req, res) => {
    try {
      const equipeIdN    = Number(req.params.equipeId);
      const prestadorIdN = Number(req.params.userId);
      const { animalIds, motivo } = req.body;

      const ids = [...new Set((animalIds ?? []).map(Number))].filter(Number.isInteger);
      if (ids.length === 0) {
        return res.status(400).json({ sucesso: false, mensagem: 'Informe ao menos um animal', code: 'SEM_ANIMAIS' });
      }

      if ((req.user.role !== 'ADMIN' && req.user.userType !== 'ADMIN')) {
        const empresa = await getEmpresaDoGestor(req.user.id, req.empresaId);
        const equipe  = await prisma.equipe.findUnique({ where: { id: equipeIdN }, select: { empresaId: true } });
        if (!empresa || !equipe || equipe.empresaId !== empresa.id)
          return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado.' });
      }

      // Só designa animal que o prestador poderia receber pela tela: ativo e dentro
      // da equipe/empresa. Id forjado no body não vira acesso a animal de fora.
      const equipe = await prisma.equipe.findUnique({ where: { id: equipeIdN }, select: { empresaId: true } });
      const permitidos = await prisma.animal.findMany({
        where: {
          id:    { in: ids },
          ativo: true,
          OR: [
            { equipeId: equipeIdN },
            ...(equipe?.empresaId ? [{ empresaId: equipe.empresaId }] : []),
          ],
        },
        select: { id: true },
      });
      if (permitidos.length === 0) {
        return res.status(400).json({ sucesso: false, mensagem: 'Nenhum animal elegível na seleção', code: 'SEM_ANIMAIS_ELEGIVEIS' });
      }

      const motivoLimpo = motivo?.trim() || null;
      const agora       = new Date();

      await prisma.$transaction(
        permitidos.map(({ id: animalId }) => prisma.designacaoPrestador.upsert({
          where:  { animalId_prestadorId_equipeId: { animalId, prestadorId: prestadorIdN, equipeId: equipeIdN } },
          create: {
            animalId, prestadorId: prestadorIdN, equipeId: equipeIdN,
            motivo: motivoLimpo, criadoPorId: req.user.id, ativo: true, dataInicio: agora,
          },
          update: { ativo: true, dataFim: null, motivo: motivoLimpo, dataInicio: agora },
        })),
      );

      res.status(201).json({
        sucesso: true,
        dados: { concedidos: permitidos.length, ignorados: ids.length - permitidos.length },
      });
    } catch (err) {
      console.error('Erro ao adicionar designações em lote:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  removeDesignacaoPrestador: async (req, res) => {
    try {
      const equipeIdN    = Number(req.params.equipeId);
      const prestadorIdN = Number(req.params.userId);
      const animalIdN    = Number(req.params.animalId);

      if ((req.user.role !== 'ADMIN' && req.user.userType !== 'ADMIN')) {
        const empresa = await getEmpresaDoGestor(req.user.id, req.empresaId);
        const equipe  = await prisma.equipe.findUnique({ where: { id: equipeIdN }, select: { empresaId: true } });
        if (!empresa || !equipe || equipe.empresaId !== empresa.id)
          return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado.' });
      }

      await prisma.designacaoPrestador.updateMany({
        where: { animalId: animalIdN, prestadorId: prestadorIdN, equipeId: equipeIdN },
        data:  { ativo: false, dataFim: new Date() },
      });

      res.json({ sucesso: true });
    } catch (err) {
      console.error('Erro ao remover designação:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // DELETE /:equipeId/prestadores/:userId/designacoes — revoga TODO o acesso vigente
  // do prestador nesta equipe ("Remover todos"). Soft delete, igual ao unitário: as
  // linhas ficam com ativo=false + dataFim, preservando o histórico.
  removeTodasDesignacoesPrestador: async (req, res) => {
    try {
      const equipeIdN    = Number(req.params.equipeId);
      const prestadorIdN = Number(req.params.userId);

      if ((req.user.role !== 'ADMIN' && req.user.userType !== 'ADMIN')) {
        const empresa = await getEmpresaDoGestor(req.user.id, req.empresaId);
        const equipe  = await prisma.equipe.findUnique({ where: { id: equipeIdN }, select: { empresaId: true } });
        if (!empresa || !equipe || equipe.empresaId !== empresa.id)
          return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado.' });
      }

      const { count } = await prisma.designacaoPrestador.updateMany({
        where: { prestadorId: prestadorIdN, equipeId: equipeIdN, ativo: true },
        data:  { ativo: false, dataFim: new Date() },
      });

      res.json({ sucesso: true, dados: { removidos: count } });
    } catch (err) {
      console.error('Erro ao remover todas as designações:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  adicionarMembro: async (req, res) => {
    try {
      const vetUserId                  = req.user.id;
      // `senha` do body é ignorada de propósito: quem define a credencial de alguém é o
      // ADMIN ou a própria pessoa. Conta criada aqui nasce com a senha padrão e troca
      // obrigatória no primeiro acesso.
      const { fullName, email, phone, cargo } = req.body;

      if (!fullName || !email || !cargo) {
        return res.status(400).json({ sucesso: false, mensagem: 'fullName, email e cargo são obrigatórios' });
      }

      // Conceder GESTOR não é exclusivo de ADMIN — mesma regra de incluirMembroDireto
      // ("Cadastro da Empresa > Incluir gestor"): quem já é gestor da equipe pode
      // incluir outro. `garantirEquipePadrao` abaixo já exige isso.
      const { equipe } = await garantirEquipePadrao(vetUserId, req.empresaId, req.equipeId);
      if (!equipe) return res.status(403).json({ sucesso: false, mensagem: 'Você não é gestor da empresa ativa.' });

      const emailNorm = normalizeEmail(email);
      let usuario = await findUserByEmail(prisma, emailNorm);
      if (!usuario) {
        const senhaHash = await bcrypt.hash('Inicial_001', 10);
        usuario = await prisma.user.create({
          data: {
            fullName, email: emailNorm,
            phone:        phone || null,
            passwordHash: senhaHash,
            role:         'USER',
            userType:     cargo === 'ESTAGIARIO' ? 'ESTAGIARIO' : 'VETERINARIO',
            mustChangePassword: true,
          },
        });
      }

      const jaEMembro = await prisma.membroEquipe.findUnique({
        where: { equipeId_userId: { equipeId: equipe.id, userId: usuario.id } },
      });
      if (jaEMembro) return res.status(409).json({ sucesso: false, mensagem: 'Este usuário já é membro da equipe' });

      const membro = await prisma.membroEquipe.create({
        data:    { equipeId: equipe.id, userId: usuario.id, cargo },
        include: { user: { select: { id: true, fullName: true, email: true, phone: true, ativo: true } } },
      });
      await vincularMembro(prisma, usuario.id, equipe.id, cargo);
      res.status(201).json({ sucesso: true, dados: membro });
    } catch (err) {
      console.error('Erro ao adicionar membro:', err);
      if (err.code === 'P2002') return res.status(409).json({ sucesso: false, mensagem: 'Membro já cadastrado' });
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  atualizarMembro: async (req, res) => {
    try {
      const { id } = req.params;
      const { cargo, phone, senha, fullName, email, ativo, cep, endereco, complemento, bairro, cidade, estado, especialidadeIds,
              tipoPagamento, formaPagamento, valorPagamento, acessoSistema, restringirPorLocal } = req.body;

      const membro = await prisma.membroEquipe.findUnique({
        where:   { id: Number(id) },
        include: { user: true, equipe: { select: { empresaId: true } } },
      });
      if (!membro) return res.status(404).json({ sucesso: false, mensagem: 'Membro não encontrado' });

      // Autorização: ADMIN, ou gestor da empresa da equipe do membro
      if ((req.user.role !== 'ADMIN' && req.user.userType !== 'ADMIN')) {
        const empresa = await getEmpresaDoGestor(req.user.id, req.empresaId);
        if (!empresa || membro.equipe?.empresaId !== empresa.id) {
          return res.status(403).json({ sucesso: false, mensagem: 'Apenas gestores da equipe podem editar membros.' });
        }
        // 🔴 A TRAVA "gestor não edita outro gestor" FOI REMOVIDA (2026-09-05, a pedido).
        // Ela não protegia nada e produzia uma incoerência relatada da tela de Equipe:
        // o MESMO gestor podia INCLUIR outro gestor (`incluirMembroDireto`, sem exigir
        // ADMIN) e podia INATIVÁ-LO (`toggleMembro`, que nunca teve essa trava —
        // inativar tira o acesso da pessoa à empresa, ação bem mais forte), mas não
        // podia corrigir o telefone dele. Quem quisesse contornar a trava simplesmente
        // inativava o colega; o que a regra entregava era só o botão "Editar" ausente.
        // ⚠️ O QUE CONTINUA VALENDO, e é o que de fato protege:
        //   · SENHA — só o ADMIN da plataforma e o próprio dono da conta (bloco abaixo);
        //   · DESBLOQUEIO de conta travada — conta de GESTOR escala para o ADMIN
        //     (`lib/bloqueioLogin.js`), regra própria, não tocada aqui;
        //   · o gestor só alcança membro da PRÓPRIA empresa (checagem logo acima).
        // ⚠️ Consequência aceita: um gestor pode rebaixar o cargo de outro. Isso já era
        // possível por outro caminho (inativar), e a premissa "empresa nunca existe sem
        // gestor" (§36-d) não tem guarda de último gestor em NENHUM dos dois — se for
        // para ter, o lugar é aqui E no toggleMembro, juntos.
      }

      if (email !== undefined) {
        const emailNorm = normalizeEmail(email);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm ?? '')) {
          return res.status(400).json({ sucesso: false, mensagem: 'E-mail inválido' });
        }
        const existente = await prisma.user.findFirst({ where: { ...whereEmailInsensitive(emailNorm), id: { not: membro.userId } } });
        if (existente) {
          return res.status(409).json({ sucesso: false, mensagem: 'Este e-mail já está em uso por outro usuário.' });
        }
      }

      if (senha) {
        // Senha é da PESSOA: só o ADMIN da plataforma e o próprio dono da conta a alteram.
        // O gestor administra a equipe, não a credencial de quem está nela — quem esqueceu
        // a senha usa "esqueci minha senha"; conta nova nasce com a padrão + troca no 1º acesso.
        const ehAdmin   = req.user.role === 'ADMIN' || req.user.userType === 'ADMIN';
        const ehProprio = Number(req.user.id) === Number(membro.userId);
        if (!ehAdmin && !ehProprio) {
          return res.status(403).json({
            sucesso:  false,
            mensagem: 'Apenas o administrador ou o próprio usuário podem alterar a senha.',
          });
        }
        if (senha.length < 8)            return res.status(400).json({ sucesso: false, mensagem: 'A senha deve ter ao menos 8 caracteres' });
        if (!/[A-Z]/.test(senha))        return res.status(400).json({ sucesso: false, mensagem: 'A senha deve ter ao menos uma letra maiúscula' });
        if (!/\d/.test(senha))           return res.status(400).json({ sucesso: false, mensagem: 'A senha deve ter ao menos 1 número' });
        if (!/[^A-Za-z0-9]/.test(senha)) return res.status(400).json({ sucesso: false, mensagem: 'A senha deve ter ao menos 1 caractere especial' });
        if (await senhaReutilizada(membro.userId, senha, membro.user.passwordHash)) {
          return res.status(400).json({ sucesso: false, mensagem: MENSAGEM_SENHA_REUTILIZADA });
        }
      }

      // Remuneração e acesso: obrigatórios como na inclusão. Só valida quando o
      // formulário os envia — o PATCH de outra tela (ex.: toggle de ativo) não
      // precisa reenviar o acordo de pagamento para poder salvar.
      const enviouPagamento = tipoPagamento !== undefined || formaPagamento !== undefined || valorPagamento !== undefined;
      let pagamentoEdicao = null;
      if (enviouPagamento) {
        const p = normalizarPagamento({ tipoPagamento, formaPagamento, valorPagamento });
        if (p.erro) return res.status(400).json({ sucesso: false, mensagem: p.erro });
        pagamentoEdicao = p.dados;
      }
      if (acessoSistema !== undefined && typeof acessoSistema !== 'boolean') {
        return res.status(400).json({ sucesso: false, mensagem: 'Informe se o membro terá acesso ao sistema.' });
      }

      // "Atender somente no local de trabalho" — só grava quando a tela envia o campo
      // (checkbox), senão um PATCH parcial de outra tela (ex.: toggle de ativo) o apagaria.
      const dadosMembro = {};
      if (cargo) dadosMembro.cargo = cargo;
      if (typeof restringirPorLocal === 'boolean') dadosMembro.restringirPorLocal = restringirPorLocal;
      if (Object.keys(dadosMembro).length > 0) {
        await prisma.membroEquipe.update({ where: { id: Number(id) }, data: dadosMembro });
      }

      // Expediente de trabalho do profissional (dias/horários) — via SQL raw
      const expediente = parseExpedienteTrabalho(req.body);
      if (expediente.erro) return res.status(400).json({ sucesso: false, mensagem: expediente.erro });

      // Especialidade existe para VETERINÁRIO, FORNECEDOR e GESTOR; o vet sem
      // especialidade informada assume Clínica Médica (fornecedor e gestor aceitam
      // nenhuma). O cargo vale o que está sendo salvo agora (body) e, na falta dele, o
      // atual do membro.
      // ⚠️ GESTOR precisa entrar aqui além do `updateMe`: sem isso, uma edição do
      // membro por esta tela gravaria os locais com `semEspecialidade` e APAGARIA a
      // especialidade que o próprio gestor cadastrou no Cadastro Pessoal.
      const cargoEfetivo = cargo || membro.cargo;
      const perfilComEspecialidade = ['VETERINARIO', 'FORNECEDOR', 'GESTOR'].includes(cargoEfetivo);
      const especPadrao = cargoEfetivo === 'VETERINARIO'
        ? await especialidadesPadraoVeterinario(req, membro.equipeId)
        : [];

      // Locais de trabalho (múltiplos). Quando enviados, são a fonte do expediente
      // (a agregação sincroniza os campos únicos); senão mantém o expediente único.
      const locaisParsed = parseLocaisTrabalho(req.body, {
        especialidadesPadrao: especPadrao,
        semEspecialidade:     !perfilComEspecialidade,
      });
      if (locaisParsed.erro) return res.status(400).json({ sucesso: false, mensagem: locaisParsed.erro });
      if (locaisParsed.locais !== undefined) {
        // Todo membro fica restrito ao dia/horário da empresa (EmpresaConfiguracao)
        const erroExp = await validarLocaisContraExpedienteEmpresa(req, locaisParsed.locais);
        if (erroExp) return res.status(400).json({ sucesso: false, mensagem: erroExp });
        await gravarLocaisTrabalho(prisma, Number(id), locaisParsed.locais);
      } else {
        await gravarExpedienteTrabalho(Number(id), expediente);
      }

      // No User ficam só IDENTIDADE e credencial: e-mail, senha e o ativo global.
      // Nome, contato e endereço são do PERFIL DA EMPRESA — gravá-los aqui mudaria o
      // cadastro do profissional nas outras clínicas em que ele atua.
      const dadosUser = {};
      if (email !== undefined && email.trim()) dadosUser.email = email.trim().toLowerCase();
      if (ativo !== undefined)                 dadosUser.ativo = Boolean(ativo);
      if (senha)                               dadosUser.passwordHash = await bcrypt.hash(senha, 10);
      if (Object.keys(dadosUser).length > 0) {
        await prisma.user.update({ where: { id: membro.userId }, data: dadosUser });
      }
      if (senha) await registrarTrocaSenha(membro.userId, membro.user.passwordHash);

      // Cadastro desta empresa
      const empresaDoMembro = membro.equipe?.empresaId ?? null;
      if (empresaDoMembro) {
        const cadastroEmpresa = {
          ...(fullName    !== undefined && fullName.trim() ? { fullName: fullName.trim() } : {}),
          ...(phone       !== undefined && { phone:       phone?.trim()       || null }),
          ...(cep         !== undefined && { cep:         cep?.trim()         || null }),
          ...(endereco    !== undefined && { endereco:    endereco?.trim()    || null }),
          ...(complemento !== undefined && { complemento: complemento?.trim() || null }),
          ...(bairro      !== undefined && { bairro:      bairro?.trim()      || null }),
          ...(cidade      !== undefined && { cidade:      cidade?.trim()      || null }),
          ...(estado      !== undefined && { estado:      estado?.trim()      || null }),
          ...(ativo       !== undefined && { ativo:       Boolean(ativo) }),
        };
        // LIMITE DO PLANO ao RELIGAR o acesso de quem já é membro. ⚠️ Este é o ponto
        // fácil de esquecer: o assento não nasce só na inclusão — revogar o acesso de
        // alguém e devolvê-lo depois também ocupa vaga. Sem isto, bastaria desligar e
        // religar para furar o plano.
        // `jaOcupava` evita contar a própria pessoa duas vezes quando ela JÁ tinha acesso
        // (salvar o cadastro de quem já ocupa assento não pode reprovar com o plano cheio).
        // `lerPagamentoEAcesso` recebe uma LISTA de userIds e devolve um Map — uma
        // consulta só serve para as duas perguntas (o que ele tem hoje e o que terá).
        const acessoAtual  = (await lerPagamentoEAcesso(prisma, [membro.userId], empresaDoMembro))
                               .get(membro.userId);
        const vaiTerAcesso = acessoSistema !== undefined
          ? acessoSistema
          : acessoAtual?.acessoSistema !== false;
        const ficaAtivo   = ativo === undefined || Boolean(ativo);
        const perfilFinal = cargo?.trim() || membro.cargo;
        if (consomeAssento({ perfil: perfilFinal, acessoSistema: vaiTerAcesso, ativo: ficaAtivo })) {
          const jaOcupava = acessoAtual && acessoAtual.acessoSistema !== false ? 1 : 0;
          await garantirVagaDeUsuario(empresaDoMembro, { jaOcupava });
        }

        // Fonte nova: tabela de ligação. O PERFIL na empresa é o cargo do membro.
        await salvarVinculo(prisma, membro.userId, empresaDoMembro, {
          perfil: perfilFinal,
          ...cadastroEmpresa,
        });
        await salvarPagamentoEAcesso(prisma, membro.userId, empresaDoMembro, {
          ...(pagamentoEdicao ?? {}),
          ...(acessoSistema !== undefined && { acessoSistema }),
        });
        await salvarPerfilProfissional(prisma, membro.userId, empresaDoMembro, {
          ...(fullName    !== undefined && fullName.trim() ? { fullName: fullName.trim() } : {}),
          ...(phone       !== undefined && { phone:       phone?.trim()       || null }),
          ...(cep         !== undefined && { cep:         cep?.trim()         || null }),
          ...(endereco    !== undefined && { endereco:    endereco?.trim()    || null }),
          ...(complemento !== undefined && { complemento: complemento?.trim() || null }),
          ...(bairro      !== undefined && { bairro:      bairro?.trim()      || null }),
          ...(cidade      !== undefined && { cidade:      cidade?.trim()      || null }),
          ...(estado      !== undefined && { estado:      estado?.trim()      || null }),
          ...(ativo       !== undefined && { ativo:       Boolean(ativo) }),
        });
      }

      // Sincroniza com o cadastro Fornecedor vinculado (quando o membro é PRESTADOR)
      const dadosFornecedor = {};
      if (fullName    !== undefined && fullName.trim()) dadosFornecedor.nome        = fullName.trim();
      if (email       !== undefined && email.trim())    dadosFornecedor.email       = email.trim().toLowerCase();
      if (phone       !== undefined) dadosFornecedor.telefone    = phone?.trim()       || null;
      if (cep         !== undefined) dadosFornecedor.cep         = cep?.trim()         || null;
      if (endereco    !== undefined) dadosFornecedor.endereco    = endereco?.trim()    || null;
      if (complemento !== undefined) dadosFornecedor.complemento = complemento?.trim() || null;
      if (bairro      !== undefined) dadosFornecedor.bairro      = bairro?.trim()      || null;
      if (cidade      !== undefined) dadosFornecedor.cidade      = cidade?.trim()      || null;
      if (estado      !== undefined) dadosFornecedor.estado      = estado?.trim()      || null;
      if (Object.keys(dadosFornecedor).length > 0) {
        // Lookup primário: por userId (vínculo estabelecido via incluirMembroDireto)
        let fornecedorAlvo = await prisma.fornecedor.findFirst({ where: { userId: membro.userId } });
        // Fallback: por e-mail atual do usuário (registros legados sem userId populado)
        if (!fornecedorAlvo && membro.user?.email) {
          fornecedorAlvo = await prisma.fornecedor.findFirst({ where: { email: membro.user.email } });
        }
        if (fornecedorAlvo) {
          await prisma.fornecedor.update({
            where: { id: fornecedorAlvo.id },
            data:  { ...dadosFornecedor, userId: membro.userId }, // estabelece o link se ainda não estava
          });
        }
      }

      // Especialidades (catálogo por espécie) — sincroniza quando enviadas (delete + insert).
      // Perfil sem atuação clínica (estagiário, enfermeiro, secretaria, financeiro) zera;
      // veterinário sem nenhuma cai no padrão (Clínica Médica).
      // Ressalva: `UsuarioEspecialidade` é GLOBAL (por usuário, não por equipe). Quem é
      // veterinário/fornecedor por identidade (userType) não perde as especialidades só
      // porque ocupa um cargo sem atuação clínica NESTA equipe — senão a edição aqui
      // apagaria o cadastro dele na outra empresa.
      if (Array.isArray(especialidadeIds) && empresaDoMembro) {
        let ids = perfilComEspecialidade
          ? [...new Set(especialidadeIds.map(Number))].filter(Number.isInteger)
          : [];
        if (perfilComEspecialidade && ids.length === 0) ids = [...especPadrao];
        const rows = ids.length > 0
          ? await prisma.especialidade.findMany({ where: { id: { in: ids }, ativo: true }, select: { id: true, nome: true } })
          : [];
        // Escopo por EMPRESA: o que ele exerce nas outras clínicas fica intacto.
        await prisma.usuarioEspecialidade.deleteMany({
          where: { userId: membro.userId, empresaId: empresaDoMembro },
        });
        if (rows.length > 0) {
          await prisma.usuarioEspecialidade.createMany({
            data: rows.map(r => ({ userId: membro.userId, especialidadeId: r.id, empresaId: empresaDoMembro })),
            skipDuplicates: true,
          });
        }
        // Fornecedor vinculado: mantém o tipoServico legado e os vínculos em sincronia
        const fornecedorEspec = await prisma.fornecedor.findFirst({ where: { userId: membro.userId } });
        if (fornecedorEspec && rows.length > 0) {
          await prisma.fornecedorEspecialidade.deleteMany({ where: { fornecedorId: fornecedorEspec.id } });
          await prisma.fornecedorEspecialidade.createMany({
            data: rows.map(r => ({ fornecedorId: fornecedorEspec.id, especialidadeId: r.id })),
            skipDuplicates: true,
          });
          await prisma.fornecedor.update({
            where: { id: fornecedorEspec.id },
            data:  { tipoServico: rows[0].nome.slice(0, 50) },
          });
        }
      }

      // Garantia: veterinário nunca fica sem especialidade NESTA empresa — Clínica Médica.
      if (cargoEfetivo === 'VETERINARIO' && especPadrao.length > 0 && empresaDoMembro) {
        const jaTem = await prisma.usuarioEspecialidade.count({
          where: { userId: membro.userId, empresaId: empresaDoMembro },
        });
        if (jaTem === 0) {
          await prisma.usuarioEspecialidade.createMany({
            data: especPadrao.map(especialidadeId => ({
              userId: membro.userId, especialidadeId, empresaId: empresaDoMembro,
            })),
            skipDuplicates: true,
          });
        }
      }

      res.json({ sucesso: true, mensagem: 'Membro atualizado' });
    } catch (err) {
      console.error('Erro ao atualizar membro:', err);
      // Religar o acesso de um membro com o plano cheio é regra de negócio → 409 com a
      // mensagem útil, nunca "Erro interno".
      if (err.code === 'LIMITE_USUARIOS_PLANO') {
        return res.status(409).json({ sucesso: false, mensagem: err.message, code: err.code, ...err.dados });
      }
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // POST /api/equipes/membros/:userId/desbloquear
  //
  // Libera a conta travada por tentativas de senha erradas (lib/bloqueioLogin.js).
  // A REGRA de quem pode destravar quem mora na lib, não aqui — este controller só a
  // consulta e registra o ato:
  //   alvo NÃO é gestor → gestor de uma empresa do alvo (ou ADMIN)
  //   alvo É gestor     → SOMENTE ADMIN da plataforma
  //
  // ⚠️ A rota passa por `checkPermission('equipe.membros.editar')` por DOIS motivos: o
  // gate em si, e porque é ele que popula `req.membroCargo = 'GESTOR'` nos caminhos de
  // bypass (dono da empresa incluído) — sem isso `podeDesbloquear` não teria como
  // reconhecer o gestor.
  desbloquearMembro: async (req, res) => {
    try {
      const alvoId = Number(req.params.userId);
      const alvo = await prisma.user.findUnique({
        where:  { id: alvoId },
        select: { id: true, fullName: true, email: true, bloqueadoEm: true, tentativasLogin: true },
      });
      if (!alvo) return res.status(404).json({ error: 'Usuário não encontrado' });

      const permissao = await bloqueioLogin.podeDesbloquear(req, alvoId);
      if (!permissao.pode) {
        registrarAcessoNegado(req, {
          motivo:     `Desbloqueio de conta negado: ${permissao.motivo}`,
          entidade:   'LOGIN',
          entidadeId: alvoId,
        });
        return res.status(403).json({ error: permissao.motivo, code: permissao.code });
      }

      // Conta já liberada devolve 200, não erro: dois gestores clicando quase juntos é
      // o caso normal, e um 4xx aí faria o segundo achar que falhou algo.
      if (!alvo.bloqueadoEm) {
        return res.json({ dados: { id: alvo.id, bloqueadoEm: null }, mensagem: 'A conta já estava liberada.' });
      }

      const liberado = await bloqueioLogin.desbloquear(alvoId);

      await registrarAuditoria(prisma, req, {
        categoria:  'ALTERACAO',
        entidade:   'USUARIO',
        entidadeId: alvoId,
        motivo:     req.body?.motivo?.trim() || null,
        detalhes:   `Conta desbloqueada (${alvo.tentativasLogin} tentativa(s) de senha inválida, bloqueada em `
                    + `${alvo.bloqueadoEm.toISOString()})`,
      });

      return res.json({ dados: liberado, mensagem: 'Conta desbloqueada.' });
    } catch (err) {
      console.error('EquipeController.desbloquearMembro:', err);
      return res.status(500).json({ error: 'Erro ao desbloquear a conta' });
    }
  },

  toggleMembro: async (req, res) => {
    try {
      const { id }  = req.params;
      const { motivo } = req.body ?? {};
      const membro  = await prisma.membroEquipe.findUnique({
        where:   { id: Number(id) },
        include: { user: true, equipe: { select: { empresaId: true } } },
      });
      if (!membro) return res.status(404).json({ sucesso: false, mensagem: 'Membro não encontrado' });

      // 🔴 A (IN)ATIVAÇÃO É DA EMPRESA DESTE VÍNCULO — nunca da conta (2026-09-04).
      // Ver o bloco abaixo para o porquê; a empresa sai da EQUIPE do membro, e não do
      // contexto de quem clicou, porque é aquele vínculo que está sendo alterado.
      const empresaDoVinculo = membro.equipe?.empresaId ?? null;
      const estadoAtual = await aplicarPerfilProfissional(membro.user, empresaDoVinculo);
      const vaiInativar = estadoAtual.ativo !== false;

      // 🔴 JUSTIFICATIVA NOS DOIS SENTIDOS (2026-09-04, a pedido). Antes só a
      // INATIVAÇÃO pedia motivo, e a reativação passava direto: a trilha respondia
      // "por que tiraram fulano da equipe" mas não "por que devolveram o acesso a
      // ele" — que é a pergunta mais sensível das duas, porque devolve poder.
      if (!motivo?.trim()) {
        return res.status(400).json({
          sucesso:  false,
          mensagem: `É obrigatório informar o motivo da ${vaiInativar ? 'inativação' : 'reativação'}`,
        });
      }

      // 🔴 O ESTADO VAI PARA A EMPRESA, NÃO PARA A CONTA (2026-09-04).
      //
      // Antes isto escrevia `users.ativo` — a identidade GLOBAL. Efeito relatado:
      // inativar alguém numa clínica FECHAVA O LOGIN dela em todas as outras, inclusive
      // onde é GESTORA, com a mensagem "Conta desativada". Agora o desligamento é
      // gravado nos dois lugares que o descrevem POR EMPRESA:
      //   · `tb_usuario_empresa.ativo`  → login e seletor de contexto
      //     (`podeAcessarSistema` / `empresasSemAcesso`): a empresa some da lista e o
      //     `auth` recusa o header dela, então ele não vê dado nenhum de lá;
      //   · `tb_profissional_perfis.ativo` → o que a tela de Equipe exibe
      //     (`ativo` efetivo = User.ativo && perfil.ativo, ver lib/profissionalPerfil).
      // `users.ativo` continua existindo e é do ADMIN da plataforma: ali se desliga a
      // CONTA, o que é outra decisão.
      //
      // ⚠️ Sem empresa resolvida (vínculo legado sem equipe) cai no comportamento
      // antigo — melhor global que NO-OP silencioso, que deixaria o botão sem efeito.
      if (empresaDoVinculo) {
        await definirAtivoNaEmpresa(prisma, membro.userId, empresaDoVinculo, !vaiInativar);
        await salvarPerfilProfissional(prisma, membro.userId, empresaDoVinculo, { ativo: !vaiInativar });
      }
      const soTrilha = { global: !empresaDoVinculo };
      if (vaiInativar) {
        await registrarInativacao(prisma, membro.userId, req.user.id, motivo.trim(), soTrilha);
      } else {
        await registrarAtivacao(prisma, membro.userId, req.user.id, soTrilha);
      }

      // Auditoria: quem foi (in)ativado, quando (timestamp da própria linha) e
      // quem fez (userId/userName/email da própria linha, gravados pelo helper).
      await registrarAuditoria(prisma, req, {
        // A categoria diz O QUE ACONTECEU: (in)ativar um cadastro não é a mesma
        // coisa que editar um campo dele, e ALTERACAO misturava os dois.
        categoria: vaiInativar ? 'INATIVACAO' : 'ATIVACAO',
        entidade:  'USUARIO',
        entidadeId: membro.userId,
        motivo:    motivo.trim(),
        detalhes:  `${req.user.fullName ?? req.user.email} ${vaiInativar ? 'inativou' : 'ativou'} o usuário ${membro.user.fullName}`,
      });

      res.json({ sucesso: true, mensagem: vaiInativar ? 'Usuário inativado' : 'Usuário ativado' });
    } catch (err) {
      console.error('Erro ao alternar status do membro:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  removerMembro: async (req, res) => {
    try {
      const { membroId } = req.params;

      // Gestores não podem excluir outros gestores — apenas desativar
      if ((req.user.role !== 'ADMIN' && req.user.userType !== 'ADMIN')) {
        const alvo = await prisma.membroEquipe.findUnique({
          where:  { id: Number(membroId) },
          select: { cargo: true },
        });
        if (alvo?.cargo === 'GESTOR') {
          return res.status(403).json({
            sucesso: false,
            mensagem: 'Gestores não podem ser excluídos por outros gestores. Use a opção de desativar.',
          });
        }
      }

      await prisma.membroEquipe.delete({ where: { id: Number(membroId) } });
      res.json({ sucesso: true, mensagem: 'Membro removido da equipe' });
    } catch (err) {
      console.error('Erro ao remover membro:', err);
      if (err.code === 'P2025') return res.status(404).json({ sucesso: false, mensagem: 'Membro não encontrado' });
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ADMIN: remove o gestor da equipe e desativa a conta
  removerGestorAdmin: async (req, res) => {
    try {
      if ((req.user.role !== 'ADMIN' && req.user.userType !== 'ADMIN')) {
        return res.status(403).json({ sucesso: false, mensagem: 'Apenas administradores podem usar esta ação.' });
      }

      const equipeId = Number(req.params.equipeId);
      const userId   = Number(req.params.userId);

      const membro = await prisma.membroEquipe.findUnique({
        where:  { equipeId_userId: { equipeId, userId } },
        select: { id: true, cargo: true, user: { select: { fullName: true } } },
      });

      if (!membro) {
        return res.status(404).json({ sucesso: false, mensagem: 'Membro não encontrado nesta equipe.' });
      }
      if (membro.cargo !== 'GESTOR') {
        return res.status(400).json({ sucesso: false, mensagem: 'Esta rota é exclusiva para remoção de gestores.' });
      }

      await prisma.$transaction([
        prisma.membroEquipe.delete({ where: { id: membro.id } }),
        prisma.user.delete({ where: { id: userId } }),
      ]);

      res.json({ sucesso: true, mensagem: `${membro.user.fullName} foi removido e sua conta foi excluída.` });
    } catch (err) {
      console.error('Erro ao remover gestor:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Convites ────────────────────────────────────────────────────────────────

  convidarMembro: async (req, res) => {
    try {
      const vetUserId        = req.user.id;
      const { email, cargo } = req.body;

      if (!email || !cargo) {
        return res.status(400).json({ sucesso: false, mensagem: 'email e cargo são obrigatórios' });
      }

      const { equipe } = await garantirEquipePadrao(vetUserId, req.empresaId, req.equipeId);
      if (!equipe) return res.status(403).json({ sucesso: false, mensagem: 'Você não é gestor da empresa ativa.' });

      // Bloqueia re-convite: membro já existente
      const usuarioCheck = await findUserByEmail(prisma, email);
      if (usuarioCheck) {
        const jaMembro = await prisma.membroEquipe.findUnique({
          where: { equipeId_userId: { equipeId: equipe.id, userId: usuarioCheck.id } },
        });
        if (jaMembro) {
          return res.status(409).json({ sucesso: false, mensagem: 'Este e-mail já faz parte da equipe' });
        }
      }

      // Bloqueia re-convite: já existe convite PENDENTE e não expirado
      const conviteAtivo = await prisma.conviteEquipe.findFirst({
        where: { equipeId: equipe.id, email, status: 'PENDENTE', expiresAt: { gt: new Date() } },
      });
      if (conviteAtivo) {
        return res.status(409).json({ sucesso: false, mensagem: 'Já existe um convite pendente para este e-mail. Aguarde expirar ou cancele o anterior.' });
      }

      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas

      const convite = await prisma.conviteEquipe.create({
        data: { equipeId: equipe.id, email, cargo, expiresAt },
      });

      // Buscar dados do vet para o email + espécies que ele atende
      const vetUser = await prisma.user.findUnique({
        where:  { id: vetUserId },
        select: { fullName: true },
      });
      const vetPerfilDono = await prisma.vetPerfil.findUnique({
        where:   { userId: vetUserId },
        include: {
          especies: {
            include: { especie: { select: { nome: true } } },
          },
        },
      });
      // especiesDono: nomes para o email | especiesDonoComId: IDs para copiar ao VetPerfil
      const especiesDono    = vetPerfilDono?.especies.map(e => e.especie) ?? [];
      const especiesDonoComId = vetPerfilDono?.especies.map(e => e.especieId) ?? [];

      // Criar usuário convidado se ainda não existir
      const SENHA_INICIAL = 'Inicial_001';
      const cargoToUserType = { VETERINARIO: 'VETERINARIO', ESTAGIARIO: 'ESTAGIARIO', ADMIN: 'VETERINARIO', MEMBRO: 'ESTAGIARIO', PROPRIETARIO: 'PROPRIETARIO', SECRETARIA: 'ESTAGIARIO', FINANCEIRO: 'ESTAGIARIO', ENFERMEIRO: 'ESTAGIARIO' };
      const userTypeConvidado = cargoToUserType[cargo] || 'ESTAGIARIO';
      let usuarioCriado = false;
      let usuarioConvidadoId = null;
      const usuarioExistente = await findUserByEmail(prisma, email);

      if (!usuarioExistente) {
        const senhaHash = await bcrypt.hash(SENHA_INICIAL, 10);
        const novoUsuario = await prisma.user.create({
          data: {
            email,
            fullName:           '',
            passwordHash:       senhaHash,
            role:               'USER',
            userType:           userTypeConvidado,
            mustChangePassword: true,
          },
        });
        usuarioConvidadoId = novoUsuario.id;
        usuarioCriado = true;
      } else {
        usuarioConvidadoId = usuarioExistente.id;
      }

      // Marca isConvidado e copia espécies do vet dono — já na criação do convite
      if (usuarioConvidadoId) {
        try {
          await prisma.$executeRawUnsafe(
            `UPDATE schs2vet.users SET "isConvidado" = true WHERE id = $1`,
            usuarioConvidadoId,
          );
        } catch { /* coluna ainda não existe no DB legado */ }

        // Copia espécies se for vet e tiver espécies disponíveis
        if (userTypeConvidado === 'VETERINARIO' && especiesDonoComId.length > 0) {
          let perfilConvidado = await prisma.vetPerfil.findUnique({ where: { userId: usuarioConvidadoId } });
          if (!perfilConvidado) {
            perfilConvidado = await prisma.vetPerfil.create({ data: { userId: usuarioConvidadoId } });
          }
          const jaTemEspecies = await prisma.vetEspecie.count({ where: { vetPerfilId: perfilConvidado.id } });
          if (jaTemEspecies === 0) {
            await prisma.$transaction(
              especiesDonoComId.map(especieId =>
                prisma.vetEspecie.upsert({
                  where:  { vetPerfilId_especieId: { vetPerfilId: perfilConvidado.id, especieId } },
                  update: {},
                  create: { vetPerfilId: perfilConvidado.id, especieId },
                })
              )
            );
          }
        }
      }

      // Enviar email com link de convite + espécies que a equipe atende
      emailService.enviarConviteEquipe({
        email,
        cargo,
        token:         convite.token,
        vetNome:       vetUser?.fullName || 'Veterinário',
        equipeNome:    equipe.nome,
        usuarioCriado,
        senhaInicial:  usuarioCriado ? SENHA_INICIAL : null,
        especiesNomes: especiesDono.map(e => e.nome).filter(Boolean),
      }).catch(err => console.error('[emailService] Falha ao enviar convite de equipe:', err));

      res.status(201).json({
        sucesso:  true,
        dados:    convite,
        mensagem: 'Convite enviado por e-mail',
      });
    } catch (err) {
      console.error('Erro ao convidar membro:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Inclusão direta (sem fluxo de aceite) ───────────────────────────────────
  incluirMembroDireto: async (req, res) => {
    try {
      const vetUserId        = req.user.id;
      const { email: emailRaw, cargo, fullName, phone, cep, endereco, complemento, bairro, cidade, estado, fornecedorId, tipoServico, especialidadeIds, equipeId: equipeIdBody,
              tipoPagamento, formaPagamento, valorPagamento, acessoSistema, restringirPorLocal } = req.body;
      const email = (emailRaw ?? '').trim().toLowerCase();

      if (!email || !cargo) {
        return res.status(400).json({ sucesso: false, mensagem: 'email e cargo são obrigatórios' });
      }
      if (!fullName?.trim()) {
        return res.status(400).json({ sucesso: false, mensagem: 'Nome é obrigatório' });
      }
      if (!phone?.trim()) {
        return res.status(400).json({ sucesso: false, mensagem: 'Telefone é obrigatório' });
      }

      // Cargo FORNECEDOR: amarra a conta de login ao cadastro Fornecedor (tipoServico
      // alimenta o seletor de encaminhamento). Existente → vincula; novo → cria CLIENTE.
      let fornecedorVinculo = null;
      if (cargo === 'FORNECEDOR') {
        if (fornecedorId) {
          fornecedorVinculo = await prisma.fornecedor.findUnique({ where: { id: Number(fornecedorId) } });
          if (!fornecedorVinculo) {
            return res.status(404).json({ sucesso: false, mensagem: 'Fornecedor não encontrado' });
          }
        }
        // Fornecedor SEM especialidade é permitido (regra 2026-07-28): o cadastro nasce
        // com tipoServico 'Prestador' e o gestor completa depois, se quiser.
      }

      // Perfis sem atuação clínica (estagiário, enfermeiro, secretaria, financeiro…)
      // não têm especialidade nem tempo de consulta: o que vier no body é ignorado.
      // GESTOR tem, mas OPCIONAL — ver `especPadrao` logo abaixo.
      const perfilComEspecialidade = ['VETERINARIO', 'FORNECEDOR', 'GESTOR'].includes(cargo);
      // Veterinário que não informa especialidade assume Clínica Médica; fornecedor e
      // gestor não — para eles a lista vazia é um resultado válido.
      const especPadrao = cargo === 'VETERINARIO'
        ? await especialidadesPadraoVeterinario(req, equipeIdBody ?? null)
        : [];
      let especEnviadas = perfilComEspecialidade && Array.isArray(especialidadeIds)
        ? [...new Set(especialidadeIds.map(Number))].filter(Number.isInteger)
        : [];
      if (perfilComEspecialidade && especEnviadas.length === 0) especEnviadas = [...especPadrao];

      // Especialidades do catálogo (se enviadas) — fonte única; derivam o tipoServico legado.
      let especResolvidas = null;
      if (especEnviadas.length > 0) {
        const ids = especEnviadas;
        const rows = await prisma.especialidade.findMany({
          where: { id: { in: ids }, ativo: true }, select: { id: true, nome: true },
        });
        especResolvidas = { ids: rows.map(r => r.id), tipoServico: rows[0]?.nome?.slice(0, 50) ?? null };
      }

      // Inclui na equipe que a tela está gerenciando (equipeIdBody) — garantirEquipePadrao
      // valida que ela pertence à empresa do gestor; caso contrário cai no contexto ativo.
      // Sem isso, a inclusão podia gravar numa equipe diferente da exibida na lista.
      const { equipe } = await garantirEquipePadrao(vetUserId, req.empresaId, equipeIdBody ?? req.equipeId);
      if (!equipe) return res.status(403).json({ sucesso: false, mensagem: 'Você não é gestor da empresa ativa.' });

      // Bloqueia se já é membro
      const usuarioCheck = await findUserByEmail(prisma, email);
      if (usuarioCheck) {
        const jaMembro = await prisma.membroEquipe.findUnique({
          where: { equipeId_userId: { equipeId: equipe.id, userId: usuarioCheck.id } },
        });
        if (jaMembro) {
          return res.status(409).json({ sucesso: false, mensagem: 'Este e-mail já faz parte da equipe' });
        }
      }

      // ── Validações que podem falhar ANTES de qualquer gravação ─────────────
      // (evita usuário/membro órfão quando a requisição é rejeitada no meio)

      // Remuneração — OBRIGATÓRIA na inclusão, EXCETO para GESTOR: é sócio/dono da
      // empresa, não folha de pagamento da clínica (tela "Cadastro da Empresa" >
      // Outros gestores não coleta forma de pagamento).
      const pagamento = cargo === 'GESTOR'
        ? { erro: null, dados: null }
        : normalizarPagamento({ tipoPagamento, formaPagamento, valorPagamento });
      if (pagamento.erro) return res.status(400).json({ sucesso: false, mensagem: pagamento.erro });

      // Acesso ao sistema — decisão explícita do gestor, sem padrão implícito.
      if (typeof acessoSistema !== 'boolean') {
        return res.status(400).json({ sucesso: false, mensagem: 'Informe se o membro terá acesso ao sistema.' });
      }

      // Expediente de trabalho (dias/horários) — valida o formato já aqui
      const expediente = parseExpedienteTrabalho(req.body);
      if (expediente.erro) return res.status(400).json({ sucesso: false, mensagem: expediente.erro });

      // Locais de trabalho (múltiplos) — valida antes de gravar qualquer coisa.
      // Local sem especialidade: veterinário assume Clínica Médica; demais perfis ficam
      // sem especialidade (e sem tempo de consulta) mesmo.
      const locaisParsed = parseLocaisTrabalho(req.body, {
        especialidadesPadrao: especPadrao,
        semEspecialidade:     !perfilComEspecialidade,
      });
      if (locaisParsed.erro) return res.status(400).json({ sucesso: false, mensagem: locaisParsed.erro });
      // Todo membro fica restrito ao dia/horário da empresa (EmpresaConfiguracao)
      if (locaisParsed.locais !== undefined) {
        const erroExp = await validarLocaisContraExpedienteEmpresa(req, locaisParsed.locais);
        if (erroExp) return res.status(400).json({ sucesso: false, mensagem: erroExp });
      }

      // Fornecedor selecionado já vinculado a OUTRA conta não pode ser reutilizado
      if (fornecedorVinculo?.userId && (!usuarioCheck || fornecedorVinculo.userId !== usuarioCheck.id)) {
        return res.status(409).json({ sucesso: false, mensagem: 'Este fornecedor já está vinculado a outro usuário' });
      }

      // Reverso: o usuário (por e-mail) já pode estar vinculado a OUTRO cadastro de
      // fornecedor. Como Fornecedor.userId é @unique, vincular/criar aqui violaria a
      // constraint (Unique constraint on user_id). Bloqueia com mensagem clara.
      if (cargo === 'FORNECEDOR' && usuarioCheck) {
        const fornecedorDoUsuario = await prisma.fornecedor.findUnique({ where: { userId: usuarioCheck.id } });
        if (fornecedorDoUsuario && (!fornecedorVinculo || fornecedorDoUsuario.id !== fornecedorVinculo.id)) {
          return res.status(409).json({ sucesso: false, mensagem: 'Este usuário já está vinculado a outro cadastro de fornecedor.' });
        }
      }

      // Buscar dados do vet dono + espécies
      const vetUser = await prisma.user.findUnique({ where: { id: vetUserId }, select: { fullName: true } });
      const vetPerfilDono = await prisma.vetPerfil.findUnique({
        where:   { userId: vetUserId },
        include: { especies: { include: { especie: { select: { nome: true } } } } },
      });
      const especiesDono      = vetPerfilDono?.especies.map(e => e.especie) ?? [];
      const especiesDonoComId = vetPerfilDono?.especies.map(e => e.especieId) ?? [];

      const SENHA_INICIAL = 'Inicial_001';
      const cargoToUserType = { VETERINARIO: 'VETERINARIO', ESTAGIARIO: 'ESTAGIARIO', GESTOR: 'VETERINARIO', ADMIN: 'VETERINARIO', MEMBRO: 'ESTAGIARIO', PROPRIETARIO: 'PROPRIETARIO', FORNECEDOR: 'FORNECEDOR', SECRETARIA: 'ESTAGIARIO', FINANCEIRO: 'ESTAGIARIO', ENFERMEIRO: 'ESTAGIARIO' };
      const userTypeNovo = cargoToUserType[cargo] || 'ESTAGIARIO';

      let usuarioCriado = false;
      let usuario = await findUserByEmail(prisma, email);
      // Rastreio p/ compensação em caso de falha no meio do fluxo (evita órfãos)
      var usuarioCriadoId = null;
      var membroCriadoId  = null;
      var equipeIdCriacao = equipe.id;
      var membroUserId    = null;

      if (!usuario) {
        const senhaHash = await bcrypt.hash(SENHA_INICIAL, 10);
        usuario = await prisma.user.create({
          data: {
            email,
            fullName:           fullName.trim(),
            phone:              phone.trim(),
            cep:                cep?.trim()         || null,
            endereco:           endereco?.trim()    || null,
            complemento:        complemento?.trim() || null,
            bairro:             bairro?.trim()      || null,
            cidade:             cidade?.trim()      || null,
            estado:             estado?.trim()      || null,
            passwordHash:       senhaHash,
            role:               'USER',
            userType:           userTypeNovo,
            mustChangePassword: true,
          },
        });
        usuarioCriado = true;
        usuarioCriadoId = usuario.id;
        // Usuário nasce ativo=true (default do schema): grava a trilha de ativação
        // também na CRIAÇÃO, senão "Ativado em/por" (Equipe.tsx) fica vazio até
        // alguém desativar e reativar — quem incluiu o membro não aparecia ali.
        await registrarAtivacao(prisma, usuario.id, req.user.id);
      } else if (!usuario.fullName?.trim() || !usuario.phone?.trim()) {
        // Usuário pré-existente sem cadastro completo: preenche nome/telefone informados
        usuario = await prisma.user.update({
          where: { id: usuario.id },
          data:  {
            fullName: usuario.fullName?.trim() ? usuario.fullName : fullName.trim(),
            phone:    usuario.phone?.trim()    ? usuario.phone    : phone.trim(),
          },
        });
      }

      // LIMITE DO PLANO — verificado ANTES de criar qualquer coisa: membro criado e só
      // depois recusado deixaria vínculo pela metade. Só consome assento quem terá acesso
      // ao sistema e não for PROPRIETARIO (D2) — ver lib/planoEmpresa.js.
      await garantirVagaDeUsuario(equipe.empresaId, {
        ocupaAssento: consomeAssento({ perfil: cargo, acessoSistema }),
      });

      // Adicionar à equipe diretamente
      // "Atender somente no local de trabalho" (checkbox) — false por padrão (atende em
      // qualquer local, comportamento de sempre). Ver lib/animalScope.js.
      const novoMembro = await prisma.membroEquipe.create({
        data: { equipeId: equipe.id, userId: usuario.id, cargo, restringirPorLocal: restringirPorLocal === true },
      });
      membroCriadoId = novoMembro.id;
      membroUserId   = usuario.id;

      // Cadastro do profissional NESTA empresa. Profissional que já existe (cadastrado
      // por outra clínica) entra como cadastro NOVO: o que vale é o que ESTA empresa
      // informou agora — nada é herdado do cadastro da outra.
      const cadastroNestaEmpresa = {
        fullName:    fullName.trim(),
        phone:       phone.trim(),
        cep:         cep?.trim()         || null,
        endereco:    endereco?.trim()    || null,
        complemento: complemento?.trim() || null,
        bairro:      bairro?.trim()      || null,
        cidade:      cidade?.trim()      || null,
        estado:      estado?.trim()      || null,
        ativo:       true,
      };
      // Fonte nova: tabela de ligação usuário × empresa. O PERFIL é o cargo que o
      // gestor escolheu AQUI — é ele que vale nesta empresa, não o tipo do login.
      await salvarVinculo(prisma, usuario.id, equipe.empresaId, { perfil: cargo, ...cadastroNestaEmpresa });
      // Remuneração e acesso: colunas novas, gravadas à parte (ver lib/usuarioEmpresa.js)
      await salvarPagamentoEAcesso(prisma, usuario.id, equipe.empresaId, {
        ...pagamento.dados,
        acessoSistema,
      });
      await salvarPerfilProfissional(prisma, usuario.id, equipe.empresaId, cadastroNestaEmpresa);

      // Locais de trabalho (múltiplos). Quando enviados, eles são a fonte do
      // expediente — a agregação sincroniza os campos únicos que a Agenda lê. Sem
      // locais, cai no expediente único informado diretamente (compat).
      if (locaisParsed.locais !== undefined) {
        await gravarLocaisTrabalho(prisma, novoMembro.id, locaisParsed.locais);
      } else {
        await gravarExpedienteTrabalho(novoMembro.id, expediente);
      }

      // Vincular/criar cadastro Fornecedor
      let fornecedorFinalId = null;
      if (cargo === 'FORNECEDOR') {
        if (fornecedorVinculo) {
          await prisma.fornecedor.update({
            where: { id: fornecedorVinculo.id },
            data: {
              userId:   usuario.id,
              email:    fornecedorVinculo.email    || email,
              telefone: fornecedorVinculo.telefone || phone.trim(),
            },
          });
          fornecedorFinalId = fornecedorVinculo.id;
        } else {
          const novoForn = await prisma.fornecedor.create({
            data: {
              nome:        fullName.trim(),
              email,
              telefone:    phone.trim(),
              tipoServico: especResolvidas?.tipoServico ?? tipoServico?.trim() ?? 'Prestador',
              tipoEntrada: 'CLIENTE',
              empresaId:   req.empresaId ?? null,
              equipeId:    equipe.id,
              userId:      usuario.id,
            },
          });
          fornecedorFinalId = novoForn.id;
        }
      }

      // Especialidades (catálogo por espécie) — POR EMPRESA: o que o profissional exerce
      // nas outras clínicas não é lido nem apagado aqui.
      if (especResolvidas) {
        await prisma.usuarioEspecialidade.deleteMany({
          where: { userId: usuario.id, empresaId: equipe.empresaId },
        });
        if (especResolvidas.ids.length > 0) {
          await prisma.usuarioEspecialidade.createMany({
            data: especResolvidas.ids.map(especialidadeId => ({
              userId: usuario.id, especialidadeId, empresaId: equipe.empresaId,
            })),
            skipDuplicates: true,
          });
        }
        // Só grava no cadastro de Fornecedor quando ele é NOVO — um fornecedor
        // existente preserva as especialidades definidas no próprio cadastro.
        if (fornecedorFinalId && !fornecedorVinculo && especResolvidas.ids.length > 0) {
          await prisma.fornecedorEspecialidade.createMany({
            data: especResolvidas.ids.map(especialidadeId => ({ fornecedorId: fornecedorFinalId, especialidadeId })),
            skipDuplicates: true,
          });
        }
      }

      // Propagar permissões do MatrizPerfil para o novo membro
      await PermissaoService.aplicarPermissoesPadrao({
        equipeId:      equipe.id,
        userId:        usuario.id,
        cargo,
        atualizadoPor: vetUserId,
      });

      // Marcar isConvidado e copiar espécies
      await aplicarOnboardingConvidado(usuario.id, equipe.id);
      if (userTypeNovo === 'VETERINARIO' && especiesDonoComId.length > 0) {
        let perfilNovo = await prisma.vetPerfil.findUnique({ where: { userId: usuario.id } });
        if (!perfilNovo) {
          perfilNovo = await prisma.vetPerfil.create({ data: { userId: usuario.id } });
        }
        const jaTemEspecies = await prisma.vetEspecie.count({ where: { vetPerfilId: perfilNovo.id } });
        if (jaTemEspecies === 0) {
          await prisma.$transaction(
            especiesDonoComId.map(especieId =>
              prisma.vetEspecie.upsert({
                where:  { vetPerfilId_especieId: { vetPerfilId: perfilNovo.id, especieId } },
                update: {},
                create: { vetPerfilId: perfilNovo.id, especieId },
              })
            )
          );
        }
      }

      // Email de notificação (sem link de aceite)
      emailService.enviarInclusaoEquipe({
        email,
        cargo,
        vetNome:       vetUser?.fullName || 'Veterinário',
        equipeNome:    equipe.nome,
        usuarioCriado,
        senhaInicial:  usuarioCriado ? SENHA_INICIAL : null,
        especiesNomes: especiesDono.map(e => e.nome).filter(Boolean),
      }).catch(err => console.error('[emailService] Falha ao enviar notificação de inclusão:', err));

      res.status(201).json({ sucesso: true, mensagem: 'Membro incluído com sucesso!', dados: { userId: usuario.id, fullName: usuario.fullName } });
    } catch (err) {
      console.error('Erro ao incluir membro:', err);
      // Compensação (melhor esforço): desfaz o que esta requisição criou para não
      // deixar cadastro órfão — que causava "já existe" no retry e depois duplicata.
      try {
        if (membroCriadoId) {
          await prisma.permissaoMembro.deleteMany({ where: { equipeId: equipeIdCriacao, userId: membroUserId } }).catch(() => {});
          await prisma.membroEquipe.delete({ where: { id: membroCriadoId } }).catch(() => {});
        }
        if (usuarioCriadoId) {
          await prisma.usuarioEspecialidade.deleteMany({ where: { userId: usuarioCriadoId } }).catch(() => {});
          await prisma.fornecedor.updateMany({ where: { userId: usuarioCriadoId }, data: { userId: null } }).catch(() => {});
          await prisma.user.delete({ where: { id: usuarioCriadoId } }).catch(() => {});
        }
      } catch { /* melhor esforço — não mascarar o erro original */ }
      // Limite do plano é regra de NEGÓCIO, não falha do servidor: precisa chegar à tela
      // com 409 e a mensagem dizendo o limite, o uso atual e a saída. Como 500 genérico,
      // o gestor veria "Erro interno" e não teria como saber que basta trocar de plano.
      if (err.code === 'LIMITE_USUARIOS_PLANO') {
        return res.status(409).json({ sucesso: false, mensagem: err.message, code: err.code, ...err.dados });
      }
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  convidarGestorAdmin: async (req, res) => {
    try {
      if ((req.user.role !== 'ADMIN' && req.user.userType !== 'ADMIN')) {
        return res.status(403).json({ sucesso: false, mensagem: 'Apenas administradores podem usar esta rota.' });
      }

      const { email: emailRaw, fullName, empresaNome, cnpj, cpf, nomeEquipe, especiesIds, equipeId: equipeIdParam, empresaId: empresaIdParam } = req.body;
      const email = (emailRaw ?? '').trim().toLowerCase();

      if (!email) return res.status(400).json({ sucesso: false, mensagem: 'E-mail é obrigatório.' });

      const usandoExistente = !!equipeIdParam || !!empresaIdParam;

      const isCnpj = !!cnpj?.trim();
      const isCpf  = !isCnpj && !!cpf?.trim();
      if (!usandoExistente) {
        if (!empresaNome?.trim()) return res.status(400).json({ sucesso: false, mensagem: 'Nome é obrigatório.' });
        if (!isCnpj && !isCpf)   return res.status(400).json({ sucesso: false, mensagem: 'Informe o CNPJ ou CPF.' });
      }

      const cnpjNorm = isCnpj ? cnpj.replace(/\D/g, '') : null;
      const cpfNorm  = isCpf  ? cpf.replace(/\D/g, '')  : null;

      // Cria usuário se não existir
      const SENHA_INICIAL  = 'Inicial_001';
      let usuarioExistente = await findUserByEmail(prisma, email);
      let usuarioCriado    = false;

      if (!usuarioExistente) {
        const senhaHash = await bcrypt.hash(SENHA_INICIAL, 10);
        usuarioExistente = await prisma.user.create({
          data: {
            email,
            fullName:           (fullName ?? empresaNome)?.trim() || '',
            passwordHash:       senhaHash,
            role:               'USER',
            userType:           'VETERINARIO',
            mustChangePassword: true,
            ...(cpfNorm  ? { cpf:  cpfNorm  } : {}),
            ...(cnpjNorm ? { cnpj: cnpjNorm } : {}),
          },
        });
        usuarioCriado = true;
      }
      const convidadoId = usuarioExistente.id;

      let empresa, equipe;

      if (equipeIdParam) {
        // CPF + equipe existente selecionada diretamente
        equipe = await prisma.equipe.findUnique({ where: { id: Number(equipeIdParam) }, include: { empresa: true } });
        if (!equipe) return res.status(404).json({ sucesso: false, mensagem: 'Equipe não encontrada.' });
        empresa = equipe.empresa;
      } else if (empresaIdParam) {
        // CNPJ + empresa existente selecionada diretamente
        empresa = await prisma.empresa.findUnique({ where: { id: Number(empresaIdParam) } });
        if (!empresa) return res.status(404).json({ sucesso: false, mensagem: 'Empresa não encontrada.' });
        equipe = await prisma.equipe.findFirst({ where: { empresaId: empresa.id } });
        if (!equipe) {
          // Nome da equipe nunca é genérico: sem nome informado, o da própria empresa.
          equipe = await prisma.equipe.create({ data: { nome: nomeEquipe?.trim() || empresa.nome, empresaId: empresa.id } });
        }
      } else if (isCnpj) {
        // CNPJ: reutiliza empresa por CNPJ + nome (mesmo CNPJ com nome diferente cria outra empresa)
        empresa = await prisma.empresa.findFirst({
          where: { cnpj: cnpjNorm, nome: { equals: empresaNome.trim(), mode: 'insensitive' } },
        });
        if (!empresa) {
          empresa = await prisma.empresa.create({
            data: { nome: empresaNome.trim(), cnpj: cnpjNorm, ownerId: convidadoId },
          });
        }
        equipe = await prisma.equipe.findFirst({ where: { empresaId: empresa.id } });
        if (!equipe) {
          // Nome da equipe nunca é genérico: sem nome informado, o da própria empresa.
          equipe = await prisma.equipe.create({ data: { nome: nomeEquipe?.trim() || empresa.nome, empresaId: empresa.id } });
        }
      } else {
        // CPF: empresa pessoal do convidado — reutiliza só se o nome também coincidir
        // (mesmo CPF + e-mail com nome diferente = nova empresa permitida)
        empresa = await prisma.empresa.findFirst({
          where: { ownerId: convidadoId, cnpj: null, nome: { equals: empresaNome.trim(), mode: 'insensitive' } },
        });
        if (!empresa) {
          empresa = await prisma.empresa.create({
            data: { nome: empresaNome.trim(), cnpj: null, ownerId: convidadoId },
          });
        }
        const nomeEquipeFinal = nomeEquipe?.trim() || empresa.nome;
        equipe = await prisma.equipe.findFirst({
          where: { empresaId: empresa.id, nome: { equals: nomeEquipeFinal, mode: 'insensitive' } },
        });
        if (!equipe) {
          equipe = await prisma.equipe.create({ data: { nome: nomeEquipeFinal, empresaId: empresa.id } });
        }
      }

      const jaMembro = await prisma.membroEquipe.findUnique({
        where: { equipeId_userId: { equipeId: equipe.id, userId: convidadoId } },
      });
      if (jaMembro) {
        return res.status(409).json({ sucesso: false, mensagem: 'Este usuário já é membro desta equipe.' });
      }

      // Inclui diretamente como GESTOR — sem convite, acesso imediato
      const membro = await prisma.membroEquipe.create({
        data: { equipeId: equipe.id, userId: convidadoId, cargo: 'GESTOR' },
      });
      await vincularMembro(prisma, convidadoId, equipe.id, 'GESTOR');

      // Instância de WhatsApp exclusiva da clínica (Evolution API) — best-effort
      require('../services/whatsappService').provisionarPorEmpresa(empresa.id).catch(() => {});

      try {
        await prisma.$executeRawUnsafe(`UPDATE schs2vet.users SET "isConvidado" = true WHERE id = $1`, convidadoId);
      } catch { /* ignora */ }

      const idsEspecies = Array.isArray(especiesIds) ? especiesIds.map(Number).filter(Boolean) : [];
      if (idsEspecies.length > 0) {
        let vetPerfil = await prisma.vetPerfil.findUnique({ where: { userId: convidadoId } });
        if (!vetPerfil) {
          vetPerfil = await prisma.vetPerfil.create({ data: { userId: convidadoId } });
        }
        await prisma.$transaction(
          idsEspecies.map(especieId =>
            prisma.vetEspecie.upsert({
              where:  { vetPerfilId_especieId: { vetPerfilId: vetPerfil.id, especieId } },
              update: {},
              create: { vetPerfilId: vetPerfil.id, especieId },
            })
          )
        );
      }

      emailService.enviarAcessoGestor({
        email,
        nomeGestor:  (fullName ?? empresaNome)?.trim() || email,
        empresaNome: empresa.nome,
        equipeName:  equipe.nome,
        usuarioCriado,
        senhaInicial: usuarioCriado ? SENHA_INICIAL : null,
      }).catch(err => console.error('[emailService] Falha ao enviar e-mail de acesso gestor:', err));

      return res.status(201).json({ sucesso: true, dados: membro, mensagem: 'Gestor incluído com sucesso' });
    } catch (err) {
      console.error('Erro ao convidar gestor:', err);
      if (err.code === 'P2002') return res.status(409).json({ sucesso: false, mensagem: req.body.cnpj?.trim() ? 'CNPJ já cadastrado para outra empresa.' : 'Conflito de dados ao criar empresa.' });
      return res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  convidarParaEquipe: async (req, res) => {
    try {
      const equipeId = Number(req.params.equipeId);
      const { email: emailRaw, cargo, fullName, tipoPagamento, formaPagamento, valorPagamento, acessoSistema } = req.body;
      const email = (emailRaw ?? '').trim().toLowerCase();

      if (!email || !cargo) {
        return res.status(400).json({ sucesso: false, mensagem: 'email e cargo são obrigatórios' });
      }

      // Remuneração e acesso são decididos AQUI e aplicados ao vínculo no aceite —
      // é o mesmo acordo da inclusão direta, só que adiantado.
      const pagamentoConvite = normalizarPagamento({ tipoPagamento, formaPagamento, valorPagamento });
      if (pagamentoConvite.erro) return res.status(400).json({ sucesso: false, mensagem: pagamentoConvite.erro });
      if (typeof acessoSistema !== 'boolean') {
        return res.status(400).json({ sucesso: false, mensagem: 'Informe se o membro terá acesso ao sistema.' });
      }

      // Apenas ADMIN (role sistêmica) ou GESTOR da equipe podem usar esta rota
      const isAdmin = (req.user.role === 'ADMIN' || req.user.userType === 'ADMIN');
      if (!isAdmin) {
        const membroSolicitante = await prisma.membroEquipe.findUnique({
          where: { equipeId_userId: { equipeId, userId: req.user.id } },
          select: { cargo: true },
        });
        if (!membroSolicitante || membroSolicitante.cargo !== 'GESTOR') {
          return res.status(403).json({ sucesso: false, mensagem: 'Apenas administradores ou gestores podem convidar membros.' });
        }
      }

      const equipe = await prisma.equipe.findUnique({
        where: { id: equipeId },
        select: { id: true, nome: true, empresaId: true },
      });
      if (!equipe) return res.status(404).json({ sucesso: false, mensagem: 'Equipe não encontrada' });

      // LIMITE DO PLANO já no ENVIO do convite — falha CEDO. A trava obrigatória é no
      // aceite (a vaga pode acabar entre convidar e aceitar), mas convidar alguém para
      // depois a pessoa levar 409 ao aceitar é péssimo dos dois lados.
      if (equipe.empresaId) {
        try {
          await garantirVagaDeUsuario(equipe.empresaId, {
            ocupaAssento: consomeAssento({ perfil: cargo, acessoSistema: acessoSistema !== false }),
          });
        } catch (e) {
          if (e.code === 'LIMITE_USUARIOS_PLANO') {
            return res.status(409).json({ sucesso: false, mensagem: e.message, code: e.code, ...e.dados });
          }
          throw e;
        }
      }

      // Bloqueia re-convite: membro já existente
      const usuarioCheck = await findUserByEmail(prisma, email);
      if (usuarioCheck) {
        const jaMembro = await prisma.membroEquipe.findUnique({
          where: { equipeId_userId: { equipeId, userId: usuarioCheck.id } },
        });
        if (jaMembro) {
          return res.status(409).json({ sucesso: false, mensagem: 'Este e-mail já faz parte da equipe.' });
        }
      }

      // Bloqueia re-convite: já existe convite PENDENTE não expirado
      const conviteAtivo = await prisma.conviteEquipe.findFirst({
        where: { equipeId, email, status: 'PENDENTE', expiresAt: { gt: new Date() } },
      });
      if (conviteAtivo) {
        return res.status(409).json({ sucesso: false, mensagem: 'Já existe um convite pendente para este e-mail.' });
      }

      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const convite   = await prisma.conviteEquipe.create({
        data: { equipeId, email, cargo, expiresAt },
      });
      // Colunas novas gravadas por SQL cru — o client Prisma pode não conhecê-las
      // (no Windows o `generate` falha com o backend rodando).
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE schs2vet.tb_convites_equipe
              SET tipo_pagamento = $1, forma_pagamento = $2, valor_pagamento = $3, acesso_sistema = $4
            WHERE id = $5`,
          pagamentoConvite.dados.tipoPagamento,
          pagamentoConvite.dados.formaPagamento,
          pagamentoConvite.dados.valorPagamento,
          acessoSistema === true,
          convite.id,
        );
      } catch { /* colunas ainda não migradas */ }

      // Cria usuário se ainda não existir
      const SENHA_INICIAL     = 'Inicial_001';
      const cargoToUserType   = { VETERINARIO: 'VETERINARIO', ESTAGIARIO: 'ESTAGIARIO', PROPRIETARIO: 'PROPRIETARIO', ADMIN: 'VETERINARIO', MEMBRO: 'ESTAGIARIO', FORNECEDOR: 'FORNECEDOR', SECRETARIA: 'ESTAGIARIO', FINANCEIRO: 'ESTAGIARIO', ENFERMEIRO: 'ESTAGIARIO' };
      const userTypeConvidado = cargoToUserType[cargo] ?? 'ESTAGIARIO';
      const usuarioExistente  = await findUserByEmail(prisma, email);
      let usuarioCriado      = false;
      let usuarioConvidadoId = usuarioExistente?.id ?? null;

      if (!usuarioExistente) {
        const senhaHash   = await bcrypt.hash(SENHA_INICIAL, 10);
        const novoUsuario = await prisma.user.create({
          data: {
            email,
            fullName:           fullName?.trim() || '',
            passwordHash:       senhaHash,
            role:               'USER',
            userType:           userTypeConvidado,
            mustChangePassword: true,
          },
        });
        usuarioConvidadoId = novoUsuario.id;
        usuarioCriado      = true;
      }

      if (usuarioConvidadoId) {
        try {
          await prisma.$executeRawUnsafe(`UPDATE schs2vet.users SET "isConvidado" = true WHERE id = $1`, usuarioConvidadoId);
        } catch { /* ignora se coluna ainda não existir */ }
      }

      // ADMIN convida como Gestor → email diferenciado (cria organização)
      // GESTOR convida membros comuns → email padrão de equipe
      if (isAdmin) {
        emailService.enviarConviteAdmin({
          email,
          token:         convite.token,
          usuarioCriado,
          senhaInicial:  usuarioCriado ? SENHA_INICIAL : null,
        }).catch(err => console.error('[emailService] Falha ao enviar convite admin:', err));
      } else {
        const convidadoPorNome = req.user.fullName || 'Gestor';
        emailService.enviarConviteEquipe({
          email,
          cargo,
          token:         convite.token,
          vetNome:       convidadoPorNome,
          equipeNome:    equipe.nome,
          usuarioCriado,
          senhaInicial:  usuarioCriado ? SENHA_INICIAL : null,
          especiesNomes: [],
        }).catch(err => console.error('[emailService] Falha ao enviar convite:', err));
      }

      return res.status(201).json({
        sucesso:  true,
        dados:    convite,
        mensagem: 'Convite enviado por e-mail',
      });
    } catch (err) {
      console.error('Erro ao convidar para equipe:', err);
      if (err.code === 'P2002') return res.status(409).json({ sucesso: false, mensagem: 'Convite duplicado.' });
      return res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  verificarConvite: async (req, res) => {
    try {
      const { token } = req.params;
      const convite   = await prisma.conviteEquipe.findUnique({
        where:   { token },
        include: { equipe: { include: { empresa: { select: { nome: true } } } } },
      });

      if (!convite)                       return res.status(404).json({ sucesso: false, mensagem: 'Convite não encontrado' });
      if (convite.status !== 'PENDENTE')  return res.status(410).json({ sucesso: false, mensagem: 'Convite já utilizado ou cancelado' });
      if (new Date() > convite.expiresAt) return res.status(410).json({ sucesso: false, mensagem: 'Convite expirado' });

      res.json({ sucesso: true, dados: { email: convite.email, cargo: convite.cargo, equipe: convite.equipe } });
    } catch (err) {
      console.error('Erro ao verificar convite:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  aceitarConvite: async (req, res) => {
    try {
      const { token } = req.params;
      const userId    = req.user.id;

      const convite = await prisma.conviteEquipe.findUnique({ where: { token } });
      if (!convite)                       return res.status(404).json({ sucesso: false, mensagem: 'Convite não encontrado' });
      if (convite.status !== 'PENDENTE')  return res.status(410).json({ sucesso: false, mensagem: 'Convite já utilizado' });
      if (new Date() > convite.expiresAt) return res.status(410).json({ sucesso: false, mensagem: 'Convite expirado' });

      const jaEMembro = await prisma.membroEquipe.findUnique({
        where: { equipeId_userId: { equipeId: convite.equipeId, userId } },
      });
      if (jaEMembro) return res.status(409).json({ sucesso: false, mensagem: 'Você já é membro desta equipe' });

      // LIMITE DO PLANO no ACEITE — e não só no envio do convite. ⚠️ Entre convidar e
      // aceitar pode ter entrado outra pessoa e fechado a última vaga: verificar apenas
      // no envio deixaria o plano ser estourado por um convite antigo.
      // O acesso ao sistema vem do que foi definido NO CONVITE (coluna `acesso_sistema`).
      const equipeAlvo = await prisma.equipe.findUnique({
        where: { id: convite.equipeId }, select: { empresaId: true },
      });
      if (equipeAlvo?.empresaId) {
        let acessoDoConvite = true;
        try {
          const rows = await prisma.$queryRawUnsafe(
            'SELECT acesso_sistema FROM schs2vet.tb_convites_equipe WHERE id = $1', convite.id,
          );
          acessoDoConvite = rows?.[0]?.acesso_sistema !== false;
        } catch { /* convite legado, sem a coluna — assume com acesso */ }

        try {
          await garantirVagaDeUsuario(equipeAlvo.empresaId, {
            ocupaAssento: consomeAssento({ perfil: convite.cargo, acessoSistema: acessoDoConvite }),
          });
        } catch (e) {
          if (e.code === 'LIMITE_USUARIOS_PLANO') {
            return res.status(409).json({ sucesso: false, mensagem: e.message, code: e.code, ...e.dados });
          }
          throw e;
        }
      }

      await prisma.$transaction([
        prisma.membroEquipe.create({ data: { equipeId: convite.equipeId, userId, cargo: convite.cargo } }),
        prisma.conviteEquipe.update({ where: { token }, data: { status: 'ACEITO' } }),
      ]);
      await vincularMembro(prisma, userId, convite.equipeId, convite.cargo);

      // O acordo definido no convite passa a valer agora que existe vínculo.
      const equipeDoConvite = await prisma.equipe.findUnique({
        where: { id: convite.equipeId }, select: { empresaId: true },
      });
      if (equipeDoConvite?.empresaId) {
        try {
          const rows = await prisma.$queryRawUnsafe(
            `SELECT tipo_pagamento, forma_pagamento, valor_pagamento, acesso_sistema
               FROM schs2vet.tb_convites_equipe WHERE id = $1`,
            convite.id,
          );
          const c = rows?.[0];
          if (c) {
            await salvarPagamentoEAcesso(prisma, userId, equipeDoConvite.empresaId, {
              ...(c.tipo_pagamento  != null && { tipoPagamento:  c.tipo_pagamento }),
              ...(c.forma_pagamento != null && { formaPagamento: c.forma_pagamento }),
              ...(c.valor_pagamento != null && { valorPagamento: c.valor_pagamento }),
              acessoSistema: c.acesso_sistema !== false,
            });
          }
        } catch { /* convite legado, sem as colunas */ }
      }

      // Aplica permissões padrão para o cargo
      await PermissaoService.aplicarPermissoesPadrao({
        equipeId:      convite.equipeId,
        userId,
        cargo:         convite.cargo,
        atualizadoPor: 0,
      });

      // Marca como convidado e copia espécies do dono da equipe
      await aplicarOnboardingConvidado(userId, convite.equipeId);

      res.json({ sucesso: true, mensagem: 'Bem-vindo à equipe!' });
    } catch (err) {
      console.error('Erro ao aceitar convite:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // GET /api/equipes/minhas-especies
  // Retorna os nomes das espécies que a equipe/empresa do usuário atende.
  // ADMIN → todas as espécies. VET → do próprio VetPerfil. GESTOR/outros → união dos vets da equipe.
  getMinhasEspecies: async (req, res) => {
    try {
      const userId = Number(req.user.id);

      if ((req.user.role === 'ADMIN' || req.user.userType === 'ADMIN')) {
        const todas = await prisma.especie.findMany({ select: { nome: true } });
        return res.json({ sucesso: true, dados: todas.map(e => e.nome) });
      }

      // Busca o VetPerfil do próprio usuário
      const perfilProprio = await prisma.vetPerfil.findUnique({
        where:   { userId },
        include: { especies: { include: { especie: { select: { nome: true } } } } },
      });

      if (perfilProprio?.especies?.length) {
        const nomes = perfilProprio.especies.map(ve => ve.especie.nome);
        return res.json({ sucesso: true, dados: [...new Set(nomes)] });
      }

      // Para GESTOR ou usuário sem VetPerfil: busca as espécies de todos os vets da equipe
      const membro = await prisma.membroEquipe.findFirst({
        where:   { userId },
        include: { equipe: { select: { id: true, membros: { select: { userId: true } } } } },
      });

      if (!membro?.equipe) {
        return res.json({ sucesso: true, dados: [] });
      }

      const userIds = membro.equipe.membros.map(m => m.userId);
      const perfis  = await prisma.vetPerfil.findMany({
        where:   { userId: { in: userIds } },
        include: { especies: { include: { especie: { select: { nome: true } } } } },
      });

      const nomes = perfis.flatMap(p => p.especies.map(ve => ve.especie.nome));
      return res.json({ sucesso: true, dados: [...new Set(nomes)] });
    } catch (err) {
      console.error('Erro ao buscar espécies da equipe:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao buscar espécies' });
    }
  },

  getMinhaEquipe: async (req, res) => {
    try {
      // Prioriza equipe ativa (gestor CPF) > empresa ativa (gestor CNPJ) > primeira equipe
      const whereBase = { userId: Number(req.user.id) };
      const where = req.equipeId
        ? { ...whereBase, equipeId: req.equipeId }
        : req.empresaId
          ? { ...whereBase, equipe: { empresaId: req.empresaId } }
          : whereBase;

      const includeEquipe = {
        equipe: {
          include: {
            empresa: true,
            membros: {
              include: {
                user: { select: { id: true, fullName: true, email: true, phone: true, ativo: true, userType: true } },
              },
              orderBy: { createdAt: 'asc' },
            },
            convites: {
              where: { status: 'PENDENTE', expiresAt: { gt: new Date() } },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      };

      let membro = await prisma.membroEquipe.findFirst({
        where,
        include: includeEquipe,
        orderBy: { createdAt: 'asc' },
      });

      // Sem MembroEquipe no contexto ativo (ex.: owner sem registro) → primeira equipe geral
      if (!membro?.equipe && (req.equipeId || req.empresaId)) {
        membro = await prisma.membroEquipe.findFirst({
          where: whereBase,
          include: includeEquipe,
          orderBy: { createdAt: 'asc' },
        });
      }

      if (!membro?.equipe) return res.status(404).json({ sucesso: false, mensagem: 'Nenhuma equipe encontrada.' });
      res.json({ sucesso: true, dados: membro.equipe });
    } catch (err) {
      console.error('Erro ao buscar equipe:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  recusarConvite: async (req, res) => {
    try {
      const { token } = req.params;
      const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { email: true } });
      const convite = await prisma.conviteEquipe.findUnique({ where: { token } });

      if (!convite)                      return res.status(404).json({ sucesso: false, mensagem: 'Convite não encontrado' });
      if (convite.status !== 'PENDENTE') return res.status(410).json({ sucesso: false, mensagem: 'Convite já respondido' });
      if (!user || normalizeEmail(user.email) !== normalizeEmail(convite.email)) {
        return res.status(403).json({ sucesso: false, mensagem: 'Convite pertence a outro e-mail.' });
      }

      await prisma.conviteEquipe.update({ where: { token }, data: { status: 'RECUSADO' } });
      res.json({ sucesso: true, mensagem: 'Convite recusado.' });
    } catch (err) {
      console.error('Erro ao recusar convite:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  recusarMeusConvites: async (req, res) => {
    try {
      const email = req.user.email;
      await prisma.conviteEquipe.updateMany({
        where: { email, status: 'PENDENTE' },
        data:  { status: 'RECUSADO' },
      });
      res.json({ sucesso: true });
    } catch (err) {
      console.error('Erro ao recusar convites:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  autoAceitarConvites: async (req, res) => {
    try {
      const email  = req.user.email;
      // Busca o usuario no banco para garantir o id correto (evita problema de tipo com JWT)
      const dbUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (!dbUser) return res.status(404).json({ sucesso: false, mensagem: 'Usuário não encontrado' });
      const userId = dbUser.id;

      const convitesPendentes = await prisma.conviteEquipe.findMany({
        where: { email, status: 'PENDENTE', expiresAt: { gt: new Date() } },
      });

      let aceitos = 0;
      for (const convite of convitesPendentes) {
        const jaEMembro = await prisma.membroEquipe.findUnique({
          where: { equipeId_userId: { equipeId: convite.equipeId, userId } },
        });
        if (jaEMembro) continue;

        await prisma.$transaction([
          prisma.membroEquipe.create({ data: { equipeId: convite.equipeId, userId, cargo: convite.cargo } }),
          prisma.conviteEquipe.update({ where: { id: convite.id }, data: { status: 'ACEITO' } }),
        ]);
        await vincularMembro(prisma, userId, convite.equipeId, convite.cargo);

        await PermissaoService.aplicarPermissoesPadrao({
          equipeId:      convite.equipeId,
          userId,
          cargo:         convite.cargo,
          atualizadoPor: 0,
        });

        // Marca como convidado e copia espécies do dono da equipe
        await aplicarOnboardingConvidado(userId, convite.equipeId);
        aceitos++;
      }

      res.json({ sucesso: true, dados: { aceitos } });
    } catch (err) {
      console.error('Erro ao auto-aceitar convites:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  removerConvite: async (req, res) => {
    try {
      const userId    = req.user.id;
      const conviteId = Number(req.params.conviteId);

      const empresa = await getEmpresaDoGestor(userId, req.empresaId);
      if (!empresa) return res.status(403).json({ sucesso: false, mensagem: 'Sem permissão' });

      const equipe = await getEquipeAtiva(empresa.id, req.equipeId);
      if (!equipe) return res.status(403).json({ sucesso: false, mensagem: 'Sem permissão' });

      const convite = await prisma.conviteEquipe.findFirst({ where: { id: conviteId, equipeId: equipe.id } });
      if (!convite) return res.status(404).json({ sucesso: false, mensagem: 'Convite não encontrado' });
      if (convite.status === 'ACEITO') {
        return res.status(400).json({ sucesso: false, mensagem: 'Convite já aceito — remova o membro pela lista de membros' });
      }

      await prisma.conviteEquipe.delete({ where: { id: conviteId } });
      res.json({ sucesso: true, mensagem: 'Convite removido' });
    } catch (err) {
      console.error('Erro ao remover convite:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  cancelarConvite: async (req, res) => {
    try {
      const equipeId  = Number(req.params.equipeId);
      const conviteId = Number(req.params.conviteId);

      const membroSolicitante = await prisma.membroEquipe.findUnique({
        where: { equipeId_userId: { equipeId, userId: req.user.id } },
        select: { cargo: true },
      });
      if (!membroSolicitante || membroSolicitante.cargo !== 'GESTOR') {
        return res.status(403).json({ sucesso: false, mensagem: 'Apenas gestores podem cancelar convites.' });
      }

      await prisma.conviteEquipe.updateMany({
        where: { id: conviteId, equipeId, status: 'PENDENTE' },
        data:  { status: 'CANCELADO' },
      });
      res.json({ sucesso: true, mensagem: 'Convite cancelado.' });
    } catch (err) {
      console.error('Erro ao cancelar convite:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // Atribui múltiplos cargos a um membro. As permissões são a união (max nivel) de todos os perfis.
  alterarCargos: async (req, res) => {
    try {
      const equipeId   = Number(req.params.equipeId);
      const alvoUserId = Number(req.params.alvoUserId);
      const { cargos } = req.body;

      if (!Array.isArray(cargos) || cargos.length === 0) {
        return res.status(400).json({ sucesso: false, mensagem: 'cargos deve ser um array não-vazio.' });
      }
      if (cargos.includes('PROPRIETARIO')) {
        return res.status(400).json({ sucesso: false, mensagem: 'O perfil PROPRIETARIO é atribuído automaticamente.' });
      }

      // ADMIN bypass. Gestor pode conceder QUALQUER cargo, GESTOR incluído — mesma
      // regra de incluirMembroDireto ("Cadastro da Empresa > Incluir gestor"). O
      // único limite é não alterar cargos de OUTRO gestor (a própria linha segue
      // liberada — "editar a mim mesmo" pela lista da equipe).
      if ((req.user.role !== 'ADMIN' && req.user.userType !== 'ADMIN')) {
        const membroSolicitante = await prisma.membroEquipe.findUnique({
          where: { equipeId_userId: { equipeId, userId: req.user.id } },
          select: { cargo: true },
        });
        if (!membroSolicitante || membroSolicitante.cargo !== 'GESTOR') {
          return res.status(403).json({ sucesso: false, mensagem: 'Apenas gestores podem alterar cargos.' });
        }
        if (alvoUserId !== req.user.id) {
          const alvoMembro = await prisma.membroEquipe.findUnique({
            where: { equipeId_userId: { equipeId, userId: alvoUserId } },
            select: { cargo: true },
          });
          if (alvoMembro?.cargo === 'GESTOR') {
            return res.status(403).json({ sucesso: false, mensagem: 'Gestores não podem ter os cargos alterados por outros gestores.' });
          }
        }
      }

      // Garante que todos os perfis padrão existam (evita 400 por PerfilEquipe ausente
      // quando o gestor usa Equipe.tsx antes de abrir ControleAcesso).
      await PermissaoService.garantirPerfisPadrao(equipeId);

      // Valida que todos os cargos existem na equipe
      for (const cargo of cargos) {
        const perfilExiste = await prisma.perfilEquipe.findUnique({
          where: { equipeId_slug: { equipeId, slug: cargo } },
        });
        if (!perfilExiste) {
          return res.status(400).json({ sucesso: false, mensagem: `Cargo "${cargo}" não existe nesta equipe.` });
        }
      }

      // Cargo primário: GESTOR tem prioridade, senão o primeiro da lista
      const cargoPrimario = cargos.includes('GESTOR') ? 'GESTOR' : cargos[0];

      // Carrega as matrizes de permissão de todos os cargos e faz a união (nivel máximo).
      // Fallback para PERMISSOES_PADRAO quando MatrizPerfil não está semeada para o cargo
      // nesta equipe — evita que a segunda role contribua zero para a união.
      // NEGADO em qualquer cargo vence (deny-wins) sobre qualquer nível positivo dos demais.
      const NIVEL_ORD = { NENHUM: 0, LEITURA: 1, PROPRIO: 2, EQUIPE: 3, FULL: 4 };
      const matrizes = await prisma.matrizPerfil.findMany({
        where: { equipeId, perfilSlug: { in: cargos } },
      });

      // Agrupa por cargo para detectar cargos sem entradas no banco
      const slugsPorCargo = {};
      for (const m of matrizes) {
        if (!slugsPorCargo[m.perfilSlug]) slugsPorCargo[m.perfilSlug] = {};
        slugsPorCargo[m.perfilSlug][m.moduloSlug] = m.nivel;
      }

      const mapaUniao = {};
      for (const cargo of cargos) {
        // MatrizPerfil da equipe tem prioridade; PERMISSOES_PADRAO como fallback
        const matrizCargo  = slugsPorCargo[cargo] ?? {};
        const defaultCargo = PERMISSOES_PADRAO[cargo] ?? {};
        const efetivo      = { ...defaultCargo, ...matrizCargo };

        for (const [slug, nivel] of Object.entries(efetivo)) {
          if (nivel === 'NEGADO') {
            mapaUniao[slug] = 'NEGADO'; // deny-wins: NEGADO de qualquer cargo bloqueia
            continue;
          }
          const atual = mapaUniao[slug];
          if (atual === 'NEGADO') continue; // já negado por outro cargo
          if (atual === undefined || (NIVEL_ORD[nivel] ?? 0) > (NIVEL_ORD[atual] ?? 0)) {
            mapaUniao[slug] = nivel;
          }
        }
      }

      await prisma.$transaction(async (tx) => {
        await tx.membroEquipe.update({
          where: { equipeId_userId: { equipeId, userId: alvoUserId } },
          data:  { cargo: cargoPrimario, cargos },
        });
        await tx.permissaoMembro.deleteMany({ where: { equipeId, userId: alvoUserId } });
        if (Object.keys(mapaUniao).length > 0) {
          await tx.permissaoMembro.createMany({
            data: Object.entries(mapaUniao).map(([slug, nivel]) => ({
              equipeId,
              userId:        alvoUserId,
              moduloSlug:    slug,
              nivel,
              atualizadoPor: req.user.id,
            })),
            skipDuplicates: true,
          });
        }
      });

      res.json({ sucesso: true, mensagem: 'Perfis atualizados com sucesso.', cargos, cargoPrimario });
    } catch (err) {
      console.error('Erro ao alterar cargos:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  alterarCargo: async (req, res) => {
    try {
      const equipeId   = Number(req.params.equipeId);
      const alvoUserId = Number(req.params.alvoUserId);
      const { cargo }  = req.body;

      if (!cargo?.trim()) {
        return res.status(400).json({ sucesso: false, mensagem: 'cargo é obrigatório.' });
      }

      // Valida contra PerfilEquipe da equipe (aceita perfis customizados) + restringe PROPRIETARIO
      const perfilExiste = await prisma.perfilEquipe.findUnique({
        where: { equipeId_slug: { equipeId, slug: cargo } },
      });
      if (!perfilExiste) {
        return res.status(400).json({ sucesso: false, mensagem: `Cargo "${cargo}" não existe nesta equipe.` });
      }
      if (cargo === 'PROPRIETARIO') {
        return res.status(400).json({ sucesso: false, mensagem: 'O perfil PROPRIETARIO é atribuído automaticamente — não pode ser concedido como cargo de equipe.' });
      }

      // ADMIN tem bypass total. Gestor pode conceder QUALQUER cargo, GESTOR incluído
      // (mesma regra de incluirMembroDireto); só não altera cargo de OUTRO gestor —
      // a própria linha segue liberada.
      if ((req.user.role !== 'ADMIN' && req.user.userType !== 'ADMIN')) {
        const membroSolicitante = await prisma.membroEquipe.findUnique({
          where: { equipeId_userId: { equipeId, userId: req.user.id } },
          select: { cargo: true },
        });
        if (!membroSolicitante || membroSolicitante.cargo !== 'GESTOR') {
          return res.status(403).json({ sucesso: false, mensagem: 'Apenas gestores podem alterar cargos.' });
        }
        if (alvoUserId !== req.user.id) {
          const alvoMembro = await prisma.membroEquipe.findUnique({
            where: { equipeId_userId: { equipeId, userId: alvoUserId } },
            select: { cargo: true },
          });
          if (alvoMembro?.cargo === 'GESTOR') {
            return res.status(403).json({ sucesso: false, mensagem: 'Gestores não podem ter os cargos alterados por outros gestores.' });
          }
        }
      }

      await prisma.$transaction(async (tx) => {
        await tx.membroEquipe.update({
          where: { equipeId_userId: { equipeId, userId: alvoUserId } },
          data:  { cargo },
        });
        // O perfil na empresa acompanha o cargo — é ele que a tela lê.
        await vincularMembro(tx, alvoUserId, equipeId, cargo);
        await tx.permissaoMembro.deleteMany({ where: { equipeId, userId: alvoUserId } });
        await PermissaoService.aplicarPermissoesPadrao({ equipeId, userId: alvoUserId, cargo, atualizadoPor: req.user.id });
      });

      res.json({ sucesso: true, mensagem: 'Cargo alterado com sucesso.' });
    } catch (err) {
      console.error('Erro ao alterar cargo:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  setup: async (req, res) => {
    try {
      const { empresaNome, equipeName } = req.body;
      if (!empresaNome?.trim() || !equipeName?.trim()) {
        return res.status(400).json({ sucesso: false, mensagem: 'empresaNome e equipeName são obrigatórios.' });
      }

      // Gestor pode ter mais de uma empresa/equipe — bloqueia apenas duplicata exata
      // (mesmo e-mail/owner + mesmo nome de empresa; setup não recebe CNPJ → empresa pessoal)
      const duplicada = await prisma.empresa.findFirst({
        where: { ownerId: req.user.id, nome: { equals: empresaNome.trim(), mode: 'insensitive' } },
      });
      if (duplicada) {
        return res.status(409).json({ sucesso: false, mensagem: 'Você já possui uma empresa com este nome.' });
      }

      const resultado = await prisma.$transaction(async (tx) => {
        const empresa = await tx.empresa.create({
          data: { nome: empresaNome.trim(), ownerId: req.user.id },
        });
        const equipe = await tx.equipe.create({
          data: { nome: equipeName.trim(), empresaId: empresa.id },
        });
        await tx.membroEquipe.create({
          data: { equipeId: equipe.id, userId: req.user.id, cargo: 'GESTOR' },
        });
        await salvarVinculo(tx, req.user.id, empresa.id, { perfil: 'GESTOR' });
        return { empresa, equipe };
      });

      res.status(201).json({ sucesso: true, dados: resultado });
    } catch (err) {
      console.error('Erro ao criar setup:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Permissões do usuário logado ─────────────────────────────────────────────
  // Retorna mapa plano { slug: nivel } para o frontend aplicar controle de acesso.
  // Gestor recebe FULL em tudo automaticamente (bypass via flag isGestor).
  //
  // MAIS DE UM PAPEL NA MESMA EMPRESA sempre SOMA (regra de produto — ver
  // `ajusteperfil` na memória): quem tem cargo de equipe (GESTOR/VET/ESTAGIARIO/
  // FORNECEDOR/...) e TAMBÉM tem cadastro de cliente na empresa ATIVA
  // (ProprietarioPerfil ativo ou animal ativo) recebe o MÁXIMO entre o que o cargo
  // dá e o que a Matriz do PROPRIETARIO dá, módulo a módulo. GESTOR já é FULL, então
  // somar não muda nada (não precisa nem consultar a Matriz do PROPRIETARIO). Quem
  // não tem cargo nenhum recebe só a Matriz do PROPRIETARIO — como sempre foi.
  // NEGADO do cargo bloqueia; NEGADO de PROPRIETARIO não bloqueia quem tem cargo.
  //
  // ⚠️ Este é o ÚNICO lugar que decide "isGestor" para o frontend (Sidebar,
  // `podeExecutar`) — qualquer bypass novo precisa entrar AQUI, não só em
  // `checkPermission` (rota por rota), senão o menu não reflete a permissão real.
  minhasPermissoes: async (req, res) => {
    try {
      const userId = req.user.id;
      const NIVEL_POSITIVO = { NENHUM: 0, LEITURA: 1, PROPRIO: 2, EQUIPE: 3, FULL: 4 };

      // ── ADMIN: acesso irrestrito — retorna FULL em todos os módulos ───────────
      if ((req.user.role === 'ADMIN' || req.user.userType === 'ADMIN')) {
        const modulos = await prisma.moduloSistema.findMany({ select: { slug: true } });
        const permissoes = Object.fromEntries(modulos.map(m => [m.slug, 'FULL']));
        return res.json({ sucesso: true, dados: { permissoes, isGestor: true, isAdmin: true, temEquipe: true } });
      }

      // "É cliente NESTA empresa?" — mesmo critério de `resolverTipoNoContexto`
      // (lib/tipoContexto.js), computado uma vez e usado tanto pelo merge abaixo
      // quanto pelo caso "só cliente, sem cargo nenhum".
      const souCliente = req.empresaId ? await resolverComoCliente(userId, req.empresaId) : false;

      // Matriz do PROPRIETARIO (das equipes vinculadas via animal/cadastro na
      // empresa ATIVA) — escopo por empresa: o que a empresa A liberou não vale
      // enquanto o contexto ativo for a empresa B.
      let mapaMaximoProp   = null;
      let equipeIdsCliente = [];
      if (souCliente) {
        equipeIdsCliente = await getEquipeIdsDoProprietario(Number(userId), req.empresaId);
        mapaMaximoProp = {};
        if (equipeIdsCliente.length > 0) {
          const matrizesProp = await prisma.matrizPerfil.findMany({
            where: { equipeId: { in: equipeIdsCliente }, perfilSlug: 'PROPRIETARIO' },
          });
          const negadosProp = new Set();
          for (const m of matrizesProp) {
            if (m.nivel === 'NEGADO') { negadosProp.add(m.moduloSlug); mapaMaximoProp[m.moduloSlug] = 'NEGADO'; continue; }
            if (negadosProp.has(m.moduloSlug)) continue;
            const atual = mapaMaximoProp[m.moduloSlug];
            if (atual === undefined || NIVEL_POSITIVO[m.nivel] > NIVEL_POSITIVO[atual]) {
              mapaMaximoProp[m.moduloSlug] = m.nivel;
            }
          }
        }
        mapaMaximoProp['dashboard.geral.ler'] = mapaMaximoProp['dashboard.geral.ler'] ?? 'LEITURA';
      }

      // Resolve o vínculo do CONTEXTO ATIVO — cargo e permissões podem diferir entre
      // equipes/empresas (ex.: GESTOR na equipe A, VETERINARIO na equipe B).
      // Prioridade: equipe ativa > equipe dentro da empresa ativa > vínculo mais recente.
      let membro = null;
      if (req.equipeId) {
        membro = await prisma.membroEquipe.findUnique({
          where:  { equipeId_userId: { equipeId: req.equipeId, userId } },
          select: { equipeId: true, cargo: true, cargos: true },
        });
      }
      if (!membro && req.empresaId) {
        membro = await prisma.membroEquipe.findFirst({
          where:   { userId, equipe: { empresaId: req.empresaId } },
          select:  { equipeId: true, cargo: true, cargos: true },
          orderBy: { createdAt: 'desc' },
        });
      }

      // Dono da empresa ativa sem MembroEquipe nela → bypass de gestor (FULL já
      // inclui qualquer coisa que a Matriz do PROPRIETARIO daria — soma é moot).
      if (!membro && req.empresaId) {
        const dono = await prisma.empresa.findFirst({
          where:  { id: req.empresaId, ownerId: userId },
          select: { id: true },
        });
        if (dono && req.user.userType !== 'FORNECEDOR') {
          const modulos = await prisma.moduloSistema.findMany({ select: { slug: true } });
          const permissoes = Object.fromEntries(modulos.map(m => [m.slug, 'FULL']));
          return res.json({ sucesso: true, dados: { permissoes, isGestor: true, temEquipe: true } });
        }
      }

      // Sem vínculo na empresa ativa: cai no vínculo mais recente (legado/autônomo).
      if (!membro) {
        membro = await prisma.membroEquipe.findFirst({
          where:   { userId },
          select:  { equipeId: true, cargo: true, cargos: true },
          orderBy: { createdAt: 'desc' },
        });
      }

      // Nenhum cargo de equipe em lugar nenhum: só cliente (ou nada).
      if (!membro) {
        if (souCliente) {
          if (equipeIdsCliente.length === 0) {
            return res.json({ sucesso: true, dados: {
              permissoes:    { 'dashboard.geral.ler': 'LEITURA' },
              isGestor:       false,
              temEquipe:      false,
              isProprietario: true,
            }});
          }
          const permissoes = Object.fromEntries(
            Object.entries(mapaMaximoProp).filter(([, v]) => v !== 'NENHUM')
          );
          return res.json({ sucesso: true, dados: { permissoes, isGestor: false, temEquipe: true, isProprietario: true } });
        }
        return res.json({ sucesso: true, dados: { permissoes: {}, isGestor: false, temEquipe: false } });
      }

      if (membro.cargo === 'GESTOR') {
        // Gestor tem bypass — retorna FULL em todos os módulos (soma com
        // PROPRIETARIO seria moot: FULL já é o teto)
        const modulos = await prisma.moduloSistema.findMany({ select: { slug: true } });
        const permissoes = Object.fromEntries(modulos.map(m => [m.slug, 'FULL']));
        return res.json({ sucesso: true, dados: { permissoes, isGestor: true, temEquipe: true } });
      }

      // FORNECEDOR: permissões individuais por membro (PermissaoMembro),
      // pois o gestor configura acesso granular por animal via ControleAcesso → Fornecedor.
      // Todos os demais cargos: MatrizPerfil é a fonte canônica — reflete exatamente o que
      // o gestor configurou na aba "Matriz de Perfis" do ControleAcesso, sem depender de
      // propagação para PermissaoMembro (que pode estar desatualizada).
      let permissoesMap = {};

      if (membro.cargo === 'FORNECEDOR') {
        const membroRegistros = await prisma.permissaoMembro.findMany({
          where:  { equipeId: membro.equipeId, userId },
          select: { moduloSlug: true, nivel: true },
        });
        for (const m of membroRegistros) permissoesMap[m.moduloSlug] = m.nivel;
      } else {
        // Para VET, ESTAGIARIO, SECRETARIA, FINANCEIRO, ENFERMEIRO etc.:
        // lê MatrizPerfil diretamente — é o que o gestor edita e a única fonte de verdade.
        // Multi-cargo: faz a união dos níveis (NEGADO vence; entre positivos, toma o máximo).
        const todosCargos = (membro.cargos && membro.cargos.length > 0)
          ? membro.cargos
          : [membro.cargo];

        const matrizRegistros = await prisma.matrizPerfil.findMany({
          where:  { equipeId: membro.equipeId, perfilSlug: { in: todosCargos } },
          select: { moduloSlug: true, nivel: true },
        });

        const negados = new Set();
        for (const m of matrizRegistros) {
          if (m.nivel === 'NEGADO') {
            negados.add(m.moduloSlug);
            permissoesMap[m.moduloSlug] = 'NEGADO';
            continue;
          }
          if (negados.has(m.moduloSlug)) continue;
          const atual = permissoesMap[m.moduloSlug];
          if (!atual || (NIVEL_POSITIVO[m.nivel] ?? 0) > (NIVEL_POSITIVO[atual] ?? 0)) {
            permissoesMap[m.moduloSlug] = m.nivel;
          }
        }
      }

      // MAIS DE UM PAPEL NA MESMA EMPRESA: soma o cargo com a Matriz do PROPRIETARIO
      // (`souCliente`, calculado no topo). NEGADO do cargo bloqueia (não some com
      // proprietário); NEGADO de PROPRIETARIO não bloqueia quem tem cargo ativo.
      //
      // ⚠️ NÃO gatear isto por `req.user.userType === 'PROPRIETARIO'` — chegando
      // aqui a pessoa TEM cargo de equipe, e `resolverTipoNoContexto` sempre
      // resolve o CARGO antes do CLIENTE (armadilha 36-e), então o `userType`
      // nunca seria PROPRIETARIO neste ponto. Era exatamente esse o bug histórico:
      // a soma "veterinária + proprietária" nunca disparava.
      if (souCliente) {
        const todasSlugs = new Set([...Object.keys(permissoesMap), ...Object.keys(mapaMaximoProp)]);
        for (const slug of todasSlugs) {
          if (permissoesMap[slug] === 'NEGADO') continue;

          const nivelCargo     = permissoesMap[slug] ?? PERMISSOES_PADRAO[membro.cargo]?.[slug] ?? 'NENHUM';
          const nivelPropBruto = mapaMaximoProp[slug] ?? 'NENHUM';
          const nivelProp      = nivelPropBruto === 'NEGADO' ? 'NENHUM' : nivelPropBruto;

          const ordCargo = NIVEL_POSITIVO[nivelCargo] ?? 0;
          const ordProp  = NIVEL_POSITIVO[nivelProp]  ?? 0;
          permissoesMap[slug] = ordCargo >= ordProp ? nivelCargo : nivelProp;
        }
        permissoesMap['dashboard.geral.ler'] = permissoesMap['dashboard.geral.ler'] ?? 'LEITURA';
      }

      // Remove NENHUM do mapa para que podeExecutar retorne false para slugs ausentes
      const permissoes = Object.fromEntries(
        Object.entries(permissoesMap).filter(([, v]) => v !== 'NENHUM'),
      );
      return res.json({ sucesso: true, dados: {
        permissoes, isGestor: false, temEquipe: true,
        ...(souCliente ? { isProprietario: true, isMulticargo: true } : {}),
      }});
    } catch (err) {
      console.error('Erro ao buscar permissões:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Permissões globais por UserType (ADMIN) ──────────────────────────────────

  getMatrizGlobalUserType: async (req, res) => {
    try {
      if ((req.user.role !== 'ADMIN' && req.user.userType !== 'ADMIN')) {
        return res.status(403).json({ sucesso: false, mensagem: 'Acesso restrito a administradores.' });
      }
      const { userType } = req.params;
      if (!USER_TYPES_GERENCIADOS.includes(userType)) {
        return res.status(400).json({ sucesso: false, mensagem: `UserType inválido: ${userType}` });
      }
      const dados = await PermissaoService.getMatrizGlobalUserType({ userType });
      return res.json({ sucesso: true, dados });
    } catch (err) {
      console.error('Erro ao buscar matriz global:', err);
      return res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  salvarMatrizGlobalUserType: async (req, res) => {
    try {
      if ((req.user.role !== 'ADMIN' && req.user.userType !== 'ADMIN')) {
        return res.status(403).json({ sucesso: false, mensagem: 'Acesso restrito a administradores.' });
      }
      const { userType } = req.params;
      if (!USER_TYPES_GERENCIADOS.includes(userType)) {
        return res.status(400).json({ sucesso: false, mensagem: `UserType inválido: ${userType}` });
      }
      const { permissoes } = req.body;
      if (!permissoes || typeof permissoes !== 'object') {
        return res.status(400).json({ sucesso: false, mensagem: 'permissoes é obrigatório.' });
      }
      const resultado = await PermissaoService.salvarMatrizGlobalUserType({ userType, permissoes });
      return res.json({ sucesso: true, dados: resultado, mensagem: `Permissões globais de ${userType} aplicadas em ${resultado.equipesAtualizadas} equipe(s).` });
    } catch (err) {
      console.error('Erro ao salvar matriz global:', err);
      return res.status(500).json({ sucesso: false, mensagem: err.message ?? 'Erro interno' });
    }
  },

  getEspeciesEquipe: async (req, res) => {
    try {
      const equipeId = Number(req.params.equipeId);
      const membros  = await prisma.membroEquipe.findMany({ where: { equipeId }, select: { userId: true } });
      const userIds  = membros.map(m => m.userId);
      const perfis   = await prisma.vetPerfil.findMany({
        where:   { userId: { in: userIds } },
        include: { especies: { include: { especie: { select: { id: true, nome: true } } } } },
      });
      const map = new Map();
      perfis.forEach(vp => vp.especies.forEach(ve => map.set(ve.especie.id, ve.especie)));
      return res.json({ sucesso: true, dados: Array.from(map.values()) });
    } catch (err) {
      console.error('Erro ao buscar espécies da equipe:', err);
      return res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  getEspeciesEmpresa: async (req, res) => {
    try {
      const empresaId = Number(req.params.empresaId);
      const equipes   = await prisma.equipe.findMany({ where: { empresaId }, select: { id: true } });
      const equipeIds = equipes.map(e => e.id);
      const membros   = await prisma.membroEquipe.findMany({ where: { equipeId: { in: equipeIds } }, select: { userId: true } });
      const userIds   = [...new Set(membros.map(m => m.userId))];
      const perfis    = await prisma.vetPerfil.findMany({
        where:   { userId: { in: userIds } },
        include: { especies: { include: { especie: { select: { id: true, nome: true } } } } },
      });
      const map = new Map();
      perfis.forEach(vp => vp.especies.forEach(ve => map.set(ve.especie.id, ve.especie)));
      return res.json({ sucesso: true, dados: Array.from(map.values()) });
    } catch (err) {
      console.error('Erro ao buscar espécies da empresa:', err);
      return res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

};

module.exports = EquipeController;
// Reuso do escopo de configuração (empresa CNPJ ou equipe de empresa pessoal)
// por outros controllers — ex.: WhatsappController (Evolution API).
module.exports.resolverEscopoConfiguracao = resolverEscopoConfiguracao;
// Usada pelo GET /users/me para responder `isGestorEmpresa` e `empresaConfigurada`
// sem o front ter de sondar GET /equipes/configuracoes (e gerar 404 no DevTools).
module.exports.buscarConfiguracao         = buscarConfiguracao;
module.exports.configuracaoCompleta       = configuracaoCompleta;
// Locais de trabalho do membro — reusados pelo Cadastro Pessoal (UserController.updateMe),
// para que a validação (inclusive a de horários coincidentes) seja a MESMA das duas telas.
module.exports.parseLocaisTrabalho  = parseLocaisTrabalho;
module.exports.gravarLocaisTrabalho = gravarLocaisTrabalho;
module.exports.csvParaIds           = csvParaIds;
module.exports.validarLocaisContraExpedienteEmpresa = validarLocaisContraExpedienteEmpresa;
// Padrão da empresa para a especialidade sem tempo próprio no local (AgendamentoController).
module.exports.tempoConsultaPadraoDaEmpresa = tempoConsultaPadraoDaEmpresa;
module.exports.TEMPO_CONSULTA_PADRAO_SISTEMA = TEMPO_CONSULTA_PADRAO_SISTEMA;
// Clínica Médica assumida para o veterinário sem especialidade (UserController.updateMe).
module.exports.especialidadesPadraoVeterinario = especialidadesPadraoVeterinario;
module.exports.resolverEspeciesAtendidas       = resolverEspeciesAtendidas;
