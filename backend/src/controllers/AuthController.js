const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');

const prisma = new PrismaClient();
const SECRET = process.env.JWT_SECRET || 'equine-nutrition-super-2026';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const AuthController = {

  // ==================== REGISTRO NORMAL (seu código original) ====================
  register: async (req, res) => {
    const { fullName, email, phone, password, userType = 'PROPRIETARIO' } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios' });
    }

    try {
      const emailLower = email.trim().toLowerCase();

      const hashedPassword = await bcrypt.hash(password, 10);

      const user = await prisma.user.create({
        data: {
          fullName: fullName.trim(),
          email: emailLower,
          phone: phone || null,
          passwordHash: hashedPassword,
          role: 'USER',
          userType: userType,
        }
      });

      console.log(`✅ Novo usuário cadastrado: ${user.email}`);

      res.status(201).json({
        success: true,
        message: 'Cadastro realizado com sucesso!',
        user: { id: user.id, fullName: user.fullName, email: user.email }
      });

    } catch (error) {
      console.error('Erro no register:', error);
      if (error.code === 'P2002' && error.meta?.target?.includes('email')) {
        return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
      }
      res.status(500).json({ error: 'Erro interno ao cadastrar usuário' });
    }
  },

  // ==================== LOGIN COM GOOGLE (NOVO) ====================
  googleLogin: async (req, res) => {
    const { email, fullName, picture } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'E-mail é obrigatório' });
    }

    try {
      const emailLower = email.trim().toLowerCase();

      let user = await prisma.user.findUnique({
        where: { email: emailLower }
      });

      if (!user) {
        user = await prisma.user.create({
          data: {
            fullName: fullName || 'Usuário Google',
            email: emailLower,
            passwordHash: '',           // usuário Google não tem senha local
            role: 'USER',
            userType: 'PROPRIETARIO',
            ativo: true,
            // photoUrl: picture,
          }
        });
        console.log(`🆕 Novo usuário Google criado → ${user.email} (ID: ${user.id})`);
      } else {
        console.log(`✅ Usuário Google encontrado → ${user.email} (ID: ${user.id})`);
      }

      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        SECRET,
        { expiresIn: '7d' }
      );

      res.json({
        success: true,
        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          role: user.role,
          userType: user.userType
        },
        token
      });

    } catch (error) {
      console.error('Erro googleLogin:', error);
      res.status(500).json({ error: 'Erro ao fazer login com Google' });
    }
  },

  // ==================== ESQUECI MINHA SENHA (seu código original) ====================
  forgotPassword: async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'E-mail é obrigatório' });

      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() }
      });

      if (!user) return res.status(404).json({ error: 'E-mail não encontrado' });

      const resetToken = jwt.sign({ id: user.id }, SECRET, { expiresIn: '1h' });

      await prisma.user.update({
        where: { id: user.id },
        data: {
          resetPasswordToken: resetToken,
          resetPasswordExpires: new Date(Date.now() + 3600000),
        },
      });

      const resetLink = `http://localhost:5173/reset-password?token=${resetToken}`;

      await transporter.sendMail({
        from: `"Equipe Equine Nutrition" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Recuperação de Senha - Equine Nutrition Super',
        html: `
          <h2>Recupere sua senha</h2>
          <p>Clique no link abaixo para redefinir sua senha:</p>
          <a href="${resetLink}" style="background:#10b981;color:white;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;">Redefinir Senha</a>
          <p><small>O link é válido por 1 hora.</small></p>
        `,
      });

      res.json({ success: true, message: 'Link de recuperação enviado para o e-mail' });
    } catch (error) {
      console.error('Erro forgotPassword:', error);
      res.status(500).json({ error: 'Erro interno ao enviar link' });
    }
  },

  // ==================== REDEFINIR SENHA (seu código original) ====================
  resetPassword: async (req, res) => {
    try {
      const { token, newPassword } = req.body;

      const decoded = jwt.verify(token, SECRET);
      const user = await prisma.user.findUnique({ where: { id: decoded.id } });

      if (!user || user.resetPasswordToken !== token || new Date() > user.resetPasswordExpires) {
        return res.status(400).json({ error: 'Token inválido ou expirado' });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: hashedPassword,
          resetPasswordToken: null,
          resetPasswordExpires: null,
        },
      });

      res.json({ success: true, message: 'Senha alterada com sucesso' });
    } catch (err) {
      console.error('Erro resetPassword:', err);
      res.status(400).json({ error: 'Token inválido ou expirado' });
    }
  },
};

module.exports = AuthController;