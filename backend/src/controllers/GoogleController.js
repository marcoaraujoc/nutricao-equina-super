const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const https  = require('https');

const prisma = require('../lib/prisma').default;
const { setAuthCookies } = require('../lib/authCookies');
const { normalizeEmail, findUserByEmail } = require('../lib/email');
const SECRET = process.env.JWT_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || (SECRET + '_refresh');
const REFRESH_EXPIRES = '30d';

// Refresh token assinado (JWT) com expiração — validado em AuthController.refreshToken.
function generateRefreshToken(userId) {
  return jwt.sign(
    { id: userId, type: 'refresh', jti: crypto.randomBytes(16).toString('hex') },
    REFRESH_SECRET,
    { expiresIn: REFRESH_EXPIRES }
  );
}

function fetchGoogleUserInfo(accessToken) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.googleapis.com',
      path:     '/oauth2/v3/userinfo',
      method:   'GET',
      headers:  { Authorization: `Bearer ${accessToken}` },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) reject(new Error(parsed.error.message || 'Google userinfo error'));
          else resolve(parsed);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

const GoogleController = {
  login: async (req, res) => {
    try {
      const { access_token } = req.body;
      if (!access_token) {
        return res.status(400).json({ error: 'access_token do Google não fornecido' });
      }

      // Busca dados do usuário na API do Google
      let googleUser;
      try {
        googleUser = await fetchGoogleUserInfo(access_token);
      } catch (e) {
        return res.status(400).json({ error: 'Token Google inválido ou expirado' });
      }

      const email    = normalizeEmail(googleUser.email);
      const fullName = googleUser.name;

      if (!email) {
        return res.status(400).json({ error: 'E-mail não encontrado no token Google' });
      }

      // Busca case-insensitive antes de criar — evita duplicar conta existente em
      // maiúsculas (ex: "Karina@gmail.com"). Grava e-mail sempre normalizado.
      const existente = await findUserByEmail(prisma, email, { select: { id: true } });
      const user = existente
        ? await prisma.user.update({
            where: { id: existente.id },
            data:  { fullName: fullName || undefined },
          })
        : await prisma.user.create({
            data: {
              fullName: fullName || 'Usuário Google',
              email,
              passwordHash: '',
              userType: 'PROPRIETARIO',
              role: 'USER',
              ativo: true,
            },
          });

      if (user.ativo === false) {
        return res.status(403).json({ error: 'Conta desativada. Entre em contato com o administrador da equipe.' });
      }

      console.log(`✅ Usuário Google processado: ${user.email} (ID: ${user.id})`);

      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role, fullName: user.fullName, userType: user.userType },
        SECRET,
        { expiresIn: '24h' }
      );

      const refreshToken = generateRefreshToken(user.id);
      await prisma.user.update({
        where: { id: user.id },
        data:  { refreshToken },
      });

      // Cookies HttpOnly (consistente com o login por e-mail/senha)
      setAuthCookies(res, { accessToken: token, refreshToken });

      return res.json({
        success: true,
        token,
        refreshToken,
        user: {
          id:       user.id,
          fullName: user.fullName,
          email:    user.email,
          userType: user.userType,
        },
      });

    } catch (error) {
      console.error('Erro no login Google:', error);
      return res.status(500).json({ error: 'Erro interno ao processar login Google' });
    }
  },
};

module.exports = GoogleController;