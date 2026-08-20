// backend/src/controllers/ProprietarioController.js
'use strict';

const bcrypt       = require('bcryptjs');
const prisma       = require('../lib/prisma').default;
const emailService = require('../services/emailService');
const { getContextoDoVet, getEquipeScopeDoUsuario } = require('../lib/vetUtils');
const { registrarAuditoria, registrarAlteracao } = require('../lib/auditoria');
const { normalizeEmail, findUserByEmail, whereEmailInsensitive } = require('../lib/email');
const perfilProp = require('../lib/proprietarioPerfil');
const { registrarAtivacao, registrarInativacao } = require('../lib/cadastroAtivacao');
// Trilha de ativação/desativação do ANIMAL (quem/quando) — mesma usada por
// AnimalController.excluir. registrarDesativacao já grava ativo=false sozinha.
const { registrarDesativacao: registrarDesativacaoAnimal } = require('../lib/animalAtivacao');
const { cancelarPendenciasDoAnimal } = require('../lib/cancelamentoPendencias');
// Localidades atendidas do cliente, com a frequência de visitas de CADA uma
const localidadesProp = require('../lib/proprietarioLocalidades');
// Tabela de ligação usuário × empresa — perfil PROPRIETARIO + cadastro da empresa
const { salvarVinculo, ehProfissionalNaEmpresa } = require('../lib/usuarioEmpresa');

// Dia de vencimento da fatura: obrigatório, inteiro entre 1 e 25
// (rejeita vazio, 0, negativo e > 25 — espelha a validação inline do frontend).
function validarDiaVencimento(valor) {
  const n = Number(valor);
  return valor !== undefined && valor !== null && valor !== '' &&
    Number.isInteger(n) && n >= 1 && n <= 25;
}

const SELECT_PROPRIETARIO = {
  id: true, fullName: true, email: true, phone: true, phone2: true,
  role: true, userType: true, ativo: true, createdAt: true,
  cep: true, endereco: true, complemento: true, bairro: true, cidade: true, estado: true,
  cpf: true, cnpj: true, mensalista: true, valorAssistencia: true, frequenciaVisitas: true, diaVencimentoFatura: true,
};

// Proprietário pertence ao escopo (empresa + equipes do contexto):
// - animal ativo numa equipe do escopo, OU animal legado sem equipe na empresa,
// - OU cadastrado direto numa equipe do escopo / legado sem equipe na empresa.
// equipeScope null = sem restrição por equipe (dono da empresa sem MembroEquipe).
function whereProprietarioNoEscopo(empresaId, equipeScope) {
  if (!equipeScope) {
    return {
      OR: [
        { animais: { some: { empresaId, ativo: true } } },
        { empresaId },
      ],
    };
  }
  return {
    OR: [
      { animais: { some: { ativo: true, equipeId: { in: equipeScope } } } },
      { animais: { some: { ativo: true, empresaId, equipeId: null } } },
      { empresaId, equipeId: { in: equipeScope } },
      { empresaId, equipeId: null },
    ],
  };
}

/**
 * Quem é CLIENTE (proprietário) DENTRO DESTA EMPRESA.
 *
 * ⚠️ NÃO usar `users.userType === 'PROPRIETARIO'` sozinho: aquele campo é GLOBAL e
 * vale para todas as empresas (CLAUDE.md 36-e). A mesma pessoa pode ser GESTORA de uma
 * clínica e CLIENTE dela — e era exatamente esse caso que sumia da tela: ao virar
 * gestora, o `userType` global passa a VETERINARIO e o filtro a descartava, mesmo com
 * cadastro de cliente e animal ativo na empresa.
 *
 * É cliente aqui quem tem QUALQUER um destes:
 *   - `userType` PROPRIETARIO (cliente puro — legado e caso comum);
 *   - cadastro de cliente NESTA empresa (`ProprietarioPerfil`);
 *   - vínculo com perfil PROPRIETARIO nesta empresa (`UsuarioEmpresa`);
 *   - animal ATIVO aos cuidados da empresa (o profissional dono do próprio animal).
 *
 * Sempre combinado com `whereProprietarioNoEscopo` — este predicado diz "é cliente",
 * o outro diz "é cliente DAQUI". Sem empresa no contexto (ADMIN de plataforma) não há
 * o que resolver por empresa: vale o `userType` global.
 */
function whereEhClienteDaEmpresa(empresaId) {
  if (!empresaId) return { userType: 'PROPRIETARIO' };
  return {
    OR: [
      { userType: 'PROPRIETARIO' },
      { proprietarioPerfis: { some: { empresaId } } },
      { empresasVinculadas: { some: { empresaId, perfil: 'PROPRIETARIO' } } },
      { animais: { some: { empresaId, ativo: true } } },
    ],
  };
}

// Verifica se o proprietário está no escopo de empresa/equipe do solicitante
async function verificarAcessoNoEscopo(proprietarioId, empresaId, equipeScope) {
  const prop = await prisma.user.findFirst({
    where:  { id: proprietarioId, ...whereProprietarioNoEscopo(empresaId, equipeScope) },
    select: { id: true },
  });
  return !!prop;
}

const ProprietarioController = {

  // GET /api/cadastro/proprietarios
  listar: async (req, res) => {
    try {
      const { busca, ativo } = req.query;
      const isAdmin   = req.user?.role === 'ADMIN';
      const termo     = busca?.trim() ?? '';

      const where = { AND: [whereEhClienteDaEmpresa(req.empresaId)] };

      if (!isAdmin) {
        if (!req.empresaId) {
          return res.json({ sucesso: true, dados: [] });
        }
        // Escopo por equipe dentro da empresa ativa (segregação entre equipes do gestor)
        const equipeScope = await getEquipeScopeDoUsuario(req.user.id, req.empresaId, req.equipeId);
        where.AND.push(whereProprietarioNoEscopo(req.empresaId, equipeScope));
      }

      // ADMIN global (sem empresa ativa) não tem perfil por empresa para mesclar —
      // filtra direto no banco. Com empresa ativa, os campos pesquisáveis vêm do
      // PERFIL da empresa, então o filtro roda depois do merge (lista pequena).
      const filtrarNoBanco = !req.empresaId;
      if (termo && filtrarNoBanco) {
        where.AND.push({
          OR: [
            { fullName: { contains: termo, mode: 'insensitive' } },
            { email:    { contains: termo, mode: 'insensitive' } },
            { cpf:      { contains: termo, mode: 'insensitive' } },
            { cnpj:     { contains: termo, mode: 'insensitive' } },
            { cidade:   { contains: termo, mode: 'insensitive' } },
          ],
        });
      }

      const encontrados = await prisma.user.findMany({
        where,
        orderBy: { fullName: 'asc' },
        select:  SELECT_PROPRIETARIO,
      });

      // Cadastro que ESTA empresa mantém sobre o cliente (isolado das demais)
      let proprietarios = await perfilProp.aplicarPerfilEmLista(encontrados, req.empresaId);

      if (termo && !filtrarNoBanco) {
        const alvo = termo.toLowerCase();
        const bate = (v) => String(v ?? '').toLowerCase().includes(alvo);
        proprietarios = proprietarios.filter(p =>
          bate(p.fullName) || bate(p.email) || bate(p.cpf) || bate(p.cnpj) || bate(p.cidade));
      }
      // Reordena pelo nome da empresa ativa (o merge pode ter trocado o fullName)
      proprietarios.sort((a, b) => String(a.fullName ?? '').localeCompare(String(b.fullName ?? ''), 'pt-BR'));

      // Filtro por status — mesmo contrato de FornecedorController.listar:
      // 'all' = sem filtro; 'true'/'false' = só aquele estado; ausente = só ativos.
      // `ativo` só existe no objeto DEPOIS do merge com o perfil (perfilProp.mesclar),
      // por isso o filtro é em memória, não no `where` do Prisma.
      if (ativo === 'all') { /* sem filtro */ }
      else if (ativo !== undefined) proprietarios = proprietarios.filter(p => p.ativo === (ativo === 'true'));
      else proprietarios = proprietarios.filter(p => p.ativo !== false);

      // Localidades atendidas + frequência de cada uma (combinado desta empresa)
      proprietarios = await localidadesProp.anexarEmLista(proprietarios, req.empresaId);
      // Trilha de ativação/inativação (quem, quando) — abas Ativos/Inativos da tela
      proprietarios = await perfilProp.anexarTrilhaAtivacaoEmLista(proprietarios, req.empresaId);

      res.json({ sucesso: true, dados: proprietarios });
    } catch (err) {
      console.error('Erro ao listar proprietários:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao listar proprietários' });
    }
  },

  // GET /api/cadastro/proprietarios/:id
  obterPorId: async (req, res) => {
    try {
      const isAdmin = req.user?.role === 'ADMIN';
      const proprietario = await prisma.user.findFirst({
        where:  { id: Number(req.params.id), ...whereEhClienteDaEmpresa(req.empresaId) },
        select: SELECT_PROPRIETARIO,
      });
      if (!proprietario) return res.status(404).json({ sucesso: false, mensagem: 'Proprietário não encontrado' });

      if (!isAdmin && req.empresaId) {
        const equipeScope = await getEquipeScopeDoUsuario(req.user.id, req.empresaId, req.equipeId);
        const temAcesso = await verificarAcessoNoEscopo(proprietario.id, req.empresaId, equipeScope);
        if (!temAcesso) return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado' });
      }

      const comPerfil = await perfilProp.aplicarPerfil(proprietario, req.empresaId);
      const comLocalidades = await localidadesProp.anexar(comPerfil, req.empresaId);
      // Sugestão para a tela de edição: localização já usada por algum animal ATIVO
      // do cliente que ainda não virou "localidade atendida" confirmada — evita o
      // gestor ter que buscar de novo um local que o cadastro do animal já sabe.
      const localidadesSugeridas = await localidadesProp.localidadesSugeridasDeAnimais(
        proprietario.id, req.empresaId,
      );
      res.json({ sucesso: true, dados: { ...comLocalidades, localidadesSugeridas } });
    } catch (err) {
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao buscar proprietário' });
    }
  },

  // POST /api/cadastro/proprietarios
  criar: async (req, res) => {
    const {
      fullName, email, phone, phone2, senha,
      cep, endereco, complemento, bairro, cidade, estado,
      cpf, cnpj, mensalista, valorAssistencia, frequenciaVisitas, diaVencimentoFatura,
      localidades,
    } = req.body;

    if (!fullName?.trim()) return res.status(400).json({ sucesso: false, mensagem: 'Nome é obrigatório' });
    if (!email?.trim())    return res.status(400).json({ sucesso: false, mensagem: 'E-mail é obrigatório' });
    if (!phone?.trim())    return res.status(400).json({ sucesso: false, mensagem: 'Telefone é obrigatório' });
    if (!validarDiaVencimento(diaVencimentoFatura)) {
      return res.status(400).json({ sucesso: false, mensagem: 'Dia de vencimento da fatura é obrigatório e deve ser entre 1 e 25' });
    }

    // Localidades atendidas, cada uma com a sua frequência de visitas semanais
    const locParsed = localidadesProp.normalizarLocalidades(localidades);
    if (locParsed.erro) return res.status(400).json({ sucesso: false, mensagem: locParsed.erro });

    // O campo único vira AGREGADO (a maior frequência) quando há localidades — é o
    // que as leituras legadas e o ADMIN global continuam enxergando.
    const freqEfetiva = locParsed.localidades?.length
      ? localidadesProp.frequenciaAgregada(locParsed.localidades)
      : (frequenciaVisitas ? Number(frequenciaVisitas) : null);

    // Dados que pertencem à EMPRESA (viram o perfil isolado), não ao login
    const dadosDaEmpresa = {
      fullName:          fullName.trim(),
      phone:             phone?.trim()       || null,
      phone2:            phone2?.trim()      || null,
      cep:               cep?.trim()         || null,
      endereco:          endereco?.trim()    || null,
      complemento:       complemento?.trim() || null,
      bairro:            bairro?.trim()      || null,
      cidade:            cidade?.trim()      || null,
      estado:            estado?.trim()      || null,
      cpf:               cpf?.trim()         || null,
      cnpj:              cnpj?.trim()        || null,
      mensalista:        Boolean(mensalista),
      valorAssistencia:  valorAssistencia ? Number(valorAssistencia) : null,
      frequenciaVisitas: freqEfetiva,
      diaVencimentoFatura: Number(diaVencimentoFatura),
    };

    try {
      const emailNorm = normalizeEmail(email);
      const existente = await findUserByEmail(prisma, emailNorm, {
        select: { id: true, userType: true, empresaId: true, equipeId: true },
      });

      // Cliente que JÁ EXISTE no sistema (atendido por outra clínica): não é erro.
      // O login é um só (e-mail único); esta empresa ganha o PRÓPRIO cadastro dele,
      // preenchido com o que o gestor digitou — sem herdar nem alterar o da outra.
      if (existente) {
        if (!req.empresaId) {
          return res.status(409).json({ sucesso: false, mensagem: 'E-mail já cadastrado' });
        }
        const jaTemPerfil = await prisma.proprietarioPerfil.findUnique({
          where:  { userId_empresaId: { userId: existente.id, empresaId: req.empresaId } },
          select: { id: true },
        });
        if (jaTemPerfil) {
          return res.status(409).json({ sucesso: false, mensagem: 'E-mail já cadastrado nesta empresa' });
        }

        // PROFISSIONAL que também é cliente: o vínculo é UM por (usuário, empresa) e
        // guarda um só `perfil` — sobrescrevê-lo com PROPRIETARIO REBAIXARIA a gestora
        // ou o veterinário a cliente na própria clínica. O papel profissional vence; o
        // que registra o cliente é o `ProprietarioPerfil`, que é tabela à parte.
        // (Antes este caminho respondia 409 "E-mail já cadastrado" e a pessoa
        // simplesmente não podia ser cadastrada como cliente da empresa onde trabalha.)
        // `ehProfissionalNaEmpresa` cobre TAMBÉM o dono sem linha em tb_usuario_empresa
        // — sem isso, o dono que se cadastra como cliente da própria empresa perde o
        // `perfil` GESTOR (caso real corrigido em 2026-08-11: dona da Patyvet).
        const perfilProfissional = await ehProfissionalNaEmpresa(existente.id, req.empresaId, prisma);

        await salvarVinculo(prisma, existente.id, req.empresaId, {
          ...(perfilProfissional ? {} : { perfil: 'PROPRIETARIO' }),
          ...dadosDaEmpresa,
          ativo: true,
        });
        const perfilCriado = await perfilProp.salvarPerfil(prisma, existente.id, req.empresaId, { ...dadosDaEmpresa, ativo: true });
        await localidadesProp.salvarLocalidades(prisma, existente.id, req.empresaId, locParsed.localidades);
        // Perfil nasce ativo=true: grava a trilha de ativação também na CRIAÇÃO,
        // senão "Ativado em/por" fica vazio até alguém desativar e reativar.
        if (perfilCriado) {
          await registrarAtivacao(prisma, 'proprietario', perfilCriado.id, req.user.id);
        }
        await registrarAuditoria(prisma, req, {
          categoria:  'CRIACAO',
          entidade:   'PROPRIETARIO',
          entidadeId: existente.id,
          detalhes:   `${dadosDaEmpresa.fullName} — ${emailNorm} (cadastro desta empresa; login já existia)`,
        });

        // Proprietário legado sem empresa de origem: adota a atual (não sobrescreve)
        if (!existente.empresaId) {
          const ctx = await getContextoDoVet(req.user.id, req.empresaId, req.equipeId);
          await prisma.user.update({
            where: { id: existente.id },
            data:  { empresaId: req.empresaId, equipeId: ctx.equipeId ?? null },
          });
        }

        const base = await prisma.user.findUnique({ where: { id: existente.id }, select: SELECT_PROPRIETARIO });
        const comPerfil = await perfilProp.aplicarPerfil(base, req.empresaId);
        return res.status(201).json({
          sucesso: true,
          dados:   await localidadesProp.anexar(comPerfil, req.empresaId),
          mensagem: 'Cliente já possuía acesso ao sistema — foi criado o cadastro desta empresa.',
        });
      }

      // Sem senha no payload → padrão do sistema, com troca obrigatória no primeiro acesso
      const senhaEfetiva = senha || 'Inicial_001';
      const passwordHash = await bcrypt.hash(senhaEfetiva, 10);
      const criadoPor = req.user?.fullName ?? 'sua clínica';
      const equipeDoContexto = req.empresaId
        ? (await getContextoDoVet(req.user.id, req.empresaId, req.equipeId)).equipeId
        : null;

      // O User guarda a identidade + uma cópia inicial dos dados (compatibilidade com
      // leituras legadas e com o ADMIN global). O cadastro que vale para a clínica é o
      // PERFIL da empresa, criado logo abaixo na mesma transação.
      const proprietario = await prisma.$transaction(async (tx) => {
        const criado = await tx.user.create({
          data: {
            ...dadosDaEmpresa,
            email:             emailNorm,
            role:              'USER',
            userType:          'PROPRIETARIO',
            passwordHash,
            mustChangePassword: true,
            ativo:     true,
            empresaId: req.empresaId || null,
            // Equipe do contexto ativo do gestor — segrega o proprietário por equipe
            equipeId:  equipeDoContexto,
          },
          select: SELECT_PROPRIETARIO,
        });
        if (req.empresaId) {
          await salvarVinculo(tx, criado.id, req.empresaId, { perfil: 'PROPRIETARIO', ...dadosDaEmpresa, ativo: true });
          const perfilCriado = await perfilProp.salvarPerfil(tx, criado.id, req.empresaId, { ...dadosDaEmpresa, ativo: true });
          await localidadesProp.salvarLocalidades(tx, criado.id, req.empresaId, locParsed.localidades);
          // Perfil nasce ativo=true: grava a trilha de ativação também na CRIAÇÃO,
          // senão "Ativado em/por" fica vazio até alguém desativar e reativar.
          if (perfilCriado) {
            await registrarAtivacao(tx, 'proprietario', perfilCriado.id, req.user.id);
          }
        }
        await registrarAuditoria(tx, req, {
          categoria:  'CRIACAO',
          entidade:   'PROPRIETARIO',
          entidadeId: criado.id,
          detalhes:   `${criado.fullName} — ${criado.email}`,
        });
        return criado;
      });

      emailService.enviarBoasVindasProprietario({
        destinatarioEmail: emailNorm,
        destinatarioNome:  fullName.trim(),
        criadoPorNome:     criadoPor,
        senhaInicial:      senhaEfetiva,
      }).catch(err => console.warn('[ProprietarioController] Falha ao enviar e-mail de boas-vindas:', err?.message));

      res.status(201).json({ sucesso: true, dados: await localidadesProp.anexar(proprietario, req.empresaId) });
    } catch (err) {
      if (err.code === 'P2002') return res.status(409).json({ sucesso: false, mensagem: 'E-mail já cadastrado' });
      console.error('Erro ao criar proprietário:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao criar proprietário' });
    }
  },

  // PUT /api/cadastro/proprietarios/:id
  atualizar: async (req, res) => {
    const { id } = req.params;
    const {
      fullName, email, phone, phone2, senha, ativo,
      cep, endereco, complemento, bairro, cidade, estado,
      cpf, cnpj, mensalista, valorAssistencia, frequenciaVisitas, diaVencimentoFatura,
      localidades,
    } = req.body;

    if (!fullName?.trim()) return res.status(400).json({ sucesso: false, mensagem: 'Nome é obrigatório' });
    if (!email?.trim())    return res.status(400).json({ sucesso: false, mensagem: 'E-mail é obrigatório' });
    if (diaVencimentoFatura !== undefined && !validarDiaVencimento(diaVencimentoFatura)) {
      return res.status(400).json({ sucesso: false, mensagem: 'Dia de vencimento da fatura deve ser entre 1 e 25' });
    }

    // Localidades atendidas, cada uma com a sua frequência de visitas semanais
    const locParsed = localidadesProp.normalizarLocalidades(localidades);
    if (locParsed.erro) return res.status(400).json({ sucesso: false, mensagem: locParsed.erro });

    try {
      const isAdmin = req.user?.role === 'ADMIN';
      const existe  = await prisma.user.findFirst({ where: { id: Number(id), ...whereEhClienteDaEmpresa(req.empresaId) } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Proprietário não encontrado' });

      // "Antes" para a auditoria — a visão EFETIVA (mesclada com o perfil desta
      // empresa), que é a mesma coisa que a tela de edição mostrou pro usuário.
      // Comparar contra o User cru daria falso positivo de mudança em todo campo
      // que o perfil da empresa sobrescreve.
      const antes = await perfilProp.aplicarPerfil(existe, req.empresaId);

      if (!isAdmin && req.empresaId) {
        const equipeScope = await getEquipeScopeDoUsuario(req.user.id, req.empresaId, req.equipeId);
        const temAcesso = await verificarAcessoNoEscopo(Number(id), req.empresaId, equipeScope);
        if (!temAcesso) return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado' });
      }

      const emailNovo = normalizeEmail(email);
      if (emailNovo !== (existe.email ?? '').toLowerCase()) {
        const duplicado = await prisma.user.findFirst({ where: { ...whereEmailInsensitive(emailNovo), id: { not: Number(id) } }, select: { id: true } });
        if (duplicado) return res.status(409).json({ sucesso: false, mensagem: 'E-mail já está em uso' });
      }

      // Dados cadastrais → PERFIL DA EMPRESA ATIVA. É isto que impede que a edição
      // feita na empresa A altere o cadastro que a empresa B mantém do mesmo cliente.
      const dadosDaEmpresa = {
        fullName:         fullName.trim(),
        phone:            phone?.trim()       || null,
        phone2:           phone2?.trim()      || null,
        cep:              cep?.trim()         || null,
        endereco:         endereco?.trim()    || null,
        complemento:      complemento?.trim() || null,
        bairro:           bairro?.trim()      || null,
        cidade:           cidade?.trim()      || null,
        estado:           estado?.trim()      || null,
        cpf:              cpf?.trim()         || null,
        cnpj:             cnpj?.trim()        || null,
        ...(mensalista        !== undefined ? { mensalista: Boolean(mensalista) } : {}),
        ...(valorAssistencia  !== undefined ? { valorAssistencia:  valorAssistencia  ? Number(valorAssistencia)  : null } : {}),
        // Com localidades informadas, o campo único é o AGREGADO delas (a maior
        // frequência); sem elas, mantém o comportamento antigo do campo avulso.
        ...(locParsed.localidades !== undefined
          ? { frequenciaVisitas: localidadesProp.frequenciaAgregada(locParsed.localidades) }
          : (frequenciaVisitas !== undefined
              ? { frequenciaVisitas: frequenciaVisitas ? Number(frequenciaVisitas) : null }
              : {})),
        ...(diaVencimentoFatura !== undefined ? { diaVencimentoFatura: Number(diaVencimentoFatura) } : {}),
      };

      // Identidade (compartilhada entre as empresas): só e-mail, senha e ativo global.
      const dataUser = { email: emailNovo };
      // Senha é da PESSOA: só o ADMIN e o próprio dono da conta alteram. A clínica
      // cadastra e edita o cliente, não a credencial dele (quem esqueceu usa
      // "esqueci minha senha"; conta nova nasce com a padrão + troca no 1º acesso).
      if (senha?.trim()) {
        const ehProprio = Number(req.user.id) === Number(id);
        if (!isAdmin && !ehProprio) {
          return res.status(403).json({
            sucesso:  false,
            mensagem: 'Apenas o administrador ou o próprio usuário podem alterar a senha.',
          });
        }
        dataUser.passwordHash = await bcrypt.hash(senha.trim(), 10);
      }
      if (isAdmin && ativo !== undefined) dataUser.ativo = Boolean(ativo);

      // Diff para a auditoria — construído uma vez, usado nos dois ramos da
      // transaction abaixo. Campos condicionais (só entram em `dadosDaEmpresa`
      // quando o body os mandou) só entram aqui também — senão "não veio no body"
      // seria lido como "mudou para vazio".
      const camposDiff = {
        'nome':        { de: antes.fullName,    para: dadosDaEmpresa.fullName },
        'e-mail':      { de: antes.email,       para: emailNovo },
        'telefone':    { de: antes.phone,       para: dadosDaEmpresa.phone },
        'telefone 2':  { de: antes.phone2,      para: dadosDaEmpresa.phone2 },
        'CEP':         { de: antes.cep,         para: dadosDaEmpresa.cep },
        'endereço':    { de: antes.endereco,    para: dadosDaEmpresa.endereco },
        'complemento': { de: antes.complemento, para: dadosDaEmpresa.complemento },
        'bairro':      { de: antes.bairro,      para: dadosDaEmpresa.bairro },
        'cidade':      { de: antes.cidade,      para: dadosDaEmpresa.cidade },
        'estado':      { de: antes.estado,      para: dadosDaEmpresa.estado },
        'CPF':         { de: antes.cpf,         para: dadosDaEmpresa.cpf },
        'CNPJ':        { de: antes.cnpj,        para: dadosDaEmpresa.cnpj },
        ...('mensalista' in dadosDaEmpresa
          ? { 'mensalista': { de: antes.mensalista, para: dadosDaEmpresa.mensalista } } : {}),
        ...('valorAssistencia' in dadosDaEmpresa
          ? { 'valor da assistência': { de: antes.valorAssistencia, para: dadosDaEmpresa.valorAssistencia } } : {}),
        ...('frequenciaVisitas' in dadosDaEmpresa
          ? { 'frequência de visitas': { de: antes.frequenciaVisitas, para: dadosDaEmpresa.frequenciaVisitas } } : {}),
        ...('diaVencimentoFatura' in dadosDaEmpresa
          ? { 'dia de vencimento': { de: antes.diaVencimentoFatura, para: dadosDaEmpresa.diaVencimentoFatura } } : {}),
      };

      const proprietario = await prisma.$transaction(async (tx) => {
        // Sem empresa ativa (ADMIN global) não há perfil a gravar: mantém o
        // comportamento antigo, escrevendo os dados no próprio User.
        if (!req.empresaId) {
          const atualizado = await tx.user.update({
            where:  { id: Number(id) },
            data:   { ...dataUser, ...dadosDaEmpresa },
            select: SELECT_PROPRIETARIO,
          });
          await registrarAlteracao(tx, req, { entidade: 'PROPRIETARIO', entidadeId: Number(id), campos: camposDiff });
          return atualizado;
        }
        const base = await tx.user.update({
          where:  { id: Number(id) },
          data:   dataUser,
          select: SELECT_PROPRIETARIO,
        });
        // PROFISSIONAL que também é cliente: o vínculo é UM por (usuário, empresa) e
        // guarda um só `perfil` — sobrescrevê-lo com PROPRIETARIO REBAIXARIA a gestora
        // ou o veterinário a cliente na própria clínica (mesma proteção de `criar`,
        // que já tinha isto; faltava aqui). O papel profissional vence; o que registra
        // o cliente é o `ProprietarioPerfil`, tabela à parte. Também cobre o DONO sem
        // linha em tb_usuario_empresa — ver `ehProfissionalNaEmpresa`.
        const perfilProfissional = await ehProfissionalNaEmpresa(Number(id), req.empresaId, tx);
        await salvarVinculo(tx, Number(id), req.empresaId, {
          ...(perfilProfissional ? {} : { perfil: 'PROPRIETARIO' }),
          ...dadosDaEmpresa,
        });
        const perfil = await perfilProp.salvarPerfil(tx, Number(id), req.empresaId, dadosDaEmpresa);
        await localidadesProp.salvarLocalidades(tx, Number(id), req.empresaId, locParsed.localidades);
        await registrarAlteracao(tx, req, { entidade: 'PROPRIETARIO', entidadeId: Number(id), campos: camposDiff });
        return perfilProp.mesclar(base, perfil);
      });

      res.json({ sucesso: true, dados: await localidadesProp.anexar(proprietario, req.empresaId) });
    } catch (err) {
      if (err.code === 'P2025') return res.status(404).json({ sucesso: false, mensagem: 'Proprietário não encontrado' });
      console.error('Erro ao atualizar proprietário:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao atualizar proprietário' });
    }
  },

  // PATCH /api/cadastro/proprietarios/:id/toggle
  // ADMIN: toggle User.ativo global
  // Gestor: não permitido (remover da empresa usa DELETE)
  toggleAtivo: async (req, res) => {
    const { id } = req.params;
    const isAdmin = req.user?.role === 'ADMIN';

    if (!isAdmin) {
      return res.status(403).json({
        sucesso: false,
        mensagem: 'Para remover um proprietário da empresa use o botão "Remover da Empresa"',
      });
    }

    try {
      const existe = await prisma.user.findFirst({ where: { id: Number(id), ...whereEhClienteDaEmpresa(req.empresaId) } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Proprietário não encontrado' });

      const proprietario = await prisma.user.update({
        where:  { id: Number(id) },
        data:   { ativo: !existe.ativo },
        select: { id: true, fullName: true, ativo: true },
      });
      await registrarAuditoria(prisma, req, {
        categoria:  'ALTERACAO',
        entidade:   'PROPRIETARIO',
        entidadeId: proprietario.id,
        detalhes:   `${req.user.fullName ?? req.user.email} ${proprietario.ativo ? 'ativou' : 'inativou'} o proprietário ${proprietario.fullName} (acesso global)`,
      });
      res.json({ sucesso: true, dados: proprietario, mensagem: `Proprietário ${proprietario.ativo ? 'ativado' : 'inativado'}` });
    } catch (err) {
      console.error('Erro ao alternar status:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao alternar status' });
    }
  },

  // DELETE /api/cadastro/proprietarios/:id
  // Gestor: remove da empresa (inativa animais + clear empresaId)
  // Proprietários NUNCA são excluídos do sistema
  removerDaEmpresa: async (req, res) => {
    const { id } = req.params;
    const { motivo } = req.body ?? {};
    const isAdmin = req.user?.role === 'ADMIN';

    if (!motivo?.trim()) {
      return res.status(400).json({ sucesso: false, mensagem: 'É obrigatório informar o motivo da remoção' });
    }

    if (isAdmin) {
      return res.status(403).json({
        sucesso: false,
        mensagem: 'Proprietários não podem ser excluídos do sistema. Use "Inativar" para desativar o acesso.',
      });
    }

    if (!req.empresaId) {
      return res.status(403).json({ sucesso: false, mensagem: 'Operação requer contexto de empresa' });
    }

    try {
      const existe = await prisma.user.findFirst({ where: { id: Number(id), ...whereEhClienteDaEmpresa(req.empresaId) } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Proprietário não encontrado' });

      const equipeScope = await getEquipeScopeDoUsuario(req.user.id, req.empresaId, req.equipeId);
      const temAcesso = await verificarAcessoNoEscopo(Number(id), req.empresaId, equipeScope);
      if (!temAcesso) return res.status(403).json({ sucesso: false, mensagem: 'Este proprietário não pertence à sua empresa' });

      // Inativa os animais do proprietário no escopo (equipe ativa; legados sem equipe inclusos)
      const resultado = await prisma.$transaction(async (tx) => {
        // `findMany` (não `updateMany`) porque cada animal precisa da SUA trilha de
        // desativação (quem/quando — mesma de AnimalController.excluir) E da cascata de
        // cancelamento das pendências dele (agendamento/vacina/prescrição/exame/
        // encaminhamento em aberto) — sem isso ficavam "fantasmas": sumidos das telas
        // enquanto o cliente está inativo, mas com status de pendente ainda gravado.
        const animaisAfetados = await tx.animal.findMany({
          where: {
            userId:    Number(id),
            empresaId: req.empresaId,
            ativo:     true,
            ...(equipeScope ? { OR: [{ equipeId: { in: equipeScope } }, { equipeId: null }] } : {}),
          },
          select: { id: true },
        });

        const motivoCascata = `Cancelado automaticamente: proprietário removido da empresa — ${motivo}`;
        const pendencias = { agendamentos: 0, evolucoes: 0, vacinas: 0, prescricoes: 0, encaminhamentos: 0, exames: 0 };
        for (const a of animaisAfetados) {
          // ⚠️ NÃO zerar `empresaId`/`equipeId` — `registrarDesativacaoAnimal` só toca
          // `ativo`/`ativo_em`/`ativo_por_id`. Zerar a tenancy era o gerador de órfão nº 1
          // desta base: inativar responde "aparece?", a tenancy responde "de quem é?".
          await registrarDesativacaoAnimal(tx, a.id, req.user.id, motivoCascata);
          const c = await cancelarPendenciasDoAnimal(tx, a.id, req, motivoCascata);
          for (const chave of Object.keys(pendencias)) pendencias[chave] += c[chave];
        }

        // Inativa o cadastro DESTA empresa (o das outras e o login global ficam intactos).
        // `salvarPerfil` faz upsert (cria o perfil se o cliente nunca teve um nesta
        // empresa) e devolve o `id` do PERFIL — é ele, não o userId, que
        // `registrarInativacao` grava na trilha (cadastroAtivacao.js).
        const perfilAtualizado = await perfilProp.salvarPerfil(tx, Number(id), req.empresaId, { ativo: false });
        if (perfilAtualizado) {
          await registrarInativacao(tx, 'proprietario', perfilAtualizado.id, req.user.id, motivo);
        }

        // Orçamento já ACEITO pelo cliente é um compromisso — não pode continuar
        // "aprovado" para quem acabou de ser removido da empresa. Cancelamento
        // AUTOMÁTICO, mesmo texto acrescentado à observação que
        // `orcamentoCronService.js` já usa para o cancelamento por validade vencida
        // (nunca sobrescreve o que o usuário escreveu).
        const motivoOrcamento = 'Cancelado pelo sistema — proprietário inativado.';
        const orcamentosAprovados = await tx.orcamento.findMany({
          where: {
            proprietarioId: Number(id),
            empresaId:      req.empresaId,
            ativo:          true,
            status:         { in: ['APROVADO', 'APROVADO_PARCIALMENTE'] },
          },
          select: { id: true, numero: true, observacao: true },
        });
        for (const orc of orcamentosAprovados) {
          await tx.orcamento.update({
            where: { id: orc.id },
            data:  {
              status:     'CANCELADO',
              observacao: [orc.observacao?.trim(), motivoOrcamento].filter(Boolean).join('\n'),
            },
          });
          await registrarAuditoria(tx, req, {
            categoria:  'CANCELAMENTO',
            entidade:   'ORCAMENTO',
            entidadeId: orc.id,
            motivo:     motivoOrcamento,
            detalhes:   `Orçamento #${String(orc.numero).padStart(4, '0')} cancelado automaticamente — proprietário ${existe.fullName ?? ''} removido da empresa`,
          });
        }

        await registrarAuditoria(tx, req, {
          categoria:  'EXCLUSAO',
          entidade:   'PROPRIETARIO',
          entidadeId: Number(id),
          motivo,
          detalhes:   `${existe.fullName ?? 'Proprietário'} removido da empresa — ${animaisAfetados.length} animal(is) inativado(s) no escopo`,
        });
        return { count: animaisAfetados.length, pendencias, orcamentosCancelados: orcamentosAprovados.length };
      });

      res.json({
        sucesso:  true,
        mensagem: `Proprietário removido da empresa. ${resultado.count} animal(is) inativado(s).`,
        animaisInativados: resultado.count,
        pendenciasCanceladas: resultado.pendencias,
        orcamentosCancelados: resultado.orcamentosCancelados,
      });
    } catch (err) {
      console.error('Erro ao remover proprietário da empresa:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao remover proprietário da empresa' });
    }
  },

  // PATCH /api/cadastro/proprietarios/:id/reativar
  // Gestor da empresa ativa: desfaz a remoção (ProprietarioPerfil.ativo=true).
  // ⚠️ NÃO reativa os animais que foram inativados junto na remoção (decisão de
  // produto) — cada um se reativa separadamente, na tela de Pacientes.
  reativar: async (req, res) => {
    const { id } = req.params;
    const { motivo } = req.body ?? {};

    if (!motivo?.trim()) {
      return res.status(400).json({ sucesso: false, mensagem: 'É obrigatório informar o motivo da reativação' });
    }
    if (!req.empresaId) {
      return res.status(403).json({ sucesso: false, mensagem: 'Operação requer contexto de empresa' });
    }

    try {
      const existe = await prisma.user.findFirst({ where: { id: Number(id), ...whereEhClienteDaEmpresa(req.empresaId) } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Proprietário não encontrado' });

      const equipeScope = await getEquipeScopeDoUsuario(req.user.id, req.empresaId, req.equipeId);
      const temAcesso = await verificarAcessoNoEscopo(Number(id), req.empresaId, equipeScope);
      if (!temAcesso) return res.status(403).json({ sucesso: false, mensagem: 'Este proprietário não pertence à sua empresa' });

      await prisma.$transaction(async (tx) => {
        const perfilAtualizado = await perfilProp.salvarPerfil(tx, Number(id), req.empresaId, { ativo: true });
        if (perfilAtualizado) {
          await registrarAtivacao(tx, 'proprietario', perfilAtualizado.id, req.user.id);
        }
        await registrarAuditoria(tx, req, {
          categoria:  'ALTERACAO',
          entidade:   'PROPRIETARIO',
          entidadeId: Number(id),
          motivo,
          detalhes:   `${existe.fullName ?? 'Proprietário'} reativado na empresa`,
        });
      });

      res.json({ sucesso: true, mensagem: 'Proprietário reativado.' });
    } catch (err) {
      console.error('Erro ao reativar proprietário:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao reativar proprietário' });
    }
  },
};

module.exports = ProprietarioController;

// Exportado para reuso por outros controllers (ex.: busca de proprietário por
// e-mail no cadastro de animal) — mantém um critério ÚNICO de escopo de empresa.
// Os dois andam SEMPRE juntos: um diz "é cliente", o outro "é cliente DAQUI".
module.exports.whereProprietarioNoEscopo = whereProprietarioNoEscopo;
module.exports.whereEhClienteDaEmpresa   = whereEhClienteDaEmpresa;
