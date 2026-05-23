const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');

const prisma = new PrismaClient();
const SECRET = process.env.JWT_SECRET;

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

      // Gera token JWT
      const token = jwt.sign(
        { id: user.id, email: user.email, userType: user.userType },
        SECRET,
        { expiresIn: '7d' }
      );

      return res.json({
        success: true,
        token,
        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
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