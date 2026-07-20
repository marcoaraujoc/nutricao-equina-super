// backend/src/services/equipe.service.js
// =============================================================================
// Service de equipes — gerenciamento de membros, convites e empresa.
// =============================================================================

const crypto = require('crypto');
const prisma = require('../lib/prisma').default;
const { aplicarPermissoesPadrao } = require('./PermissaoService');

const CARGOS_VALIDOS      = ['GESTOR', 'VETERINARIO', 'ESPECIALISTA', 'ESTAGIARIO'];
const HORAS_EXPIRACAO_CONVITE = 72;

// =============================================================================
// EQUIPE
// =============================================================================

async function getMinhaEquipe(userId) {
  const membro = await prisma.membroEquipe.findFirst({
    where: { userId },
    include: {
      equipe: {
        include: {
          empresa: true,
          membros: {
            include: {
              user: {
                select: {
                  id: true, fullName: true, email: true, photoUrl: true, userType: true,
                  vetPerfil: { select: { crmv: true, bio: true } },
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
          convites: {
            where: { status: 'PENDENTE', expiresAt: { gt: new Date() } },
            orderBy: { createdAt: 'desc' },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return membro?.equipe ?? null;
}

async function criarEmpresaEEquipe({ userId, empresaNome, equipeName }) {
  // Gestor pode ter várias empresas — bloqueia apenas duplicata (mesmo owner/e-mail + mesmo nome)
  const empresaDuplicada = await prisma.empresa.findFirst({
    where: { ownerId: userId, nome: { equals: empresaNome.trim(), mode: 'insensitive' } },
  });
  if (empresaDuplicada) throw new Error('Você já possui uma empresa com este nome.');

  const resultado = await prisma.$transaction(async (tx) => {
    const empresa = await tx.empresa.create({
      data: { nome: empresaNome.trim(), ownerId: userId },
    });

    const equipe = await tx.equipe.create({
      data: {
        nome:      equipeName,
        empresaId: empresa.id,
        membros: {
          create: { userId, cargo: 'GESTOR' },
        },
      },
      include: { empresa: true, membros: true },
    });

    // Gestores não têm entradas na matriz de permissões — têm bypass total
    return { empresa, equipe };
  });

  // Instância de WhatsApp exclusiva da clínica (Evolution API) — best-effort,
  // fora da transaction e nunca bloqueia o cadastro.
  require('./whatsappService').provisionarPorEmpresa(resultado.empresa.id).catch(() => {});

  return resultado;
}

// =============================================================================
// CONVITES
// =============================================================================

async function convidarMembro({ equipeId, email, cargo, atualizadoPorId }) {
  if (!CARGOS_VALIDOS.includes(cargo)) {
    throw new Error(`Cargo inválido: ${cargo}. Use: ${CARGOS_VALIDOS.join(', ')}`);
  }

  // Garante que quem convida é gestor
  const membroConvidante = await prisma.membroEquipe.findUnique({
    where: { equipeId_userId: { equipeId, userId: atualizadoPorId } },
    select: { cargo: true },
  });
  if (!membroConvidante || membroConvidante.cargo !== 'GESTOR') {
    throw new Error('Apenas gestores podem convidar membros.');
  }

  // Verifica se email já é membro
  const userExistente = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (userExistente) {
    const jaEMembro = await prisma.membroEquipe.findUnique({
      where: { equipeId_userId: { equipeId, userId: userExistente.id } },
    });
    if (jaEMembro) throw new Error('Este usuário já é membro da equipe.');
  }

  // Invalida convites anteriores para este email nesta equipe
  await prisma.conviteEquipe.updateMany({
    where: { equipeId, email, status: 'PENDENTE' },
    data:  { status: 'CANCELADO' },
  });

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + HORAS_EXPIRACAO_CONVITE * 60 * 60 * 1000);

  const convite = await prisma.conviteEquipe.create({
    data: { equipeId, email, cargo, token, expiresAt, status: 'PENDENTE' },
    include: { equipe: { include: { empresa: true } } },
  });

  return convite;
}

async function aceitarConvite({ token, userId }) {
  const convite = await prisma.conviteEquipe.findUnique({
    where: { token },
    include: { equipe: true },
  });

  if (!convite)                           throw new Error('Convite não encontrado.');
  if (convite.status !== 'PENDENTE')      throw new Error('Convite já foi respondido ou cancelado.');
  if (convite.expiresAt < new Date())     throw new Error('Convite expirado. Solicite um novo convite.');

  // Garante que o userId corresponde ao email do convite
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user || user.email !== convite.email) {
    throw new Error('Este convite pertence a outro e-mail.');
  }

  return prisma.$transaction(async (tx) => {
    // Adiciona como membro
    const membro = await tx.membroEquipe.create({
      data: { equipeId: convite.equipeId, userId, cargo: convite.cargo },
    });

    // Marca convite como aceito
    await tx.conviteEquipe.update({
      where: { id: convite.id },
      data:  { status: 'ACEITO' },
    });

    // Aplica permissões padrão para o cargo
    await aplicarPermissoesPadrao({
      equipeId:     convite.equipeId,
      userId,
      cargo:        convite.cargo,
      atualizadoPor: 0, // 0 = sistema
    });

    return { membro, equipe: convite.equipe };
  });
}

async function recusarConvite({ token, userId }) {
  const convite = await prisma.conviteEquipe.findUnique({ where: { token } });
  if (!convite)                        throw new Error('Convite não encontrado.');
  if (convite.status !== 'PENDENTE')   throw new Error('Convite já foi respondido.');
  if (convite.expiresAt < new Date())  throw new Error('Convite expirado.');

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user || user.email !== convite.email) throw new Error('Convite pertence a outro e-mail.');

  return prisma.conviteEquipe.update({
    where: { id: convite.id },
    data:  { status: 'RECUSADO' },
  });
}

async function cancelarConvite({ conviteId, equipeId, userId }) {
  const membro = await prisma.membroEquipe.findUnique({
    where: { equipeId_userId: { equipeId, userId } },
    select: { cargo: true },
  });
  if (!membro || membro.cargo !== 'GESTOR') throw new Error('Apenas gestores podem cancelar convites.');

  const convite = await prisma.conviteEquipe.findUnique({ where: { id: conviteId } });
  if (!convite || convite.equipeId !== equipeId) throw new Error('Convite não encontrado.');
  if (convite.status !== 'PENDENTE') throw new Error('Convite já foi respondido.');

  return prisma.conviteEquipe.update({
    where: { id: conviteId },
    data:  { status: 'CANCELADO' },
  });
}

// =============================================================================
// MEMBROS
// =============================================================================

async function removerMembro({ equipeId, alvoUserId, solicitanteId }) {
  const [membroSolicitante, membroAlvo] = await Promise.all([
    prisma.membroEquipe.findUnique({ where: { equipeId_userId: { equipeId, userId: solicitanteId } } }),
    prisma.membroEquipe.findUnique({ where: { equipeId_userId: { equipeId, userId: alvoUserId  } } }),
  ]);

  if (!membroSolicitante || membroSolicitante.cargo !== 'GESTOR') {
    throw new Error('Apenas gestores podem remover membros.');
  }
  if (!membroAlvo) throw new Error('Membro não encontrado nesta equipe.');
  if (membroAlvo.cargo === 'GESTOR' && solicitanteId !== alvoUserId) {
    throw new Error('Um gestor só pode remover a si mesmo da equipe.');
  }

  return prisma.$transaction(async (tx) => {
    await tx.membroEquipe.delete({
      where: { equipeId_userId: { equipeId, userId: alvoUserId } },
    });
    // Limpa permissões do membro removido nesta equipe
    await tx.permissaoMembro.deleteMany({ where: { equipeId, userId: alvoUserId } });
  });
}

async function alterarCargo({ equipeId, alvoUserId, novoCargo, solicitanteId }) {
  if (!CARGOS_VALIDOS.includes(novoCargo)) throw new Error(`Cargo inválido: ${novoCargo}.`);

  const membroSolicitante = await prisma.membroEquipe.findUnique({
    where: { equipeId_userId: { equipeId, userId: solicitanteId } },
    select: { cargo: true },
  });
  if (!membroSolicitante || membroSolicitante.cargo !== 'GESTOR') {
    throw new Error('Apenas gestores podem alterar cargos.');
  }

  return prisma.$transaction(async (tx) => {
    const membro = await tx.membroEquipe.update({
      where: { equipeId_userId: { equipeId, userId: alvoUserId } },
      data:  { cargo: novoCargo },
    });

    // Reseta permissões para o novo cargo (limpa e recria)
    await tx.permissaoMembro.deleteMany({ where: { equipeId, userId: alvoUserId } });
    await aplicarPermissoesPadrao({ equipeId, userId: alvoUserId, cargo: novoCargo, atualizadoPor: solicitanteId });

    return membro;
  });
}

// Busca convite pelo token (para a tela pública de aceite)
async function getConvitePorToken(token) {
  return prisma.conviteEquipe.findUnique({
    where: { token },
    include: { equipe: { include: { empresa: true } } },
  });
}

module.exports = {
  getMinhaEquipe,
  criarEmpresaEEquipe,
  convidarMembro,
  aceitarConvite,
  recusarConvite,
  cancelarConvite,
  removerMembro,
  alterarCargo,
  getConvitePorToken,
};