// backend/src/controllers/UserController.js
'use strict';

const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const prisma = require('../lib/prisma').default;

// Remove zeros à esquerda do número CRMV, mantém a UF
// Ex: "00123/SP" → "123/SP" | "13557/RJ" → "13557/RJ"
const normalizarCRMV = (v) => {
  const parts = v.trim().toUpperCase().split('/');
  if (parts.length !== 2) return v.trim().toUpperCase();
  const [num, uf] = parts;
  return `${parseInt(num, 10)}/${uf}`;
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
              especies: { select: { especieId: true } },
            },
          },
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

      const { vetPerfil, ...userData } = user;
      return res.status(200).json({
        ...userData,
        isConvidado,
        cargoEquipe: membroEquipe?.cargo ?? null,
        crmv:              vetPerfil?.crmv ?? null,
        especiesAtendidas: vetPerfil?.especies.map(e => e.especieId) ?? [],
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

      // Convidados não podem alterar o userType atribuído pela equipe.
      // Cadastros diretos só permitem PROPRIETARIO ou VETERINARIO.
      let effectiveUserType = undefined;
      if (userType) {
        if (isConvidado) {
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
        { expiresIn: '7d' }
      );

      return res.status(200).json({
        success: true,
        message: 'Cadastro pessoal salvo com sucesso!',
        user:    updatedUser,
        token:   novoToken, // ← novo token com userType atualizado
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

  buscarProprietarioPorEmail: async (req, res) => {
    const email = (req.query.email ?? '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'E-mail obrigatório' });
    try {
      const user = await prisma.user.findUnique({
        where:  { email },
        select: { fullName: true, phone: true },
      });
      if (!user) return res.json({ encontrado: false });
      return res.json({ encontrado: true, fullName: user.fullName, phone: user.phone ?? '' });
    } catch (err) {
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

      const hash = await bcrypt.hash(novaSenha, 10);

      await prisma.user.update({
        where: { email: req.user.email },
        data:  { passwordHash: hash, mustChangePassword: false },
      });

      return res.json({ sucesso: true, mensagem: 'Senha alterada com sucesso' });
    } catch (error) {
      console.error('Erro em alterarSenha:', error);
      return res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

};

module.exports = UserController;