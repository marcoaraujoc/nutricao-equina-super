const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');

const prisma = require('../lib/prisma').default;
const { setAuthCookies, clearAuthCookies, getRefreshTokenFromCookie } = require('../lib/authCookies');
const { normalizeEmail, findUserByEmail } = require('../lib/email');
const { senhaReutilizada, registrarTrocaSenha, MENSAGEM_REUSO: MENSAGEM_SENHA_REUTILIZADA } = require('../services/passwordHistoryService');
const { podeAcessarSistema } = require('../lib/usuarioEmpresa');
const { registrarAcesso } = require('../lib/auditoria');
// Transporte de e-mail: provider ÚNICO (SMTP hoje, Resend por env). O remetente
// sai de `remetente()` — `EMAIL_USER` é credencial, não endereço de envio.
const { getEmailProvider, remetente } = require('../messaging/emailProvider');
// Duração da sessão e assinatura dos tokens: fonte única em lib/sessionTokens.js
const {
  SECRET, REFRESH_SECRET,
  assinarAccessToken, gerarRefreshToken: generateRefreshToken,
} = require('../lib/sessionTokens');

// 🔴 Este arquivo tinha um `nodemailer.createTransport({ service: 'gmail' })`
// PRÓPRIO — o único ponto do sistema que não passava por `messaging/emailProvider.js`.
// `service: 'gmail'` IGNORA `EMAIL_HOST`, então o "esqueci minha senha" continuaria
// batendo no Gmail depois de a instalação trocar para Brevo/SES/Resend: todo o
// resto enviaria normal e SÓ a recuperação de senha falharia com "Invalid login" —
// no fluxo em que a pessoa já está trancada para fora. Agora usa o provider único.

const AuthController = {

  // ==================== REGISTRO NORMAL (seu código original) ====================
  register: async (req, res) => {
    const { fullName, email, phone, password, userType = 'PROPRIETARIO' } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios' });
    }

    try {
      const emailLower = normalizeEmail(email);
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

      // Busca case-insensitive (funciona p/ cadastros antigos em maiúsculas)
      const user = await findUserByEmail(prisma, email);

      // 🔴 TEMPO DE RESPOSTA CONSTANTE — o caminho até a resposta é IDÊNTICO
      // exista ou não a conta. Só o `findUserByEmail` acima (que roda nos dois
      // casos) toca o banco antes de responder; TODO o resto — update do token e
      // envio do e-mail — vai para segundo plano.
      //
      // POR QUÊ: o sendMail síncrono (~5,5s) e o update do token (~300ms) só
      // rodavam quando o e-mail existia, então o tempo de resposta denunciava a
      // existência da conta (enumeração por timing), apesar da mensagem já ser
      // genérica. Agora "existe" e "não existe" respondem no mesmo tempo.
      //
      // Ordem preservada no background: PRIMEIRO persiste o token, DEPOIS envia o
      // link — senão o e-mail poderia chegar com um token ainda não gravado. Falha
      // (banco ou SMTP) é só logada: devolvê-la reintroduziria o sinal de existência.
      if (user) {
        const resetToken = jwt.sign({ id: user.id }, SECRET, { expiresIn: '1h' });
        const resetLink = `${process.env.APP_URL || 'http://localhost:5173'}/#/reset-password?token=${resetToken}`;
        (async () => {
          await prisma.user.update({
            where: { id: user.id },
            data: {
              resetPasswordToken: resetToken,
              resetPasswordExpires: new Date(Date.now() + 3600000),
            },
          });
          await getEmailProvider().enviar({
            from: remetente(),
            to: email,
            subject: 'Recuperação de Senha - Equine Nutrition Super',
            html: `
              <h2>Recupere sua senha</h2>
              <p>Clique no link abaixo para redefinir sua senha:</p>
              <a href="${resetLink}" style="background:#10b981;color:white;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;">Redefinir Senha</a>
              <p><small>O link é válido por 1 hora.</small></p>
            `,
          });
        })().catch(err => console.error('Erro ao processar recuperação de senha:', err?.message || err));
      }

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

      if (await senhaReutilizada(user.id, newPassword, user.passwordHash)) {
        return res.status(400).json({ error: MENSAGEM_SENHA_REUTILIZADA });
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
      await registrarTrocaSenha(user.id, user.passwordHash);

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
          // Refresh NÃO é login novo (mesmo dispositivo continuando a sessão) —
          // o token reemitido carrega a MESMA versão, sem incrementar.
          sessionVersion: true,
        },
      });

      if (!user) {
        return res.status(401).json({ error: 'Refresh token inválido ou expirado' });
      }

      // Acesso revogado depois do login: a sessão morre no próximo refresh em vez de
      // sobreviver até o access token expirar.
      const ehAdminPlataforma = user.role === 'ADMIN' || user.userType === 'ADMIN';
      if (!ehAdminPlataforma && !(await podeAcessarSistema(user.id))) {
        return res.status(403).json({ error: 'Seu acesso ao sistema está desativado. Fale com o gestor da clínica.' });
      }

      const newAccessToken = assinarAccessToken(user);

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
      // Descobre QUEM está saindo antes de invalidar o token — depois do update não há
      // mais como identificar a sessão. É o servidor dizendo quem saiu; antes disso, a
      // trilha de LOGOUT vinha do frontend por uma rota pública que aceitava qualquer
      // usuário no corpo (ver `registrarAcesso` em lib/auditoria.js).
      const dono = await prisma.user.findFirst({
        where:  { refreshToken },
        select: { id: true, fullName: true, email: true },
      }).catch(() => null);

      await prisma.user.updateMany({
        where: { refreshToken },
        data:  { refreshToken: null },
      }).catch(() => { /* silencioso — logout é best-effort */ });

      if (dono) await registrarAcesso(req, dono, 'LOGOUT');
    }
    clearAuthCookies(res);
    res.json({ success: true, message: 'Sessão encerrada' });
  },
};

module.exports = AuthController;