// backend/src/controllers/UserController.js
'use strict';

const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const prisma = require('../lib/prisma').default;
const { setAuthCookies } = require('../lib/authCookies');
const { normalizeEmail, findUserByEmail } = require('../lib/email');
const { getEquipeScopeDoUsuario } = require('../lib/vetUtils');
const { whereProprietarioNoEscopo } = require('./ProprietarioController');
const { parseLocaisTrabalho, gravarLocaisTrabalho, csvParaIds, validarLocaisContraExpedienteEmpresa } = require('./EquipeController');
const {
  salvarPerfil: salvarPerfilProprietario,
  aplicarPerfil: aplicarPerfilProprietario,
} = require('../lib/proprietarioPerfil');
const { senhaReutilizada, registrarTrocaSenha, MENSAGEM_REUSO: MENSAGEM_SENHA_REUTILIZADA } = require('../services/passwordHistoryService');

// Remove zeros à esquerda do número CRMV, mantém a UF
// Ex: "00123/SP" → "123/SP" | "13557/RJ" → "13557/RJ"
const normalizarCRMV = (v) => {
  const parts = v.trim().toUpperCase().split('/');
  if (parts.length !== 2) return v.trim().toUpperCase();
  const [num, uf] = parts;
  return `${parseInt(num, 10)}/${uf}`;
};

// Valida/normaliza o expediente de atendimento (dias 0-6 CSV + HH:MM).
// Cada campo: undefined = não altera; ''/[] = limpa (herda o da empresa).
const parseExpedienteBody = (body) => {
  let dias;
  if (body.diasTrabalho !== undefined) {
    const arr = Array.isArray(body.diasTrabalho)
      ? body.diasTrabalho
      : String(body.diasTrabalho).split(',').map(s => s.trim()).filter(Boolean);
    if (arr.length === 0) dias = null;
    else {
      const nums = [...new Set(arr.map(Number))].sort((a, b) => a - b);
      if (nums.some(n => !Number.isInteger(n) || n < 0 || n > 6)) return { erro: 'Dias de atendimento inválidos (0=Dom … 6=Sáb).' };
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
  if (hi === '__ERRO__' || hf === '__ERRO__') return { erro: 'Horário de atendimento inválido — use HH:MM.' };
  if (hi && hf && hi >= hf) return { erro: 'A hora de início do atendimento deve ser menor que a de término.' };
  return { diasTrabalho: dias, horaInicioTrabalho: hi, horaFimTrabalho: hf };
};

// Resolve o MembroEquipe do CONTEXTO ATIVO: equipe selecionada > equipe dentro da
// empresa ativa > primeiro vínculo do usuário. Assim o expediente editado/exibido é
// sempre o da empresa/equipe em que o usuário está trabalhando (não um vínculo aleatório).
const resolverMembroDoContexto = async (userId, req) => {
  if (req.equipeId) {
    const m = await prisma.membroEquipe.findFirst({ where: { userId, equipeId: Number(req.equipeId) }, select: { id: true } });
    if (m) return m;
  }
  if (req.empresaId) {
    const m = await prisma.membroEquipe.findFirst({
      where:   { userId, equipe: { empresaId: Number(req.empresaId) } },
      orderBy: { createdAt: 'desc' },
      select:  { id: true },
    });
    if (m) return m;
  }
  return prisma.membroEquipe.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' }, select: { id: true } });
};

const UserController = {

  /**
   * GET /api/users/me
   * Busca os dados do usuário usando o e-mail do token JWT
   */
  getMe: async (req, res) => {
    try {
      const { email } = req.user;

      const user = await prisma.user.findUnique({
        where: { email },
        select: {
          id:                 true,
          fullName:           true,
          email:              true,
          phone:              true,
          role:               true,
          userType:           true,
          mustChangePassword: true,
          cep:         true,
          endereco:    true,
          complemento: true,
          bairro:      true,
          cidade:      true,
          estado:      true,
          createdAt:   true,
          ativo:       true,
          vetPerfil: {
            select: {
              crmv:    true,
              especies:          { select: { especieId: true } },
              subespecialidades: { select: { nome: true } },
            },
          },
          especialidades: { select: { especialidadeId: true } },
        },
      });

      if (!user) {
        return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
      }

      // isConvidado via SQL raw — campo novo, ainda pode não estar no cliente Prisma gerado
      let isConvidado = false;
      try {
        const rows = await prisma.$queryRawUnsafe(
          `SELECT "isConvidado" FROM schs2vet.users WHERE id = $1`,
          user.id,
        );
        isConvidado = rows[0]?.isConvidado ?? false;
      } catch { /* campo ainda não existe no DB legado — ignora */ }

      // Convite pendente (onboarding de convidado)
      const convitePendente = await prisma.conviteEquipe.findFirst({
        where:   { email: user.email, status: 'PENDENTE', expiresAt: { gt: new Date() } },
        include: { equipe: { select: { nome: true } } },
        orderBy: { createdAt: 'desc' },
      });

      // Cargo na equipe (ex: GESTOR) — definido na inclusão do membro
      const membroEquipe = await prisma.membroEquipe.findFirst({
        where:   { userId: user.id },
        select:  { cargo: true },
        orderBy: { createdAt: 'asc' },
      });

      // Expediente de atendimento do profissional. Lê o do vínculo do contexto; se vazio,
      // herda o que o profissional definiu em qualquer vínculo (mais recente).
      let expediente = { diasTrabalho: null, horaInicioTrabalho: null, horaFimTrabalho: null };
      const membroExp = await resolverMembroDoContexto(user.id, req);
      try {
        if (membroExp) {
          const rows = await prisma.$queryRawUnsafe(
            `SELECT "diasTrabalho","horaInicioTrabalho","horaFimTrabalho" FROM schs2vet.tb_membros_equipe WHERE id=$1`,
            membroExp.id,
          );
          if (rows[0]) expediente = rows[0];
        }
        if (!expediente.diasTrabalho && !expediente.horaInicioTrabalho && !expediente.horaFimTrabalho) {
          const rows = await prisma.$queryRawUnsafe(
            `SELECT "diasTrabalho","horaInicioTrabalho","horaFimTrabalho" FROM schs2vet.tb_membros_equipe
              WHERE "userId"=$1 AND ("diasTrabalho" IS NOT NULL OR "horaInicioTrabalho" IS NOT NULL OR "horaFimTrabalho" IS NOT NULL)
              ORDER BY id DESC LIMIT 1`,
            user.id,
          );
          if (rows[0]) expediente = rows[0];
        }
      } catch { /* colunas ainda não migradas — ignora */ }

      // Locais de trabalho já cadastrados (pelo gestor, ao incluir o membro, ou pelo
      // próprio profissional) — o Cadastro Pessoal abre com eles preenchidos.
      let locaisTrabalho = [];
      if (membroExp) {
        const rows = await prisma.membroLocalTrabalho.findMany({
          where:   { membroEquipeId: membroExp.id },
          include: { localizacao: { select: { id: true, nome: true } } },
          orderBy: { id: 'asc' },
        });
        locaisTrabalho = rows.map(r => ({
          localizacaoId:      r.localizacaoId,
          localizacaoNome:    r.localizacao?.nome ?? null,
          diasTrabalho:       r.diasTrabalho,
          horaInicioTrabalho: r.horaInicioTrabalho,
          horaFimTrabalho:    r.horaFimTrabalho,
          especialidadeIds:   csvParaIds(r.especialidadesIds),
        }));
      }

      const { vetPerfil, especialidades, ...userBruto } = user;
      // PROPRIETÁRIO: mostra o cadastro da EMPRESA ATIVA (cada clínica mantém o seu)
      const userData = userBruto.userType === 'PROPRIETARIO'
        ? await aplicarPerfilProprietario(userBruto, req.empresaId)
        : userBruto;
      return res.status(200).json({
        ...userData,
        isConvidado,
        cargoEquipe: membroEquipe?.cargo ?? null,
        temEquipe:   !!membroExp,
        diasTrabalho:       expediente.diasTrabalho,
        horaInicioTrabalho: expediente.horaInicioTrabalho,
        horaFimTrabalho:    expediente.horaFimTrabalho,
        locaisTrabalho,
        crmv:              vetPerfil?.crmv ?? null,
        especiesAtendidas: vetPerfil?.especies.map(e => e.especieId) ?? [],
        subespecialidades: vetPerfil?.subespecialidades.map(s => s.nome) ?? [],
        especialidadeIds:  especialidades?.map(e => e.especialidadeId) ?? [],
        profileComplete:   !!(user.phone && user.fullName && user.fullName.trim()),
        pendingInvite:     convitePendente
          ? { id: convitePendente.id, cargo: convitePendente.cargo, equipeNome: convitePendente.equipe?.nome ?? '' }
          : null,
      });

    } catch (error) {
      console.error('Erro em getMe:', error);
      return res.status(500).json({ success: false, error: 'Erro interno ao buscar usuário' });
    }
  },

  /**
   * PUT /api/users/me
   * Atualiza o cadastro pessoal usando o e-mail do token
   * Se for veterinário, salva também CRMV e espécies atendidas no VetPerfil
   */
  updateMe: async (req, res) => {
    try {
      const { email } = req.user;

      const {
        fullName,
        phone,
        cep,
        endereco,
        complemento,
        bairro,
        cidade,
        estado,
        userType,
        crmv,
        especiesAtendidas,
        subespecialidades,
        especialidadeIds,
        diasTrabalho,
        horaInicioTrabalho,
        horaFimTrabalho,
        locaisTrabalho,
      } = req.body;

      // Determina se é usuário convidado (userType foi definido pelo convite)
      let isConvidado = false;
      try {
        const rows = await prisma.$queryRawUnsafe(
          `SELECT "isConvidado" FROM schs2vet.users WHERE email = $1`,
          email,
        );
        isConvidado = rows[0]?.isConvidado ?? false;
      } catch { /* coluna ainda não existe no DB legado */ }

      // Convidados não podem alterar o userType atribuído pela equipe — EXCETO
      // quando assinaram a aplicação (donos de empresa própria): ex. fornecedora
      // convidada que virou gestora e se declara Médica Veterinária.
      // Cadastros diretos só permitem PROPRIETARIO ou VETERINARIO.
      let effectiveUserType = undefined;
      if (userType) {
        let podeAlterarTipo = !isConvidado;
        if (isConvidado) {
          const [donoDeEmpresa, gestorDeEquipe] = await Promise.all([
            prisma.empresa.findFirst({
              where:  { ownerId: Number(req.user.id) },
              select: { id: true },
            }),
            prisma.membroEquipe.findFirst({
              where:  { userId: Number(req.user.id), cargo: 'GESTOR' },
              select: { id: true },
            }),
          ]);
          podeAlterarTipo = !!donoDeEmpresa || !!gestorDeEquipe;
        }

        if (!podeAlterarTipo) {
          effectiveUserType = undefined; // mantém o que foi definido pelo convite
        } else {
          const TIPOS_PERMITIDOS = ['PROPRIETARIO', 'VETERINARIO'];
          if (!TIPOS_PERMITIDOS.includes(userType)) {
            return res.status(400).json({
              success: false,
              error: 'Tipo de usuário inválido. Apenas Proprietário e Médico Veterinário estão disponíveis para cadastro direto.',
            });
          }
          effectiveUserType = userType;
        }
      }

      const updatedUser = await prisma.user.update({
        where: { email },
        data: {
          fullName:    fullName    || undefined,
          phone:       phone       || undefined,
          cep:         cep         || undefined,
          endereco:    endereco    || undefined,
          complemento: complemento || undefined,
          bairro:      bairro      || undefined,
          cidade:      cidade      || undefined,
          estado:      estado      || undefined,
          userType:    effectiveUserType,
        },
      });

      // PROPRIETÁRIO editando os próprios dados: reflete no cadastro que a EMPRESA
      // ATIVA mantém dele (é esse o cadastro que a clínica enxerga). Sem contexto de
      // empresa, fica só no User — as clínicas seguem com os cadastros delas.
      if (updatedUser.userType === 'PROPRIETARIO' && req.empresaId) {
        await salvarPerfilProprietario(prisma, updatedUser.id, req.empresaId, {
          ...(fullName    !== undefined ? { fullName }    : {}),
          ...(phone       !== undefined ? { phone }       : {}),
          ...(cep         !== undefined ? { cep }         : {}),
          ...(endereco    !== undefined ? { endereco }    : {}),
          ...(complemento !== undefined ? { complemento } : {}),
          ...(bairro      !== undefined ? { bairro }      : {}),
          ...(cidade      !== undefined ? { cidade }      : {}),
          ...(estado      !== undefined ? { estado }      : {}),
        });
      }

      // Salvar dados do veterinário
      if (userType === 'VETERINARIO' && crmv !== undefined) {
        const crmvNormalizado = normalizarCRMV(crmv);

        const vetPerfil = await prisma.vetPerfil.upsert({
          where:  { userId: updatedUser.id },
          create: { userId: updatedUser.id, crmv: crmvNormalizado },
          update: { crmv: crmvNormalizado },
        });

        // Recria lista de espécies (delete + insert)
        if (Array.isArray(especiesAtendidas)) {
          await prisma.vetEspecie.deleteMany({
            where: { vetPerfilId: vetPerfil.id },
          });

          if (especiesAtendidas.length > 0) {
            await prisma.vetEspecie.createMany({
              data: especiesAtendidas.map(eid => ({
                vetPerfilId: vetPerfil.id,
                especieId:   Number(eid),
              })),
              skipDuplicates: true,
            });
          }
        }

        // Recria lista de subespecialidades (delete + insert)
        if (Array.isArray(subespecialidades)) {
          await prisma.vetSubespecialidade.deleteMany({
            where: { vetPerfilId: vetPerfil.id },
          });
          if (subespecialidades.length > 0) {
            await prisma.vetSubespecialidade.createMany({
              data: subespecialidades.map(nome => ({
                vetPerfilId: vetPerfil.id,
                nome:        String(nome).slice(0, 100),
              })),
              skipDuplicates: true,
            });
          }
        }
      }

      // Expediente de atendimento (dias/horários) — "o MEU horário": grava em TODOS os
      // vínculos do profissional, para valer em qualquer empresa/equipe/agenda.
      if (diasTrabalho !== undefined || horaInicioTrabalho !== undefined || horaFimTrabalho !== undefined) {
        const exp = parseExpedienteBody({ diasTrabalho, horaInicioTrabalho, horaFimTrabalho });
        if (exp.erro) return res.status(400).json({ success: false, error: exp.erro });
        const sets = [], vals = [];
        let i = 1;
        if (exp.diasTrabalho       !== undefined) { sets.push(`"diasTrabalho"=$${i++}`);       vals.push(exp.diasTrabalho); }
        if (exp.horaInicioTrabalho !== undefined) { sets.push(`"horaInicioTrabalho"=$${i++}`); vals.push(exp.horaInicioTrabalho); }
        if (exp.horaFimTrabalho    !== undefined) { sets.push(`"horaFimTrabalho"=$${i++}`);    vals.push(exp.horaFimTrabalho); }
        if (sets.length > 0) {
          vals.push(updatedUser.id);
          await prisma.$executeRawUnsafe(`UPDATE schs2vet.tb_membros_equipe SET ${sets.join(', ')} WHERE "userId"=$${i}`, ...vals);
        }
      }

      // Locais de trabalho (local + dias + horário). Diferente do expediente único,
      // ficam no vínculo do CONTEXTO ATIVO — a localização pertence à empresa. Usa o
      // mesmo parser da tela de Equipe, então a regra de horários que não podem
      // coincidir vale igual aqui.
      if (locaisTrabalho !== undefined) {
        const { locais, erro } = parseLocaisTrabalho({ locaisTrabalho });
        if (erro) return res.status(400).json({ success: false, error: erro });
        // Todo membro fica restrito ao dia/horário da empresa (EmpresaConfiguracao)
        const erroExp = await validarLocaisContraExpedienteEmpresa(req, locais);
        if (erroExp) return res.status(400).json({ success: false, error: erroExp });
        const membroCtx = await resolverMembroDoContexto(updatedUser.id, req);
        if (membroCtx) await gravarLocaisTrabalho(prisma, membroCtx.id, locais);
      }

      // Especialidades (catálogo por espécie) — fonte única para VET e FORNECEDOR.
      // Recria o vínculo do usuário (delete + insert). Array vazio = limpa.
      if (Array.isArray(especialidadeIds)) {
        const ids = [...new Set(especialidadeIds.map(Number))].filter(Number.isInteger);
        await prisma.usuarioEspecialidade.deleteMany({ where: { userId: updatedUser.id } });
        if (ids.length > 0) {
          await prisma.usuarioEspecialidade.createMany({
            data: ids.map(especialidadeId => ({ userId: updatedUser.id, especialidadeId })),
            skipDuplicates: true,
          });
        }
      }

      console.log('✅ Cadastro Pessoal atualizado - Email:', email);

      const novoToken = jwt.sign(
        {
          id:       updatedUser.id,
          email:    updatedUser.email,
          fullName: updatedUser.fullName,
          role:     updatedUser.role,
          userType: updatedUser.userType, // ← agora correto
        },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );

      // Atualiza o cookie HttpOnly de acesso com o token que reflete o novo userType
      setAuthCookies(res, { accessToken: novoToken });

      return res.status(200).json({
        success: true,
        message: 'Cadastro pessoal salvo com sucesso!',
        user:    updatedUser,
        token:   novoToken, // ← novo token com userType atualizado (compat)
      });

    } catch (error) {
      console.error('Erro ao atualizar cadastro pessoal:', error);

      // CRMV duplicado
      if (error.code === 'P2002' && error.meta?.target?.includes('crmv')) {
        return res.status(409).json({
          success: false,
          error: 'Este CRMV já está cadastrado no sistema.',
        });
      }

      return res.status(500).json({
        success: false,
        error: 'Erro interno ao salvar cadastro pessoal',
      });
    }
  },

  // Busca de proprietário por e-mail para o cadastro de animal.
  // ESCOPADA À EMPRESA ATIVA: o proprietário só é considerado "encontrado" quando
  // já pertence ao escopo de quem está consultando (mesmo critério da listagem de
  // proprietários). Cliente cadastrado em OUTRA empresa não é devolvido — o vet
  // preenche os dados do zero, e cada empresa mantém os seus próprios, do mesmo
  // jeito que o animal é isolado por empresa.
  buscarProprietarioPorEmail: async (req, res) => {
    const email = normalizeEmail(req.query.email);
    if (!email) return res.status(400).json({ error: 'E-mail obrigatório' });
    try {
      const user = await findUserByEmail(prisma, email, {
        select: { id: true, fullName: true, phone: true, userType: true },
      });
      if (!user) return res.json({ encontrado: false });

      // ADMIN global enxerga qualquer proprietário
      if (req.user?.role !== 'ADMIN') {
        if (!req.empresaId) return res.json({ encontrado: false });
        const equipeScope = await getEquipeScopeDoUsuario(req.user.id, req.empresaId, req.equipeId);
        const noEscopo = await prisma.user.findFirst({
          where:  { id: user.id, ...whereProprietarioNoEscopo(req.empresaId, equipeScope) },
          select: { id: true },
        });
        if (!noEscopo) return res.json({ encontrado: false });
      }

      return res.json({ encontrado: true, fullName: user.fullName, phone: user.phone ?? '' });
    } catch (err) {
      console.error('[UserController.buscarProprietarioPorEmail]', err);
      return res.status(500).json({ error: 'Erro interno' });
    }
  },

alterarSenha: async (req, res) => {
    const { senhaAtual, novaSenha } = req.body;

    if (!novaSenha || novaSenha.length < 8) {
      return res.status(400).json({ sucesso: false, mensagem: 'A senha deve ter ao menos 8 caracteres' });
    }
    if (!/[A-Z]/.test(novaSenha)) {
      return res.status(400).json({ sucesso: false, mensagem: 'A senha deve ter ao menos uma letra maiúscula' });
    }
    if (!/[0-9]/.test(novaSenha)) {
      return res.status(400).json({ sucesso: false, mensagem: 'A senha deve ter ao menos 1 número' });
    }
    if (!/[^A-Za-z0-9]/.test(novaSenha)) {
      return res.status(400).json({ sucesso: false, mensagem: 'A senha deve ter ao menos 1 caractere especial' });
    }

    try {
      const user = await prisma.user.findUnique({
        where:  { email: req.user.email },
        select: { passwordHash: true, mustChangePassword: true },
      });

      if (!user) {
        return res.status(404).json({ sucesso: false, mensagem: 'Usuário não encontrado' });
      }

      // Troca obrigatória: dispensa senhaAtual se DB, JWT ou flag explícita indicarem.
      // req.body.obrigatoria=true é enviado por AlterarSenhaObrigatoria (fluxo de 1º login);
      // cobre o caso em que o JWT foi renovado sem mustChangePassword ou o DB já foi atualizado
      // por um PATCH anterior bem-sucedido mas cujo refreshUser subsequente falhou.
      const isObrigatoria = !!user.mustChangePassword || !!req.user.mustChangePassword || req.body.obrigatoria === true;
      if (!isObrigatoria) {
        if (!senhaAtual) {
          return res.status(400).json({ sucesso: false, mensagem: 'Senha atual é obrigatória' });
        }
        const valida = await bcrypt.compare(senhaAtual, user.passwordHash);
        if (!valida) {
          return res.status(401).json({ sucesso: false, mensagem: 'Senha atual incorreta' });
        }
      }

      if (await senhaReutilizada(req.user.id, novaSenha, user.passwordHash)) {
        return res.status(400).json({ sucesso: false, mensagem: MENSAGEM_SENHA_REUTILIZADA });
      }

      const hash = await bcrypt.hash(novaSenha, 10);

      await prisma.user.update({
        where: { email: req.user.email },
        data:  { passwordHash: hash, mustChangePassword: false },
      });
      await registrarTrocaSenha(req.user.id, user.passwordHash);

      return res.json({ sucesso: true, mensagem: 'Senha alterada com sucesso' });
    } catch (error) {
      console.error('Erro em alterarSenha:', error);
      return res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

};

module.exports = UserController;