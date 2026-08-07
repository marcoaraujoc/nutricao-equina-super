const jwt   = require('jsonwebtoken');
const prisma = require('../lib/prisma').default;
const { getAccessTokenFromCookie } = require('../lib/authCookies');
const { resolverTipoNoContexto }   = require('../lib/tipoContexto');
// Contexto de tenant da requisição (fase 7b do multi-tenancy) — ver lib/prismaTenant.js
const { comEmpresa, comEscopoPlataforma } = require('../lib/prismaTenant');

const SECRET = process.env.JWT_SECRET;

const authenticate = async (req, res, next) => {
  // Cookie HttpOnly tem prioridade (navegador); header Authorization é o fallback
  // para clientes não-navegador e compatibilidade durante a transição.
  const authHeader = req.headers.authorization;
  const token = getAccessTokenFromCookie(req) || (authHeader ? authHeader.split(' ')[1] : null);
  if (!token) return res.status(401).json({ error: 'Token não fornecido' });

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
      // 🔴 RESOLUÇÃO DE CONTEXTO sob ESCOPO DE PLATAFORMA. Descobrir "a que empresa/
      // equipe este usuário pertence" atravessa tenants por natureza e lê tabelas com
      // RLS (tb_equipes, tb_membros_equipe, tb_animais). Sem este escopo, as
      // subconsultas de pertencimento (`equipes.some.membros.some.userId`,
      // `animais.some.userId`) rodavam SEM `app.empresa_id` e voltavam vazias — então o
      // header `x-empresa-id` de um profissional NÃO-DONO era rejeitado e ele caía
      // sempre na própria empresa, sem conseguir acessar as clínicas onde é apenas
      // membro (bug medido: a veterinária de 5 clínicas ficava presa na única que possui).
      // TODAS as queries aqui filtram por `decoded.id` (ownerId/userId), então o escopo
      // de plataforma NÃO afrouxa o isolamento: o usuário só resolve contexto contra os
      // PRÓPRIOS vínculos — jamais os de terceiros (o pentest de invasão confirma).
      await comEscopoPlataforma(async () => {
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
                // PROPRIETÁRIO: o vínculo com a clínica é ter animal nela ou possuir
                // cadastro (perfil) nela — é o que habilita o seletor de empresa no
                // portal do cliente, com permissões resolvidas por empresa ativa.
                { animais: { some: { userId: decoded.id, ativo: true } } },
                { proprietarioPerfis: { some: { userId: decoded.id, ativo: true } } },
              ],
            },
            select: { id: true },
          });
          if (vinculo) req.empresaId = vinculo.id;
        }
      }

      if (!req.empresaId) {
        // Sem contexto escolhido (ex.: logo após o login, que limpa a seleção): a
        // PRÓPRIA empresa vem primeiro. Antes vinha o vínculo de equipe MAIS RECENTE,
        // então o dono de clínica caía na empresa de outra pessoa em que foi
        // convidado — inclusive no gate de cadastro, que é por empresa: ele salvava
        // o cadastro na clínica dele e, ao logar, a tela pedia de novo (porque caía
        // na outra empresa, onde de fato não havia confirmação).
        const propria = await prisma.empresa.findFirst({
          where:   { OR: [
            { ownerId: decoded.id },
            { equipes: { some: { membros: { some: { userId: decoded.id, cargo: 'GESTOR' } } } } },
          ] },
          select:  { id: true },
          orderBy: { id: 'asc' },
        });
        if (propria) req.empresaId = propria.id;

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

          // Proprietário sem contexto escolhido: assume a empresa do animal mais
          // recente, para que o cadastro/permissões já venham de uma empresa real.
          if (!req.empresaId && decoded.userType === 'PROPRIETARIO') {
            const animal = await prisma.animal.findFirst({
              // `empresaId: { not: null }` REMOVIDO: a coluna é NOT NULL desde a fase 5
              // e o Prisma passou a recusar o filtro ("Argument `not` must not be
              // null") — quebrava a AUTENTICAÇÃO do proprietário no primeiro acesso
              // (sem header de empresa e sem ser dono/membro). Todo animal tem empresa.
              where:   { userId: decoded.id, ativo: true },
              select:  { empresaId: true },
              orderBy: { dataCadastro: 'desc' },
            });
            req.empresaId = animal?.empresaId ?? null;
          }
        }
        }
      }
      });
    } catch {
      req.empresaId = null;
    }

    // TIPO POR EMPRESA: o que a pessoa é na clínica ATIVA vem do cargo dela ali (ou
    // de ser cliente ali), não do `userType` global do login. Sem isto, quem é
    // veterinária numa empresa entrava como veterinária na empresa em que é
    // estagiária — ou em que é apenas CLIENTE. Ver lib/tipoContexto.js.
    // `req.user.userTypeGlobal` preserva o valor do token para quem precisar da
    // identidade (troca de senha, 2FA, telas de plataforma).
    try {
      // ⚠️ CARIMBO DE EMPRESA para a leitura de tenant que acontece AQUI DENTRO.
      // `resolverTipoNoContexto` lê `tb_usuario_empresa` (agora com RLS por empresa)
      // pelo par (userId, empresaId). Este trecho roda ANTES do `comEmpresa` final
      // (que envolve o `next()`), então sem este wrap a leitura sairia sem
      // `app.empresa_id` e a policy a devolveria vazia — o tipo do profissional
      // (que vem do `perfil` gravado no vínculo) cairia no fallback errado.
      // `req.empresaId` null (sem contexto) → sem carimbo → cai no legado, como antes.
      const { tipo, cargo, origem } = await comEmpresa(req.empresaId ?? null, () => resolverTipoNoContexto({
        userId:    decoded.id,
        userType:  decoded.userType,
        role:      decoded.role,
        empresaId: req.empresaId,
        equipeId:  req.equipeId,
      }));
      req.user = { ...req.user, userTypeGlobal: decoded.userType, userType: tipo };
      req.cargoContexto  = cargo;
      req.origemTipo     = origem;
    } catch { /* mantém o userType do token */ }

    // ⚠️ FASE 7b DO MULTI-TENANCY — daqui para a frente, TUDO roda com o tenant
    // declarado. `comEmpresa` abre um contexto de AsyncLocalStorage que a extensão do
    // Prisma (`lib/prismaTenant.js`) consulta para carimbar `app.empresa_id` em cada
    // operação. É o que faz o RLS valer sem alterar os 60 controllers.
    //
    // Este é o ÚNICO ponto de entrada porque é aqui que `req.empresaId` acaba de ser
    // resolvido (JWT + headers de contexto). Pôr o `comEmpresa` em qualquer lugar
    // ANTES pegaria o tenant ainda indefinido.
    //
    // ⚠️ NÃO abre transação: envolver a requisição inteira manteria uma transação
    // aberta durante chamadas ao Gemini e envios de e-mail (9 dos 60 controllers fazem
    // I/O externo no handler). A transação é por operação — ver `prismaTenant.js`.
    return comEmpresa(req.empresaId ?? null, () => next());
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
