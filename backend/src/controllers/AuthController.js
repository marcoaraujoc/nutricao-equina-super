const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const prisma = new PrismaClient();
const SECRET = process.env.JWT_SECRET || 'equine-nutrition-super-2026';

// Configuração do Nodemailer (configure no .env)
const transporter = nodemailer.createTransport({
  service: 'gmail', // ou use SendGrid, Outlook, etc.
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const AuthController = {
  // ==================== SEUS MÉTODOS EXISTENTES (login, register, google, etc.) ====================
  // (mantenha aqui todos os métodos que já existiam no seu arquivo)

  // ==================== ESQUECI MINHA SENHA ====================
  forgotPassword: async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'E-mail é obrigatório' });

      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() }
      });

      if (!user) {
        return res.status(404).json({ error: 'E-mail não encontrado' });
      }

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

      console.log(`📧 E-mail de recuperação enviado para: ${email}`);

      res.json({ success: true, message: 'Link de recuperação enviado para o e-mail' });
    } catch (error) {
      console.error('Erro forgotPassword:', error);
      res.status(500).json({ error: 'Erro interno ao enviar link' });
    }
  },

  // ==================== REDEFINIR SENHA ====================
    // ==================== REDEFINIR SENHA (com hash bcrypt) ====================
  resetPassword: async (req, res) => {
    try {
      const { token, newPassword } = req.body;

      const decoded = jwt.verify(token, SECRET);
      const user = await prisma.user.findUnique({ where: { id: decoded.id } });

      if (!user || user.resetPasswordToken !== token || new Date() > user.resetPasswordExpires) {
        return res.status(400).json({ error: 'Token inválido ou expirado' });
      }

      // Hash da senha (igual ao cadastro normal)
      const bcrypt = require('bcryptjs');
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: hashedPassword,           // ← agora com hash
          resetPasswordToken: null,
          resetPasswordExpires: null,
        },
      });

      console.log(`✅ Senha redefinida com hash para usuário ID: ${user.id}`);

      res.json({ success: true, message: 'Senha alterada com sucesso' });
    } catch (err) {
      console.error('Erro resetPassword:', err);
      res.status(400).json({ error: 'Token inválido ou expirado' });
    }
  },
};

module.exports = AuthController;