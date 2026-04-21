const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');

const prisma = new PrismaClient();
const SECRET = process.env.JWT_SECRET || 'equine-nutrition-super-2026';

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

      // UPSERT: cria ou atualiza o usuário na tabela users
      const user = await prisma.user.upsert({
        where: { email },
        update: {
          fullName: fullName || undefined,
        },
        create: {
          fullName: fullName || 'Usuário Google',
          email,
          passwordHash: '', // Google não usa senha
          userType: 'PROPRIETARIO',
          role: 'USER',
          ativo: true,
        },
      });

      // Gera o token JWT do nosso sistema
      const token = jwt.sign(
        { id: user.id, email: user.email, userType: user.userType },
        SECRET,
        { expiresIn: '7d' }
      );

      console.log('✅ Usuário Google criado/atualizado:', user.email);

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