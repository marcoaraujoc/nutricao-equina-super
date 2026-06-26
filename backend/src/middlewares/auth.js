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

    // Injeta req.empresaId / req.equipeId — o "contexto ativo" do usuário (seletor no frontend).
    // 1. Header x-equipe-id (gestor CPF trabalha por equipe): aceito se o usuário for membro
    //    da equipe OU dono da empresa dela (ADMIN aceita direto). Define também req.empresaId.
    // 2. Header x-empresa-id (gestor CNPJ trabalha por empresa): aceito se for dono OU membro
    //    de alguma equipe dela. Valor inválido/sem vínculo é ignorado silenciosamente.
    // 3. Fallback: MembroEquipe mais recente → Equipe.empresaId; depois Empresa.ownerId.
    try {
      req.empresaId = null;
      req.equipeId  = null;

      const headerEquipeId = Number(req.headers['x-equipe-id']);
      if (Number.isInteger(headerEquipeId) && headerEquipeId > 0) {
        const equipe = await prisma.equipe.findFirst({
          where: (decoded.role === 'ADMIN' || decoded.userType === 'ADMIN')
            ? { id: headerEquipeId }
            : {
                id: headerEquipeId,
                OR: [
                  { membros: { some: { userId: decoded.id } } },
                  { empresa: { ownerId: decoded.id } },
                ],
              },
          select: { id: true, empresaId: true },
        });
        if (equipe) {
          req.equipeId  = equipe.id;
          req.empresaId = equipe.empresaId;
        }
      }

      const headerEmpresaId = Number(req.headers['x-empresa-id']);
      if (!req.empresaId && Number.isInteger(headerEmpresaId) && headerEmpresaId > 0) {
        if (decoded.role === 'ADMIN' || decoded.userType === 'ADMIN') {
          req.empresaId = headerEmpresaId;
        } else {
          const vinculo = await prisma.empresa.findFirst({
            where: {
              id: headerEmpresaId,
              OR: [
                { ownerId: decoded.id },
                { equipes: { some: { membros: { some: { userId: decoded.id } } } } },
              ],
            },
            select: { id: true },
          });
          if (vinculo) req.empresaId = vinculo.id;
        }
      }

      if (!req.empresaId) {
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
