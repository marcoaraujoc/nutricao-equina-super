const prisma = require('../lib/prisma').default;
const { setAuthCookies } = require('../lib/authCookies');
const { podeAcessarSistema } = require('../lib/usuarioEmpresa');
const { normalizeEmail, findUserByEmail } = require('../lib/email');
const { registrarAcesso } = require('../lib/auditoria');
// Duração da sessão e assinatura dos tokens: fonte única em lib/sessionTokens.js
const { assinarAccessToken, gerarRefreshToken: generateRefreshToken } = require('../lib/sessionTokens');
// 🔴 O token é conferido CONTRA O CLIENT ID DO S2VET — ver lib/googleToken.js. NUNCA
// voltar a validar só pelo /userinfo: ele aceita token emitido para QUALQUER app.
const { verificarAccessTokenGoogle } = require('../lib/googleToken');

const GoogleController = {
  login: async (req, res) => {
    try {
      const { access_token } = req.body;
      if (!access_token) {
        return res.status(400).json({ error: 'access_token do Google não fornecido' });
      }

      // Confere no Google para QUEM o token foi emitido, e só então de quem ele é.
      let googleUser;
      try {
        googleUser = await verificarAccessTokenGoogle(access_token);
      } catch (e) {
        if (e.code === 'CONFIG') {
          console.error('Login Google recusado:', e.message);
          return res.status(503).json({ error: 'Login com Google indisponível no momento.' });
        }
        if (e.code === 'AUDIENCIA') {
          // Token válido de OUTRO aplicativo: é a tentativa que esta checagem existe para barrar.
          console.warn('Login Google recusado: token emitido para outro aplicativo.');
        }
        return res.status(401).json({ error: 'Token Google inválido ou expirado' });
      }

      const email    = normalizeEmail(googleUser.email);
      const fullName = googleUser.nome;

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
      // 🔴 MENSAGEM GENÉRICA PARA CONTA DESATIVADA (2026-09-04, a pedido).
      // "Conta desativada" confirmava a EXISTÊNCIA do e-mail para quem só chutou o
      // endereço — a mesma enumeração de usuário que o "Usuário ou Senha Inválidos"
      // do e-mail inexistente existe para evitar. Quem foi desligado de verdade
      // descobre com o gestor, não pela tela de login.
      // ⚠️ 401, e não 403: precisa ser indistinguível dos outros dois casos, e o
      // status faz parte da resposta.
        return res.status(401).json({ error: 'Usuário ou Senha Inválidos' });
      }

      // Mesmo gate do login por senha: sem acesso concedido por nenhuma empresa, não entra.
      // (O Google autentica QUEM é a pessoa; quem autoriza o uso do sistema é a clínica.)
      const ehAdminPlataforma = user.role === 'ADMIN' || user.userType === 'ADMIN';
      if (!ehAdminPlataforma && !(await podeAcessarSistema(user.id))) {
        return res.status(403).json({ error: 'Seu acesso ao sistema está desativado. Fale com o gestor da clínica.' });
      }

      console.log(`✅ Usuário Google processado: ${user.email} (ID: ${user.id})`);

      const refreshToken = generateRefreshToken(user.id);

      // Mesmo mecanismo do login por senha/2FA (`emitirSessao`): incrementa a
      // versão de sessão para derrubar na hora o access token de outro dispositivo.
      const { sessionVersion } = await prisma.user.update({
        where:  { id: user.id },
        data:   { refreshToken, sessionVersion: { increment: 1 } },
        select: { sessionVersion: true },
      });
      const token = assinarAccessToken({ ...user, sessionVersion });

      // Cookies HttpOnly (consistente com o login por e-mail/senha) — via ÚNICA de
      // transporte. 🔒 O token NÃO é ecoado no corpo (não exposto ao JS); o front
      // confirma pelo `success` e carrega a identidade por /me.
      setAuthCookies(res, { accessToken: token, refreshToken });

      // ⚠️ O login Google NÃO passa por `emitirSessao` — cria a sessão aqui mesmo. Sem
      // esta linha, quem entra pelo Google sumiria da trilha de acesso.
      await registrarAcesso(req, user, 'LOGIN');

      return res.json({
        success: true,
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