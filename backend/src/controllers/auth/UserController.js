'use strict';

const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');

const prisma = require('../../lib/prisma').default;
const SECRET          = process.env.JWT_SECRET;
const REFRESH_SECRET  = process.env.JWT_REFRESH_SECRET || (SECRET + '_refresh');

function generateRefreshToken() {
  return crypto.randomBytes(48).toString('hex');
}

class UserController {

  async register(req, res) {
    console.log('📥 [Register] Recebido:', req.body);
    const { fullName, email, password, phone, userType = 'PROPRIETARIO' } = req.body;

    try {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) return res.status(400).json({ error: 'E-mail já cadastrado' });

      const passwordHash = await bcrypt.hash(password, 10);

      const user = await prisma.user.create({
        data: { fullName, email, passwordHash, phone, role: 'USER', userType },
      });

      console.log('✅ Usuário cadastrado! ID:', user.id);
      res.status(201).json({ message: 'Usuário cadastrado com sucesso!', userId: user.id });
    } catch (err) {
      console.error('❌ Erro register:', err);
      res.status(500).json({ error: 'Erro interno' });
    }
  }

  async login(req, res) {
    const { email, password } = req.body;
    console.log('📥 [Login] Tentativa:', { email });

    try {
      const user = await prisma.user.findUnique({
        where:  { email },
        select: {
          id:                 true,
          email:              true,
          fullName:           true,
          role:               true,
          userType:           true,
          passwordHash:       true,
          mustChangePassword: true, // ← NOVO
        },
      });

      if (!user) {
        console.log('❌ Usuário não encontrado');
        return res.status(401).json({ error: 'Credenciais inválidas' });
      }

      const match = await bcrypt.compare(password, user.passwordHash);
      if (!match) return res.status(401).json({ error: 'Credenciais inválidas' });

      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role, fullName: user.fullName },
        SECRET,
        { expiresIn: '24h' }
      );

      const refreshToken = generateRefreshToken();
      await prisma.user.update({
        where: { id: user.id },
        data:  { refreshToken },
      });

      console.log('✅ Login bem-sucedido!');
      res.json({
        token,
        refreshToken,
        user: {
          id:                 user.id,
          fullName:           user.fullName,
          role:               user.role,
          userType:           user.userType,
          mustChangePassword: user.mustChangePassword,
        },
      });
    } catch (err) {
      console.error('❌ Erro login:', err);
      res.status(500).json({ error: 'Erro interno no login' });
    }
  }

  // ── GET /api/users/me ─────────────────────────────────────────────────────
  async me(req, res) {
    try {
      const user = await prisma.user.findUnique({
        where:  { id: Number(req.user.id) },
        select: {
          id:                 true,
          email:              true,
          fullName:           true,
          role:               true,
          userType:           true,
          phone:              true,
          photoUrl:           true,
          mustChangePassword: true, // ← NOVO
        },
      });
      if (!user) return res.status(404).json({ sucesso: false, mensagem: 'Usuário não encontrado' });
      res.json({ sucesso: true, ...user });
    } catch (err) {
      console.error('❌ Erro me:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  }

  // ── PATCH /api/users/me/senha ─────────────────────────────────────────────
  async alterarSenha(req, res) {
    const { senhaAtual, novaSenha } = req.body;

    if (!novaSenha || novaSenha.length < 8) {
      return res.status(400).json({ sucesso: false, mensagem: 'A nova senha deve ter ao menos 8 caracteres' });
    }

    try {
      const user = await prisma.user.findUnique({
        where:  { id: Number(req.user.id) },
        select: { passwordHash: true, mustChangePassword: true },
      });

      if (!user) return res.status(404).json({ sucesso: false, mensagem: 'Usuário não encontrado' });

      // Troca voluntária exige senha atual; troca obrigatória (primeiro login), não
      if (!user.mustChangePassword) {
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
        where: { id: Number(req.user.id) },
        data:  { passwordHash: hash, mustChangePassword: false },
      });

      res.json({ sucesso: true, mensagem: 'Senha alterada com sucesso' });
    } catch (err) {
      console.error('❌ Erro alterarSenha:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  }
}

module.exports = new UserController();