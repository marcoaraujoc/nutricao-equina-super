// backend/src/controllers/UserController.js
'use strict';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

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
          mustChangePassword: true, // ← NOVO
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
              especies: {
                select: { especieId: true },
              },
            },
          },
        },
      });

      if (!user) {
        return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
      }

      const { vetPerfil, ...userData } = user;
      return res.status(200).json({
        ...userData,
        crmv:              vetPerfil?.crmv ?? null,
        especiesAtendidas: vetPerfil?.especies.map(e => e.especieId) ?? [],
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
          userType:    userType    || undefined,
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

      const jwt = require('jsonwebtoken');
      const novoToken = jwt.sign(
        {
          id:       updatedUser.id,
          email:    updatedUser.email,
          fullName: updatedUser.fullName,
          role:     updatedUser.role,
          userType: updatedUser.userType, // ← agora correto
        },
        process.env.JWT_SECRET || 'fallback-dev-only',
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

alterarSenha: async (req, res) => {
    const { senhaAtual, novaSenha } = req.body;

    if (!novaSenha || novaSenha.length < 8) {
      return res.status(400).json({ sucesso: false, mensagem: 'A nova senha deve ter ao menos 8 caracteres' });
    }

    try {
      const user = await prisma.user.findUnique({
        where:  { id: Number(req.user.id) },
        select: { passwordHash: true, mustChangePassword: true },
      });

      if (!user) {
        return res.status(404).json({ sucesso: false, mensagem: 'Usuário não encontrado' });
      }

      // Troca voluntária exige senha atual; troca obrigatória (primeiro login) não
      if (!user.mustChangePassword) {
        if (!senhaAtual) {
          return res.status(400).json({ sucesso: false, mensagem: 'Senha atual é obrigatória' });
        }
        const bcrypt = require('bcryptjs');
        const valida = await bcrypt.compare(senhaAtual, user.passwordHash);
        if (!valida) {
          return res.status(401).json({ sucesso: false, mensagem: 'Senha atual incorreta' });
        }
      }

      const bcrypt = require('bcryptjs');
      const hash   = await bcrypt.hash(novaSenha, 10);

      await prisma.user.update({
        where: { id: Number(req.user.id) },
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