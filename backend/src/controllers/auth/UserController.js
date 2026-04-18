const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const prisma = new PrismaClient();
const SECRET = 'equine-nutrition-super-2026';

class UserController {
  async register(req, res) {
    console.log('📥 [Register] Recebido:', req.body);
    const { fullName, email, password, phone, userType = 'PROPRIETARIO' } = req.body;

    try {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) return res.status(400).json({ error: 'E-mail já cadastrado' });

      const passwordHash = await bcrypt.hash(password, 10);

      const user = await prisma.user.create({
        data: { fullName, email, passwordHash, phone, role: 'USER', userType }
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
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        console.log('❌ Usuário não encontrado');
        return res.status(401).json({ error: 'Credenciais inválidas' });
      }

      const match = await bcrypt.compare(password, user.passwordHash);
      console.log('🔑 Senha confere?', match);

      if (!match) return res.status(401).json({ error: 'Credenciais inválidas' });

      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role, fullName: user.fullName },
        SECRET,
        { expiresIn: '24h' }
      );

      console.log('✅ Login bem-sucedido!');
      res.json({ 
        token, 
        user: { id: user.id, fullName: user.fullName, role: user.role } 
      });
    } catch (err) {
      console.error('❌ Erro login:', err);
      res.status(500).json({ error: 'Erro interno no login' });
    }
  }
}

module.exports = new UserController();
