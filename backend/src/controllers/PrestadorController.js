// backend/src/controllers/PrestadorController.js
'use strict';

const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma').default;
const { getEquipeScopeDoUsuario } = require('../lib/vetUtils');
const { podeAlterarRegistroEscopado } = require('../lib/cadastroScopeAccess');
const { normalizarPagamento } = require('../lib/usuarioEmpresa');
const { registrarAtivacao, registrarInativacao, anexarTrilha } = require('../lib/cadastroAtivacao');
const { registrarAuditoria, registrarAlteracao } = require('../lib/auditoria');
const emailService = require('../services/emailService');

// Whitelist fixa SAIU (2026-08-25) — o tipo de serviço agora vem do catálogo
// tenant-scoped (tb_catalogo_tipo_servico, CatalogoTipoServicoController), que
// cresce por uso. Validação aqui é só "não vazio, tamanho razoável".

const SENHA_INICIAL = 'Inicial_001';

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
// com a clínica) — só valida quando ALGUM dos 3 campos vier preenchido; a validação
// em si é a MESMA do Incluir Membro (normalizarPagamento, lib/usuarioEmpresa.js).
function resolverPagamento(body) {
  const { tipoPagamento, formaPagamento, valorPagamento } = body;
  const iniciado = !!tipoPagamento || !!formaPagamento ||
    (valorPagamento !== undefined && valorPagamento !== null && String(valorPagamento).trim() !== '');
  if (!iniciado) return { erro: null, dados: { tipoPagamento: null, formaPagamento: null, valorPagamento: null } };
  return normalizarPagamento({ tipoPagamento, formaPagamento, valorPagamento });
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

  const senhaHash = await bcrypt.hash(SENHA_INICIAL, 10);
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

const PrestadorController = {

  // GET /api/cadastro/prestadores?busca=X&ativo=true|false|all
  listar: async (req, res) => {
    try {
      const { busca, ativo } = req.query;
      const where = {};

      if (ativo === 'all') { /* sem filtro */ }
      else if (ativo !== undefined) where.ativo = ativo === 'true';
      else where.ativo = true;

      // Escopo por empresa/equipe: não-ADMIN vê globais (empresaId null = SYSTEM/legado)
      // + prestadores da empresa ativa, segregados pela equipe do contexto (igual Fornecedor)
      if (req.user?.role !== 'ADMIN') {
        const equipeScope = await getEquipeScopeDoUsuario(req.user.id, req.empresaId, req.equipeId);
        where.AND = [{
          OR: [
            { empresaId: null },
            { empresaId: req.empresaId ?? -1, equipeId: null },
            ...(equipeScope
              ? [{ empresaId: req.empresaId ?? -1, equipeId: { in: equipeScope } }]
              : [{ empresaId: req.empresaId ?? -1 }]),
          ],
        }];
      }

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

      res.json({ sucesso: true, dados: await anexarTrilha(prestadores, 'prestador') });
    } catch (err) {
      console.error('Erro ao listar prestadores:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao listar prestadores' });
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
      acessoSistema, locaisTrabalho,
    } = req.body;

    if (!nome?.trim())
      return res.status(400).json({ sucesso: false, mensagem: 'Nome é obrigatório' });
    if (!telefone?.trim())
      return res.status(400).json({ sucesso: false, mensagem: 'Telefone é obrigatório' });
    if (!tipoServico?.trim())
      return res.status(400).json({ sucesso: false, mensagem: 'Selecione o tipo de serviço' });
    if (tipoServico.trim().length > 50)
      return res.status(400).json({ sucesso: false, mensagem: 'Tipo de serviço muito longo (máx. 50 caracteres)' });
    if (acessoSistema === true && !email?.trim())
      return res.status(400).json({ sucesso: false, mensagem: 'E-mail é obrigatório para conceder acesso ao sistema.' });

    const { erro: erroPagamento, dados: pagamento } = resolverPagamento(req.body);
    if (erroPagamento) return res.status(400).json({ sucesso: false, mensagem: erroPagamento });

    const tipoEntrada = req.user?.role === 'ADMIN' ? 'SYSTEM' : 'CLIENTE';
    const empresaAlvo = tipoEntrada === 'CLIENTE' ? (req.empresaId ?? null) : null;
    const equipeAlvo  = tipoEntrada === 'CLIENTE' ? (req.equipeId ?? null)  : null;

    try {
      const dup = await verificarDuplicidade({ cpf, nome, tipoServico: tipoServico.trim(), telefone, empresaId: empresaAlvo });
      if (dup) {
        if (dup.ativo) return res.status(409).json({ sucesso: false, mensagem: MSG_DUPLICADO[dup.tipo] });
        if (!req.body.force) return res.status(409).json({
          sucesso: false, inativo: true,
          mensagem: buildMensagemInativo(dup.tipo, dup.prestador),
          prestador: dup.prestador,
        });
      }

      let usuarioCriado = false;

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
            tipoServico: tipoServico.trim(),
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

        if (acessoSistema === true) {
          const login = await provisionarLogin(tx, {
            prestadorId: criado.id, nome: criado.nome, telefone: criado.telefone, email: criado.email,
          });
          await tx.prestador.update({ where: { id: criado.id }, data: { userId: login.userId } });
          usuarioCriado = login.criado;
        }

        return criado.id;
      });

      if (usuarioCriado) {
        emailService.enviarBoasVindasProprietario({
          destinatarioEmail: email.trim().toLowerCase(),
          destinatarioNome:  nome.trim(),
          criadoPorNome:     req.user?.fullName || 'Equipe',
          senhaInicial:      SENHA_INICIAL,
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
      acessoSistema, locaisTrabalho,
    } = req.body;

    if (!nome?.trim())
      return res.status(400).json({ sucesso: false, mensagem: 'Nome é obrigatório' });
    if (!telefone?.trim())
      return res.status(400).json({ sucesso: false, mensagem: 'Telefone é obrigatório' });
    if (tipoServico && tipoServico.trim().length > 50) {
      return res.status(400).json({ sucesso: false, mensagem: 'Tipo de serviço muito longo (máx. 50 caracteres)' });
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

      const tipoServicoFinal = tipoServico?.trim() || existe.tipoServico;

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

        // Provisiona o login só na transição false/nulo → true (userId ainda vazio).
        if (acessoSistema === true && !existe.userId) {
          const login = await provisionarLogin(tx, {
            prestadorId: Number(id), nome: nome.trim(), telefone: telefone.trim(), email: emailFinal,
          });
          await tx.prestador.update({ where: { id: Number(id) }, data: { userId: login.userId } });
          usuarioCriado = login.criado;
        }
      });

      if (usuarioCriado) {
        emailService.enviarBoasVindasProprietario({
          destinatarioEmail: emailFinal,
          destinatarioNome:  nome.trim(),
          criadoPorNome:     req.user?.fullName || 'Equipe',
          senhaInicial:      SENHA_INICIAL,
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

      // Mesma auditoria de Equipe (lib/auditoria.js) — quem foi (in)ativado, quando
      // (timestamp da própria linha) e quem fez (userId/userName/email da linha).
      await registrarAuditoria(prisma, req, {
        categoria: 'ALTERACAO',
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
