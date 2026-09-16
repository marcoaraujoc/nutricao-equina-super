// backend/src/controllers/PrestadorController.js
'use strict';

const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma').default;
const { getEquipeScopeDoUsuario } = require('../lib/vetUtils');
const { podeAlterarRegistroEscopado } = require('../lib/cadastroScopeAccess');
const { normalizarPagamento } = require('../lib/usuarioEmpresa');
const { registrarAtivacao, registrarInativacao, anexarTrilha } = require('../lib/cadastroAtivacao');
const { definirAtivoNaEmpresa } = require('../lib/usuarioEmpresa');
const { emitirCartaoAcesso, aplicarPermissoes, revogarCartaoAcesso, anexarEquipeDoAcesso } = require('../lib/acessoExterno');
const { registrarAuditoria, registrarAlteracao } = require('../lib/auditoria');
const emailService = require('../services/emailService');
const { gerarSenhaInicial } = require('../lib/senhaInicial');
const { normalizeEmail, whereEmailInsensitive } = require('../lib/email');
const { cadastroDaPessoaNaEmpresa, montarResposta } = require('../lib/cadastroPorEmail');

// Whitelist fixa SAIU (2026-08-25) — o tipo de serviço agora vem do catálogo
// tenant-scoped (tb_catalogo_tipo_servico, CatalogoTipoServicoController), que
// cresce por uso. Validação aqui é só "não vazio, tamanho razoável".

// ⚠️ A senha inicial deixou de ser CONSTANTE (2026-09-08): ela é derivada do cadastro
// de cada pessoa (`lib/senhaInicial.js`) e sai só pelo e-mail de boas-vindas.

// Relação padrão devolvida ao front — locais de trabalho com o nome da localização.
const PRESTADOR_INCLUDE = {
  locaisTrabalho: {
    include: { localizacao: { select: { id: true, nome: true } } },
    orderBy: { id: 'asc' },
  },
};

const normalizarDigitos = v => (v ?? '').replace(/\D/g, '');
const normalizarTexto   = v => (v ?? '').trim().toLowerCase();
const normalizarTipos   = v => (v ?? '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean).sort().join('|');

// ─── Tipos de serviço: VÁRIOS por prestador (2026-09-15) ──────────────────────
// O mesmo profissional externo acumula atuações (ferrador E fisioterapeuta), e o
// cadastro obrigava a escolher uma só. Gravados como CSV na MESMA coluna
// `tipo_servico`, que é o formato que os leitores já esperam:
// `EncaminhamentoController` monta o filtro de serviços com `tipoServico.split(',')`
// e a checagem de duplicidade aqui já compara a LISTA (`normalizarTipos`, acima).
// ⚠️ Por isso NÃO nasceu tabela nova: a convenção já existia: o que faltava era o
// cadastro saber produzi-la.
const LIMITE_TIPO_SERVICO = 255;

/** CSV recebido → CSV canônico (sem vazio, sem repetido, separador uniforme). */
function sanearTiposServico(v) {
  const vistos = new Set();
  const lista  = [];
  for (const parte of String(v ?? '').split(',')) {
    const nome = parte.trim();
    if (!nome) continue;
    const chave = nome.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    lista.push(nome);
  }
  return lista.join(', ');
}

// ─── Helper: verifica duplicidade por CPF ou por nome+tipoServico+telefone ────
async function verificarDuplicidade({ cpf, nome, tipoServico, telefone, empresaId, excludeId = null }) {
  const candidatos = await prisma.prestador.findMany({
    where: {
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: [{ empresaId: null }, { empresaId: empresaId ?? -1 }],
    },
  });

  const cpfNum = normalizarDigitos(cpf);
  if (cpfNum) {
    const dupAtivo   = candidatos.find(c =>  c.ativo && normalizarDigitos(c.cpf) === cpfNum);
    const dupInativo = candidatos.find(c => !c.ativo && normalizarDigitos(c.cpf) === cpfNum);
    if (dupAtivo)   return { tipo: 'cpf', ativo: true,  prestador: dupAtivo };
    if (dupInativo) return { tipo: 'cpf', ativo: false, prestador: dupInativo };
  }

  const nomeNorm = normalizarTexto(nome);
  const tipoNorm = normalizarTipos(tipoServico);
  const telNum   = normalizarDigitos(telefone);
  if (nomeNorm && tipoNorm && telNum) {
    const match = c =>
      normalizarTexto(c.nome) === nomeNorm &&
      normalizarTipos(c.tipoServico) === tipoNorm &&
      normalizarDigitos(c.telefone) === telNum;
    const dupAtivo   = candidatos.find(c =>  c.ativo && match(c));
    const dupInativo = candidatos.find(c => !c.ativo && match(c));
    if (dupAtivo)   return { tipo: 'combo', ativo: true,  prestador: dupAtivo };
    if (dupInativo) return { tipo: 'combo', ativo: false, prestador: dupInativo };
  }

  return null;
}

/**
 * `22001 value too long` na coluna `tipo_servico` só acontece numa base em que a
 * migration 20261010000000 (VARCHAR 50 → 255) ainda NÃO foi aplicada. Sem este
 * desvio o gestor leva um 500 mudo justamente ao escolher o tipo a mais — e o
 * motivo real fica só no log do servidor.
 */
function ehColunaCurtaDeTipoServico(err) {
  const meta = `${err?.meta?.column_name ?? ''} ${err?.meta?.message ?? ''} ${err?.message ?? ''}`;
  return (err?.code === 'P2000' || err?.code === '22001') && /tipo_servico/.test(meta);
}
const MSG_COLUNA_CURTA = 'A base ainda não comporta vários tipos de serviço. Aplique a migration 20261010000000_prestador_tipos_servico ou escolha menos tipos.';

const MSG_DUPLICADO = {
  cpf:   'Já existe um prestador cadastrado com este CPF.',
  combo: 'Já existe um prestador cadastrado com o mesmo nome, tipo de serviço e telefone.',
};

function buildMensagemInativo(tipo, p) {
  if (tipo === 'cpf') {
    return `Já existe o prestador "${p.nome}" com o CPF ${p.cpf ?? p.cnpj} (inativo).`;
  }
  const contato = [
    p.telefone ? `telefone ${p.telefone}` : null,
    p.email    ? `e-mail ${p.email}`      : null,
  ].filter(Boolean).join(' e ');
  return `Prestador "${p.nome}" com ${contato} já existe (inativo).`;
}

// ─── Pagamento (opcional para Prestador — nem todo externo tem remuneração fixa
// com a clínica) — só valida quando ALGUM dos 3 campos vier preenchido.
//
// SALARIO e COMISSAO usam a MESMA validação do Incluir Membro
// (`normalizarPagamento`, lib/usuarioEmpresa.js).
//
// 🔴 `POR_PROCEDIMENTO` (2026-09-08) é EXCLUSIVO do prestador e por isso NÃO entra
// em `TIPOS_PAGAMENTO` daquela lib: ela é compartilhada com `tb_usuario_empresa`, e
// acrescentar o valor lá o tornaria aceito para MEMBRO DE EQUIPE sem que nenhuma
// tela o ofereça — um estado alcançável só por chamada direta à API e que ninguém
// consegue configurar nem corrigir depois. O prestador é o único cujo trabalho se
// conta por procedimento.
//
// ⚠️ POR_PROCEDIMENTO não tem "R$ ou %" nem valor único: o valor é o do VÍNCULO,
// procedimento a procedimento (Cadastro > Procedimentos → "Valor Cobrado pelo
// Prestador"). Os três campos são gravados como NULL de propósito — deixar um valor
// antigo ali faria o recibo ter duas fontes possíveis para o mesmo pagamento.
function resolverPagamento(body) {
  const { tipoPagamento, formaPagamento, valorPagamento } = body;
  const tipo = String(tipoPagamento ?? '').trim().toUpperCase();

  if (tipo === 'POR_PROCEDIMENTO') {
    return { erro: null, dados: { tipoPagamento: tipo, formaPagamento: null, valorPagamento: null } };
  }

  const iniciado = !!tipoPagamento || !!formaPagamento ||
    (valorPagamento !== undefined && valorPagamento !== null && String(valorPagamento).trim() !== '');
  if (!iniciado) return { erro: null, dados: { tipoPagamento: null, formaPagamento: null, valorPagamento: null } };
  return normalizarPagamento({ tipoPagamento, formaPagamento, valorPagamento });
}

/**
 * "Atender somente no local de trabalho" — coluna nova
 * (`20260929000000_prestador_restringir_por_local`).
 *
 * 🔴 SQL CRU COM `catch`, pelo motivo de sempre (§11): no Windows o `prisma generate`
 * falha com o backend rodando, e um `data:` tipado derrubaria o CADASTRO INTEIRO de
 * prestador numa máquina que ainda não regenerou. Assim o pior caso é o flag não
 * persistir — e `false` é o comportamento de antes.
 */
async function gravarRestricaoPorLocal(tx, prestadorId, valor) {
  await tx.$executeRaw`
    UPDATE "schs2vet"."tb_prestadores"
       SET "restringir_por_local" = ${valor === true}
     WHERE "id" = ${Number(prestadorId)}
  `.catch(() => {});
}

/**
 * Anexa `restringirPorLocal` à lista devolvida ao front.
 *
 * ⚠️ Precisa ser LIDO à parte, e não pelo `include`: o client Prisma seleciona as
 * colunas que ele CONHECE, e enquanto o `generate` não roda (§11) a coluna nova
 * simplesmente não vem — o checkbox abriria sempre desmarcado na edição, apagando em
 * silêncio o que o gestor tinha configurado.
 */
async function anexarRestricaoPorLocal(lista) {
  if (!lista?.length) return lista;
  const linhas = await prisma.$queryRaw`
    SELECT "id", "restringir_por_local" AS "restringirPorLocal"
      FROM "schs2vet"."tb_prestadores"
     WHERE "id" = ANY(${lista.map(p => p.id)}::int[])
  `.catch(() => []);
  const mapa = new Map(linhas.map(l => [l.id, l.restringirPorLocal === true]));
  return lista.map(p => ({ ...p, restringirPorLocal: mapa.get(p.id) ?? false }));
}

// ─── Login opcional do Prestador — SEM MembroEquipe ────────────────────────────
// Só roda quando acessoSistema===true e o prestador ainda não tem userId. Cria (ou
// reaproveita, por e-mail) um `User`: a pessoa passa a poder logar, mas sem
// MembroEquipe não há de onde vir empresa/permissão — ela não vai enxergar nenhuma
// tela até ser incluída na equipe pelo fluxo de sempre (Equipe > Incluir Membro,
// cargo Fornecedor). Decisão registrada no plano "Prestador: pagamento/local/acesso".
async function provisionarLogin(tx, { prestadorId, nome, telefone, email }) {
  const emailNorm = email.trim().toLowerCase();
  const existente = await tx.user.findUnique({ where: { email: emailNorm } });

  if (existente) {
    const outroPrestador = await tx.prestador.findFirst({
      where:  { userId: existente.id, id: { not: prestadorId } },
      select: { nome: true },
    });
    if (outroPrestador) {
      const err = new Error(`Este e-mail já está vinculado ao login do prestador "${outroPrestador.nome}".`);
      err.code = 'EMAIL_JA_VINCULADO';
      throw err;
    }
    return { userId: existente.id, criado: false };
  }

  const senhaHash = await bcrypt.hash(gerarSenhaInicial({ email: emailNorm, nome, telefone }), 10);
  const novo = await tx.user.create({
    data: {
      email:              emailNorm,
      fullName:           nome.trim(),
      phone:              telefone?.trim() || null,
      passwordHash:       senhaHash,
      role:               'USER',
      userType:           'FORNECEDOR',
      mustChangePassword: true,
    },
  });
  return { userId: novo.id, criado: true };
}

// ─── Locais de trabalho (delete + recreate por prestador) ─────────────────────
// Sem especialidade/tempo de consulta (Prestador não entra na Agenda) e sem herança
// de expediente da empresa: em branco aqui é só "sem horário definido".
function normalizarLocalTrabalho(l) {
  const localizacaoId = Number(l?.localizacaoId);
  if (!Number.isInteger(localizacaoId) || localizacaoId <= 0) return null;
  const dias = Array.isArray(l?.diasTrabalho)
    ? [...new Set(l.diasTrabalho.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
    : [];
  const horaValida = h => typeof h === 'string' && /^\d{2}:\d{2}$/.test(h);
  return {
    localizacaoId,
    diasTrabalho:       dias.length ? dias.join(',') : null,
    horaInicioTrabalho: horaValida(l?.horaInicioTrabalho) ? l.horaInicioTrabalho : null,
    horaFimTrabalho:    horaValida(l?.horaFimTrabalho)    ? l.horaFimTrabalho    : null,
  };
}

async function gravarLocaisTrabalho(tx, prestadorId, locaisBody, empresaId, equipeId) {
  await tx.prestadorLocalTrabalho.deleteMany({ where: { prestadorId } });
  const locais = (Array.isArray(locaisBody) ? locaisBody : []).map(normalizarLocalTrabalho).filter(Boolean);
  if (locais.length === 0) return;
  await tx.prestadorLocalTrabalho.createMany({
    data: locais.map(l => ({ ...l, prestadorId, empresaId: empresaId ?? null, equipeId: equipeId ?? null })),
  });
}

// Escopo por empresa/equipe: não-ADMIN vê globais (empresaId null = SYSTEM/legado)
// + prestadores da empresa ativa, segregados pela equipe do contexto (igual Fornecedor).
//
// ⚠️ FONTE ÚNICA da visibilidade desta tela — `listar` e `buscarPorEmail` usam a MESMA
// cláusula. Duas cópias divergiriam, e o que divergiria é a resposta a "este cadastro
// existe aqui?": a busca por e-mail carregaria para edição um registro que a lista não
// mostra (ou deixaria criar duplicata de um que ela mostra).
// ADMIN da plataforma não é filtrado (é ele quem mantém o catálogo global).
async function escopoVisivel(req) {
  if (req.user?.role === 'ADMIN') return null;
  const equipeScope = await getEquipeScopeDoUsuario(req.user.id, req.empresaId, req.equipeId);
  return {
    OR: [
      { empresaId: null },
      { empresaId: req.empresaId ?? -1, equipeId: null },
      ...(equipeScope
        ? [{ empresaId: req.empresaId ?? -1, equipeId: { in: equipeScope } }]
        : [{ empresaId: req.empresaId ?? -1 }]),
    ],
  };
}

const PrestadorController = {

  // GET /api/cadastro/prestadores?busca=X&ativo=true|false|all
  listar: async (req, res) => {
    try {
      const { busca, ativo } = req.query;
      const where = {};

      if (ativo === 'all') { /* sem filtro */ }
      else if (ativo !== undefined) where.ativo = ativo === 'true';
      else where.ativo = true;

      const escopo = await escopoVisivel(req);
      if (escopo) where.AND = [escopo];

      if (busca?.trim()) {
        where.OR = [
          { nome:     { contains: busca.trim(), mode: 'insensitive' } },
          { cpf:      { contains: busca.trim(), mode: 'insensitive' } },
          { cnpj:     { contains: busca.trim(), mode: 'insensitive' } },
          { telefone: { contains: busca.trim(), mode: 'insensitive' } },
          { email:    { contains: busca.trim(), mode: 'insensitive' } },
        ];
      }

      const prestadores = await prisma.prestador.findMany({
        where,
        include: PRESTADOR_INCLUDE,
        orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
      });

      // `acessoEquipeId`: onde o cartão de acesso foi emitido — é o que habilita o
      // botão "Gerenciar Acesso" (designação de pacientes) nesta tela.
      res.json({ sucesso: true, dados: await anexarEquipeDoAcesso(prisma, await anexarRestricaoPorLocal(await anexarTrilha(prestadores, 'prestador'))) });
    } catch (err) {
      console.error('Erro ao listar prestadores:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao listar prestadores' });
    }
  },

  // GET /api/cadastro/prestadores/por-email?email=X
  //
  // "Este e-mail já é conhecido NESTA clínica?" — chamado ao SAIR do campo de e-mail
  // do formulário. Três respostas possíveis (ver lib/cadastroPorEmail.js):
  //   CADASTRO → já existe o prestador aqui: a tela CARREGA e passa a editar, em vez
  //              de montar uma duplicata que o salvar recusaria no fim.
  //   PESSOA   → não é prestador aqui, mas a empresa já tem o cadastro dela
  //              (é veterinária, cliente, secretária…): a tela só PREENCHE o vazio.
  //   nada     → e-mail desconhecido nesta empresa. NÃO se distingue "não existe" de
  //              "existe em outra clínica" — a segunda resposta transformaria o campo
  //              num verificador de cadastro alheio.
  //
  // MULTI-TENANT: o registro sai do MESMO `escopoVisivel` da listagem (empresa +
  // equipe do contexto) e o cadastro da pessoa, de `tb_usuario_empresa` da empresa
  // ativa. As duas tabelas ainda têm o RLS fail-closed por baixo.
  buscarPorEmail: async (req, res) => {
    const email = normalizeEmail(req.query.email);
    if (!email) return res.status(400).json({ sucesso: false, mensagem: 'E-mail é obrigatório' });

    try {
      const escopo = await escopoVisivel(req);
      const registro = await prisma.prestador.findFirst({
        where: {
          ...whereEmailInsensitive(email),
          ...(escopo ? { AND: [escopo] } : {}),
        },
        include: PRESTADOR_INCLUDE,
        // Ativo primeiro: o cadastro em uso é o que interessa carregar. Havendo só o
        // inativo, ele vem — e a tela oferece reativar em vez de criar um segundo.
        orderBy: [{ ativo: 'desc' }, { id: 'asc' }],
      });

      const pessoa = await cadastroDaPessoaNaEmpresa(email, req.empresaId, prisma);

      if (!registro) return res.json({ sucesso: true, dados: montarResposta({ pessoa }) });

      // Mesmo enriquecimento da listagem — sem ele a tela carregaria o cadastro sem a
      // trilha de inativação, sem a restrição por local e sem o `acessoEquipeId` que
      // habilita "Gerenciar Acesso".
      const [enriquecido] = await anexarEquipeDoAcesso(
        prisma,
        await anexarRestricaoPorLocal(await anexarTrilha([registro], 'prestador')),
      );
      return res.json({ sucesso: true, dados: montarResposta({ registro: enriquecido, pessoa }) });
    } catch (err) {
      console.error('[PrestadorController.buscarPorEmail]', err);
      return res.status(500).json({ sucesso: false, mensagem: 'Erro ao consultar o e-mail' });
    }
  },

  // GET /api/cadastro/prestadores/tipos — LEGADO: os tipos hoje vêm do catálogo
  // tenant-scoped (GET /api/cadastro/tipos-servico?categoria=PRESTADOR).
  // Mantido só para não quebrar chamador antigo; devolve lista vazia.
  listarTipos: async (req, res) => {
    res.json({ sucesso: true, dados: [] });
  },

  // GET /api/cadastro/prestadores/:id
  obterPorId: async (req, res) => {
    try {
      const prestador = await prisma.prestador.findUnique({
        where:   { id: Number(req.params.id) },
        include: PRESTADOR_INCLUDE,
      });
      if (!prestador) return res.status(404).json({ sucesso: false, mensagem: 'Prestador não encontrado' });
      res.json({ sucesso: true, dados: prestador });
    } catch {
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao buscar prestador' });
    }
  },

  // POST /api/cadastro/prestadores
  // ADMIN → tipoEntrada=SYSTEM; demais → tipoEntrada=CLIENTE
  criar: async (req, res) => {
    const {
      nome, cpf, cnpj, telefone, email, tipoServico,
      cep, endereco, complemento, bairro, cidade, estado,
      acessoSistema, locaisTrabalho, restringirPorLocal,
    } = req.body;

    if (!nome?.trim())
      return res.status(400).json({ sucesso: false, mensagem: 'Nome é obrigatório' });
    if (!telefone?.trim())
      return res.status(400).json({ sucesso: false, mensagem: 'Telefone é obrigatório' });
    const tiposServicoCriar = sanearTiposServico(tipoServico);
    if (!tiposServicoCriar)
      return res.status(400).json({ sucesso: false, mensagem: 'Selecione ao menos um tipo de serviço' });
    if (tiposServicoCriar.length > LIMITE_TIPO_SERVICO)
      return res.status(400).json({ sucesso: false, mensagem: `Tipos de serviço muito longos (máx. ${LIMITE_TIPO_SERVICO} caracteres somados). Remova algum.` });
    if (acessoSistema === true && !email?.trim())
      return res.status(400).json({ sucesso: false, mensagem: 'E-mail é obrigatório para conceder acesso ao sistema.' });

    const { erro: erroPagamento, dados: pagamento } = resolverPagamento(req.body);
    if (erroPagamento) return res.status(400).json({ sucesso: false, mensagem: erroPagamento });

    const tipoEntrada = req.user?.role === 'ADMIN' ? 'SYSTEM' : 'CLIENTE';
    const empresaAlvo = tipoEntrada === 'CLIENTE' ? (req.empresaId ?? null) : null;
    const equipeAlvo  = tipoEntrada === 'CLIENTE' ? (req.equipeId ?? null)  : null;

    try {
      const dup = await verificarDuplicidade({ cpf, nome, tipoServico: tiposServicoCriar, telefone, empresaId: empresaAlvo });
      if (dup) {
        if (dup.ativo) return res.status(409).json({ sucesso: false, mensagem: MSG_DUPLICADO[dup.tipo] });
        if (!req.body.force) return res.status(409).json({
          sucesso: false, inativo: true,
          mensagem: buildMensagemInativo(dup.tipo, dup.prestador),
          prestador: dup.prestador,
        });
      }

      let usuarioCriado = false;
      let cartao = null;

      const prestadorId = await prisma.$transaction(async (tx) => {
        const criado = await tx.prestador.create({
          data: {
            empresaId:   empresaAlvo,
            equipeId:    equipeAlvo,
            nome:        nome.trim(),
            cpf:         cpf?.trim()         || null,
            cnpj:        cnpj?.trim()        || null,
            telefone:    telefone.trim(),
            email:       email?.trim() ? email.trim().toLowerCase() : null,
            tipoServico: tiposServicoCriar,
            tipoEntrada,
            cep:         cep?.trim()         || null,
            endereco:    endereco?.trim()    || null,
            complemento: complemento?.trim() || null,
            bairro:      bairro?.trim()      || null,
            cidade:      cidade?.trim()      || null,
            estado:      estado?.trim()      || null,
            ...pagamento,
            acessoSistema: acessoSistema === true,
          },
        });

        await gravarLocaisTrabalho(tx, criado.id, locaisTrabalho, empresaAlvo, equipeAlvo);
        await gravarRestricaoPorLocal(tx, criado.id, restringirPorLocal);

        if (acessoSistema === true) {
          const login = await provisionarLogin(tx, {
            prestadorId: criado.id, nome: criado.nome, telefone: criado.telefone, email: criado.email,
          });
          await tx.prestador.update({ where: { id: criado.id }, data: { userId: login.userId } });
          usuarioCriado = login.criado;
          // 🔴 O CARTÃO DE ACESSO. Sem ele, `acessoSistema` era promessa vazia: a
          // pessoa logava e não enxergava tela nenhuma, porque TODO o RBAC se resolve
          // por `MembroEquipe` (ver lib/acessoExterno.js). O prestador segue FORA da
          // equipe na organização — a tela Equipe e a Agenda não o listam.
          cartao = await emitirCartaoAcesso(tx, {
            userId:    login.userId,
            empresaId: empresaAlvo,
            equipeId:  equipeAlvo,
            cargo:     'PRESTADOR',
            cadastro:  {
              fullName: criado.nome, phone: criado.telefone,
              cep: criado.cep, endereco: criado.endereco, complemento: criado.complemento,
              bairro: criado.bairro, cidade: criado.cidade, estado: criado.estado, ativo: true,
            },
          });
        }

        return criado.id;
      });

      // Permissões padrão do perfil PRESTADOR — FORA da transaction (PermissaoService
      // abre a própria). Best-effort: falhar aqui deixa o acesso sem permissão
      // configurada, e o gestor ajusta no Controle de Acesso; nunca desfaz o cadastro.
      if (cartao) {
        await aplicarPermissoes({ equipeId: cartao.equipeId, userId: cartao.userId, cargo: 'PRESTADOR', atualizadoPor: req.user.id });
      }

      if (usuarioCriado) {
        emailService.enviarBoasVindasProprietario({
          destinatarioEmail: email.trim().toLowerCase(),
          destinatarioNome:  nome.trim(),
          criadoPorNome:     req.user?.fullName || 'Equipe',
          senhaInicial:      gerarSenhaInicial({ email, nome, telefone }),
        }).catch(err => console.error('[emailService] Falha ao enviar boas-vindas do prestador:', err));
      }

      // Prestador nasce ativo=true (default do schema): grava a trilha de ativação
      // também na CRIAÇÃO, senão "Ativado em/por" fica vazio até alguém desativar
      // e reativar o registro.
      await registrarAtivacao(prisma, 'prestador', prestadorId, req.user.id);

      const prestador = await prisma.prestador.findUnique({ where: { id: prestadorId }, include: PRESTADOR_INCLUDE });
      await registrarAuditoria(prisma, req, {
        categoria:  'CRIACAO',
        entidade:   'PRESTADOR',
        entidadeId: prestador.id,
        detalhes:   `${prestador.nome} — ${prestador.tipoServico}`,
      });
      res.status(201).json({ sucesso: true, dados: prestador });
    } catch (err) {
      if (err.code === 'EMAIL_JA_VINCULADO') {
        return res.status(409).json({ sucesso: false, mensagem: err.message });
      }
      if (ehColunaCurtaDeTipoServico(err))
        return res.status(400).json({ sucesso: false, mensagem: MSG_COLUNA_CURTA });
      console.error('Erro ao criar prestador:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao criar prestador' });
    }
  },

  // PUT /api/cadastro/prestadores/:id — escopado por empresa/equipe (checkPermission na rota)
  atualizar: async (req, res) => {
    const { id } = req.params;
    const {
      nome, cpf, cnpj, telefone, email, tipoServico,
      cep, endereco, complemento, bairro, cidade, estado,
      acessoSistema, locaisTrabalho, restringirPorLocal,
    } = req.body;

    if (!nome?.trim())
      return res.status(400).json({ sucesso: false, mensagem: 'Nome é obrigatório' });
    if (!telefone?.trim())
      return res.status(400).json({ sucesso: false, mensagem: 'Telefone é obrigatório' });
    // `undefined` PRESERVA o que está gravado (PATCH parcial); lista vazia enviada
    // de propósito é recusada abaixo, junto do `tipoServicoFinal`.
    const tiposServicoEditar = tipoServico === undefined ? undefined : sanearTiposServico(tipoServico);
    if (tiposServicoEditar !== undefined && tiposServicoEditar.length > LIMITE_TIPO_SERVICO) {
      return res.status(400).json({ sucesso: false, mensagem: `Tipos de serviço muito longos (máx. ${LIMITE_TIPO_SERVICO} caracteres somados). Remova algum.` });
    }
    if (acessoSistema === true && !email?.trim())
      return res.status(400).json({ sucesso: false, mensagem: 'E-mail é obrigatório para conceder acesso ao sistema.' });

    const { erro: erroPagamento, dados: pagamento } = resolverPagamento(req.body);
    if (erroPagamento) return res.status(400).json({ sucesso: false, mensagem: erroPagamento });

    try {
      const existe = await prisma.prestador.findUnique({ where: { id: Number(id) } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Prestador não encontrado' });
      if (!podeAlterarRegistroEscopado(existe, req))
        return res.status(403).json({ sucesso: false, mensagem: 'Você não tem acesso para alterar este prestador.' });

      const tipoServicoFinal = tiposServicoEditar || existe.tipoServico;

      const dup = await verificarDuplicidade({
        cpf, nome, telefone,
        tipoServico: tipoServicoFinal,
        empresaId:   existe.empresaId,
        excludeId:   Number(id),
      });
      if (dup) {
        if (dup.ativo) return res.status(409).json({ sucesso: false, mensagem: MSG_DUPLICADO[dup.tipo] });
        if (!req.body.force) return res.status(409).json({
          sucesso: false, inativo: true,
          mensagem: buildMensagemInativo(dup.tipo, dup.prestador),
          prestador: dup.prestador,
        });
      }

      let usuarioCriado = false;
      let cartao = null;
      const emailFinal = email?.trim() ? email.trim().toLowerCase() : null;

      await prisma.$transaction(async (tx) => {
        await tx.prestador.update({
          where: { id: Number(id) },
          data: {
            nome:        nome.trim(),
            cpf:         cpf?.trim()         || null,
            cnpj:        cnpj?.trim()        || null,
            telefone:    telefone.trim(),
            email:       emailFinal,
            tipoServico: tipoServicoFinal,
            cep:         cep?.trim()         || null,
            endereco:    endereco?.trim()    || null,
            complemento: complemento?.trim() || null,
            bairro:      bairro?.trim()      || null,
            cidade:      cidade?.trim()      || null,
            estado:      estado?.trim()      || null,
            ...pagamento,
            // Desmarcar não desvincula o login já criado — só passa a bloquear o
            // acesso (lib/usuarioEmpresa.js#podeAcessarSistema). Reativar depois é só
            // marcar de novo, sem recriar conta.
            acessoSistema: acessoSistema === true,
          },
        });

        await gravarLocaisTrabalho(tx, Number(id), locaisTrabalho, existe.empresaId, existe.equipeId);
        await gravarRestricaoPorLocal(tx, Number(id), restringirPorLocal);

        // Provisiona o login só na transição false/nulo → true (userId ainda vazio).
        let userIdAcesso = existe.userId;
        if (acessoSistema === true && !existe.userId) {
          const login = await provisionarLogin(tx, {
            prestadorId: Number(id), nome: nome.trim(), telefone: telefone.trim(), email: emailFinal,
          });
          await tx.prestador.update({ where: { id: Number(id) }, data: { userId: login.userId } });
          usuarioCriado = login.criado;
          userIdAcesso  = login.userId;
        }

        // 🔴 O cartão é reemitido a CADA salvar com o acesso ligado, não só quando o
        // login nasce: cadastro antigo (que ganhou `userId` antes desta regra existir)
        // passa a enxergar tela ao ser salvo de novo — sem migration nenhuma.
        if (acessoSistema === true && userIdAcesso) {
          cartao = await emitirCartaoAcesso(tx, {
            userId:    userIdAcesso,
            empresaId: existe.empresaId,
            equipeId:  existe.equipeId,
            cargo:     'PRESTADOR',
            cadastro:  {
              fullName: nome.trim(), phone: telefone.trim(),
              cep: cep?.trim() || null, endereco: endereco?.trim() || null,
              complemento: complemento?.trim() || null, bairro: bairro?.trim() || null,
              cidade: cidade?.trim() || null, estado: estado?.trim() || null,
            },
          });
        }

        // Desmarcou: o login CONTINUA existindo (religar é só marcar de novo), mas
        // `acesso_sistema = false` faz `podeAcessarSistema` recusar já no login.
        // ⚠️ O `MembroEquipe` NÃO é apagado — o cascade levaria junto as permissões
        // que o gestor configurou, e religar devolveria a pessoa sem nenhuma delas.
        if (acessoSistema !== true && existe.userId) {
          await revogarCartaoAcesso(tx, { userId: existe.userId, empresaId: existe.empresaId });
        }
      });

      if (cartao) {
        await aplicarPermissoes({ equipeId: cartao.equipeId, userId: cartao.userId, cargo: 'PRESTADOR', atualizadoPor: req.user.id });
      }

      if (usuarioCriado) {
        emailService.enviarBoasVindasProprietario({
          destinatarioEmail: emailFinal,
          destinatarioNome:  nome.trim(),
          criadoPorNome:     req.user?.fullName || 'Equipe',
          senhaInicial:      gerarSenhaInicial({ email, nome, telefone }),
        }).catch(err => console.error('[emailService] Falha ao enviar boas-vindas do prestador:', err));
      }

      const prestador = await prisma.prestador.findUnique({ where: { id: Number(id) }, include: PRESTADOR_INCLUDE });

      await registrarAlteracao(prisma, req, {
        entidade:   'PRESTADOR',
        entidadeId: Number(id),
        campos: {
          'nome':            { de: existe.nome,          para: prestador.nome },
          'CPF':             { de: existe.cpf,           para: prestador.cpf },
          'CNPJ':            { de: existe.cnpj,          para: prestador.cnpj },
          'telefone':        { de: existe.telefone,      para: prestador.telefone },
          'e-mail':          { de: existe.email,         para: prestador.email },
          'tipo de serviço': { de: existe.tipoServico,   para: prestador.tipoServico },
          'CEP':             { de: existe.cep,           para: prestador.cep },
          'endereço':        { de: existe.endereco,      para: prestador.endereco },
          'complemento':     { de: existe.complemento,   para: prestador.complemento },
          'bairro':          { de: existe.bairro,        para: prestador.bairro },
          'cidade':          { de: existe.cidade,        para: prestador.cidade },
          'estado':          { de: existe.estado,        para: prestador.estado },
          'acesso ao sistema': { de: existe.acessoSistema, para: prestador.acessoSistema },
        },
      });

      res.json({ sucesso: true, dados: prestador });
    } catch (err) {
      if (err.code === 'EMAIL_JA_VINCULADO') {
        return res.status(409).json({ sucesso: false, mensagem: err.message });
      }
      if (err.code === 'P2025')
        return res.status(404).json({ sucesso: false, mensagem: 'Prestador não encontrado' });
      if (ehColunaCurtaDeTipoServico(err))
        return res.status(400).json({ sucesso: false, mensagem: MSG_COLUNA_CURTA });
      console.error('Erro ao atualizar prestador:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao atualizar prestador' });
    }
  },

  // PATCH /api/cadastro/prestadores/:id/toggle — escopado por empresa/equipe (checkPermission na rota)
  toggleAtivo: async (req, res) => {
    try {
      const { motivo } = req.body ?? {};
      const existe = await prisma.prestador.findUnique({ where: { id: Number(req.params.id) } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Prestador não encontrado' });
      if (!podeAlterarRegistroEscopado(existe, req))
        return res.status(403).json({ sucesso: false, mensagem: 'Você não tem acesso para alterar este prestador.' });

      const vaiInativar = existe.ativo;

      // Justificativa obrigatória só para INATIVAR — ativar não pede motivo.
      if (vaiInativar && !motivo?.trim()) {
        return res.status(400).json({ sucesso: false, mensagem: 'É obrigatório informar o motivo da inativação' });
      }

      if (vaiInativar) {
        await registrarInativacao(prisma, 'prestador', existe.id, req.user.id, motivo.trim());
      } else {
        await registrarAtivacao(prisma, 'prestador', existe.id, req.user.id);
      }

      // 🔴 MESMA REGRA DO FORNECEDOR (2026-09-04): prestador inativado perde o acesso
      // aos dados da empresa, e reativado o recupera. Sem isto o cadastro sumia da
      // lista mas o login continuava valendo e ele seguia enxergando os pacientes
      // designados. ⚠️ O que ele já fez na empresa não é tocado — encaminhamentos,
      // exames e designações ficam como estão.
      if (existe.userId && existe.empresaId) {
        await definirAtivoNaEmpresa(prisma, existe.userId, existe.empresaId, !vaiInativar);
      }

      // Mesma auditoria de Equipe (lib/auditoria.js) — quem foi (in)ativado, quando
      // (timestamp da própria linha) e quem fez (userId/userName/email da linha).
      await registrarAuditoria(prisma, req, {
        // A categoria diz O QUE ACONTECEU: (in)ativar um cadastro não é a mesma
        // coisa que editar um campo dele, e ALTERACAO misturava os dois.
        categoria: vaiInativar ? 'INATIVACAO' : 'ATIVACAO',
        entidade:  'PRESTADOR',
        entidadeId: existe.id,
        motivo:    vaiInativar ? motivo.trim() : null,
        detalhes:  `${req.user.fullName ?? req.user.email} ${vaiInativar ? 'inativou' : 'ativou'} o prestador ${existe.nome}`,
      });

      const prestadorAtualizado = await prisma.prestador.findUnique({
        where: { id: existe.id },
        include: PRESTADOR_INCLUDE,
      });
      const [comTrilha] = await anexarTrilha([prestadorAtualizado], 'prestador');
      res.json({
        sucesso:  true,
        dados:    comTrilha,
        mensagem: vaiInativar ? 'Prestador inativado' : 'Prestador ativado',
      });
    } catch (err) {
      console.error('Erro ao alternar status do prestador:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao alternar status' });
    }
  },
};

module.exports = PrestadorController;

// Exportados para teste: as duas decidem, EM SILÊNCIO, o que vai para a coluna
// `tipo_servico` e se um cadastro é ou não duplicata. Errar aqui não dá erro de
// tela — dá tipo repetido no chip ou prestador duplicado no catálogo.
module.exports.sanearTiposServico = sanearTiposServico;
module.exports.normalizarTipos    = normalizarTipos;
module.exports.LIMITE_TIPO_SERVICO = LIMITE_TIPO_SERVICO;
