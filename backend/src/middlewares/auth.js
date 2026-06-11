const jwt   = require('jsonwebtoken');
const prisma = require('../lib/prisma').default;

const SECRET = process.env.JWT_SECRET;

const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Token não fornecido' });

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, SECRET);

    // Rejeita imediatamente se a conta foi desativada
    const userCheck = await prisma.user.findUnique({ where: { id: decoded.id }, select: { ativo: true } });
    if (!userCheck || userCheck.ativo === false) {
      return res.status(401).json({ error: 'Conta desativada. Entre em contato com o administrador.' });
    }

    req.user = decoded;

    // Injeta req.empresaId a partir da equipe ativa do usuário.
    // Permite que todos os controllers filtrem por empresa sem middleware adicional.
    // Mesma lógica de getEmpresaIdDoVet: MembroEquipe primeiro, depois Empresa.ownerId.
    try {
      const membro = await prisma.membroEquipe.findFirst({
        where:   { userId: decoded.id },
        include: { equipe: { select: { empresaId: true } } },
        orderBy: { createdAt: 'desc' },
      });
      if (membro?.equipe?.empresaId) {
        req.empresaId = membro.equipe.empresaId;
      } else {
        // Fallback: usuário é dono da empresa (Empresa.ownerId) mas pode não ter MembroEquipe
        const empresa = await prisma.empresa.findFirst({ where: { ownerId: decoded.id } });
        req.empresaId = empresa?.id ?? null;
      }
    } catch {
      req.empresaId = null;
    }

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
};

const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Acesso negado - Permissão insuficiente' });
  }
  next();
};

module.exports = { authenticate, authorize };
