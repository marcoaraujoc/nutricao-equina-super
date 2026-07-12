const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const nodemailer = require('nodemailer');

const prisma = require('../lib/prisma').default;
const { setAuthCookies, clearAuthCookies, getRefreshTokenFromCookie } = require('../lib/authCookies');
const SECRET = process.env.JWT_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || (SECRET + '_refresh');
const REFRESH_EXPIRES = '30d';

// Refresh token assinado (JWT) com expiração. Continua salvo no banco para permitir
// rotação e revogação (logout / troca de senha). O jti aleatório garante unicidade
// mesmo para o mesmo usuário em momentos diferentes.
function generateRefreshToken(userId) {
  return jwt.sign(
    { id: userId, type: 'refresh', jti: crypto.randomBytes(16).toString('hex') },
    REFRESH_SECRET,
    { expiresIn: REFRESH_EXPIRES }
  );
}

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

  // NOTA: o login com Google é tratado por GoogleController.login (rota POST /api/auth/google),
  // que valida o access_token contra a API do Google antes de emitir o JWT. O antigo
  // AuthController.googleLogin (que confiava cegamente no e-mail do body — risco de account
  // takeover) foi removido por segurança. NÃO reintroduzir um login que confie em e-mail do body.

  // ==================== ESQUECI MINHA SENHA (seu código original) ====================
  forgotPassword: async (req, res) => {
    // Resposta SEMPRE genérica — nunca revela se o e-mail existe (evita enumeração de usuários).
    const respostaGenerica = {
      success: true,
      message: 'Se houver uma conta com este e-mail, enviaremos um link de recuperação.',
    };

    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'E-mail é obrigatório' });

      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() }
      });

      // E-mail inexistente: responde igual ao caso de sucesso, sem enviar nada.
      if (!user) return res.json(respostaGenerica);

      const resetToken = jwt.sign({ id: user.id }, SECRET, { expiresIn: '1h' });

      await prisma.user.update({
        where: { id: user.id },
        data: {
          resetPasswordToken: resetToken,
          resetPasswordExpires: new Date(Date.now() + 3600000),
        },
      });

      const resetLink = `${process.env.APP_URL || 'http://localhost:5173'}/#/reset-password?token=${resetToken}`;

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

      res.json(respostaGenerica);
    } catch (error) {
      console.error('Erro forgotPassword:', error);
      // Mesmo em erro interno, mantém a resposta genérica para não vazar sinal por timing/status.
      res.json(respostaGenerica);
    }
  },

  // ==================== REDEFINIR SENHA (seu código original) ====================
  resetPassword: async (req, res) => {
    try {
      const { token, newPassword } = req.body;

      // Defesa em profundidade (além do validator de rota): nunca aceita senha fraca.
      if (!newPassword || newPassword.length < 8) {
        return res.status(400).json({ error: 'A nova senha deve ter ao menos 8 caracteres' });
      }

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

  // ==================== REFRESH TOKEN ====================
  refreshToken: async (req, res) => {
    // Cookie HttpOnly tem prioridade; corpo é fallback (compat/clientes não-navegador)
    const refreshToken = getRefreshTokenFromCookie(req) || req.body?.refreshToken;
    if (!refreshToken) return res.status(401).json({ error: 'Refresh token não fornecido' });

    try {
      // Valida assinatura + expiração antes de tocar o banco. Tokens antigos (formato
      // legado sem expiração) falham aqui → cliente refaz login. Uma vez só.
      let payload;
      try {
        payload = jwt.verify(refreshToken, REFRESH_SECRET);
      } catch {
        return res.status(401).json({ error: 'Refresh token inválido ou expirado' });
      }

      const user = await prisma.user.findFirst({
        where: { refreshToken, ativo: true, id: payload.id },
        select: {
          id:       true,
          email:    true,
          fullName: true,
          role:     true,
          userType: true,
          mustChangePassword: true,
        },
      });

      if (!user) {
        return res.status(401).json({ error: 'Refresh token inválido ou expirado' });
      }

      const newAccessToken = jwt.sign(
        { id: user.id, email: user.email, role: user.role, fullName: user.fullName, userType: user.userType, mustChangePassword: user.mustChangePassword },
        SECRET,
        { expiresIn: '24h' }
      );

      // Rotação: gera novo refresh token a cada uso
      const newRefreshToken = generateRefreshToken(user.id);
      await prisma.user.update({
        where: { id: user.id },
        data:  { refreshToken: newRefreshToken },
      });

      // Renova os cookies HttpOnly (access + refresh rotacionado)
      setAuthCookies(res, { accessToken: newAccessToken, refreshToken: newRefreshToken });

      res.json({
        token:        newAccessToken,
        refreshToken: newRefreshToken,
        user: {
          id:                 user.id,
          fullName:           user.fullName,
          role:               user.role,
          userType:           user.userType,
          mustChangePassword: user.mustChangePassword,
        },
      });
    } catch (err) {
      console.error('Erro refreshToken:', err);
      res.status(500).json({ error: 'Erro interno ao renovar sessão' });
    }
  },

  // ==================== LOGOUT ====================
  logout: async (req, res) => {
    const refreshToken = getRefreshTokenFromCookie(req) || req.body?.refreshToken;
    if (refreshToken) {
      await prisma.user.updateMany({
        where: { refreshToken },
        data:  { refreshToken: null },
      }).catch(() => { /* silencioso — logout é best-effort */ });
    }
    clearAuthCookies(res);
    res.json({ success: true, message: 'Sessão encerrada' });
  },
};

module.exports = AuthController;