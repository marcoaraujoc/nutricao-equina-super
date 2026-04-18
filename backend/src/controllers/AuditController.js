const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class AuditController {
  async registrar(req, res) {
    const { userId, userName, email, action } = req.body;

    try {
      const log = await prisma.auditLog.create({
        data: {
          userId,
          userName,
          email,
          action,
        }
      });
      res.status(201).json(log);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao registrar auditoria' });
    }
  }
}

module.exports = new AuditController();