const jwt    = require('jsonwebtoken');
const crypto = require('crypto');

const prisma = require('../lib/prisma').default;
const SECRET = process.env.JWT_SECRET;

function generateRefreshToken() {
  return crypto.randomBytes(48).toString('hex');
}

const GoogleController = {
  login: async (req, res) => {
    try {
      const { credential } = req.body;
      if (!credential) {
        return res.status(400).json({ error: 'Credential do Google não fornecido' });
      }

      // Decodifica o token Google
      const decoded = jwt.decode(credential);
      const { email, name: fullName } = decoded;

      if (!email) {
        return res.status(400).json({ error: 'E-mail não encontrado no token Google' });
      }

      // UPSERT: cria ou atualiza o usuário
      const user = await prisma.user.upsert({
        where: { email },
        update: {
          fullName: fullName || undefined,
        },
        create: {
          fullName: fullName || 'Usuário Google',
          email,
          passwordHash: '', 
          userType: 'PROPRIETARIO',
          role: 'USER',
          ativo: true,
        },
      });

      console.log(`✅ Usuário Google processado: ${user.email} (ID: ${user.id})`);

      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role, fullName: user.fullName, userType: user.userType },
        SECRET,
        { expiresIn: '24h' }
      );

      const refreshToken = generateRefreshToken();
      await prisma.user.update({
        where: { id: user.id },
        data:  { refreshToken },
      });

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