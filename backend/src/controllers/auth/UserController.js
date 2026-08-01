'use strict';

const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');

const prisma = require('../../lib/prisma').default;
const { setAuthCookies } = require('../../lib/authCookies');
const { normalizeEmail, findUserByEmail } = require('../../lib/email');
const mfa = require('../../services/mfaService');
const { podeAcessarSistema } = require('../../lib/usuarioEmpresa');
const SECRET          = process.env.JWT_SECRET;
const REFRESH_SECRET  = process.env.JWT_REFRESH_SECRET || (SECRET + '_refresh');
const REFRESH_EXPIRES = '30d';

// Refresh token assinado (JWT) com expiração — validado em AuthController.refreshToken.
function generateRefreshToken(userId) {
  return jwt.sign(
    { id: userId, type: 'refresh', jti: crypto.randomBytes(16).toString('hex') },
    REFRESH_SECRET,
    { expiresIn: REFRESH_EXPIRES }
  );
}

// Acesso ao sistema é concedido pela EMPRESA, no cadastro do membro (checkbox
// "Terá acesso ao sistema"). Quem não tem esse acesso em NENHUMA empresa fica só
// como cadastro da clínica e não entra na aplicação. ADMIN da plataforma nunca é
// barrado — é ele quem socorre a clínica que se trancou para fora.
const MSG_SEM_ACESSO = 'Seu acesso ao sistema está desativado. Fale com o gestor da clínica.';

async function acessoBloqueado(user) {
  if (!user) return false;
  if (user.role === 'ADMIN' || user.userType === 'ADMIN') return false;
  return !(await podeAcessarSistema(user.id));
}

/**
 * Emite a sessão (JWT + refresh + cookies HttpOnly) e monta o corpo da resposta.
 * Ponto ÚNICO de nascimento de sessão por senha: usado pelo login sem 2FA e pela
 * verificação do segundo fator. Não duplicar esta lógica.
 */
async function emitirSessao(res, user) {
  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, fullName: user.fullName, userType: user.userType },
    SECRET,
    { expiresIn: '24h' }
  );

  const refreshToken = generateRefreshToken(user.id);
  await prisma.user.update({ where: { id: user.id }, data: { refreshToken } });

  // Tokens em cookies HttpOnly (não legíveis por JS). O corpo mantém os tokens
  // por compatibilidade com clientes não-navegador; o frontend não os usa mais.
  setAuthCookies(res, { accessToken: token, refreshToken });

  return {
    token,
    refreshToken,
    user: {
      id:                 user.id,
      fullName:           user.fullName,
      role:               user.role,
      userType:           user.userType,
      mustChangePassword: user.mustChangePassword,
    },
  };
}

class UserController {

  async register(req, res) {
    console.log('📥 [Register] Recebido:', req.body);
    const { fullName, email: emailRaw, password, phone, userType } = req.body;
    const email = normalizeEmail(emailRaw);
    if (!email) return res.status(400).json({ error: 'E-mail inválido' });

    // Cadastro direto nunca pode auto-atribuir papel privilegiado. Apenas PROPRIETARIO
    // ou VETERINARIO são aceitos; qualquer outro valor cai no padrão PROPRIETARIO.
    const TIPOS_PERMITIDOS = ['PROPRIETARIO', 'VETERINARIO'];
    const userTypeSeguro = TIPOS_PERMITIDOS.includes(userType) ? userType : 'PROPRIETARIO';

    try {
      // Duplicidade case-insensitive (bloqueia "Karina@" se já existir "karina@")
      const existing = await findUserByEmail(prisma, email, { select: { id: true } });
      if (existing) return res.status(400).json({ error: 'E-mail já cadastrado' });

      const passwordHash = await bcrypt.hash(password, 10);

      const user = await prisma.user.create({
        data: { fullName, email, passwordHash, phone, role: 'USER', userType: userTypeSeguro },
      });

      console.log('✅ Usuário cadastrado! ID:', user.id);
      res.status(201).json({ message: 'Usuário cadastrado com sucesso!', userId: user.id });
    } catch (err) {
      console.error('❌ Erro register:', err);
      res.status(500).json({ error: 'Erro interno' });
    }
  }

  async login(req, res) {
    const { email: emailRaw, password } = req.body;
    const email = normalizeEmail(emailRaw);
    console.log('📥 [Login] Tentativa:', { email });

    try {
      // Busca case-insensitive — funciona mesmo para cadastros antigos com e-mail em maiúsculas
      const user = await findUserByEmail(prisma, email, {
        select: {
          id:                 true,
          email:              true,
          fullName:           true,
          role:               true,
          userType:           true,
          passwordHash:       true,
          mustChangePassword: true,
          ativo:              true,
          mfaAtivo:           true,
        },
      });

      if (!user) {
        console.log('❌ Usuário não encontrado');
        return res.status(401).json({ error: 'Credenciais inválidas' });
      }

      if (user.ativo === false) {
        return res.status(403).json({ error: 'Conta desativada. Entre em contato com o administrador da equipe.' });
      }

      const match = await bcrypt.compare(password, user.passwordHash);
      if (!match) return res.status(401).json({ error: 'Credenciais inválidas' });

      // Antes do 2FA: não faz sentido mandar código a quem não pode entrar.
      if (await acessoBloqueado(user)) return res.status(403).json({ error: MSG_SEM_ACESSO });

      // ── Segundo fator (2FA por e-mail) ───────────────────────────────────
      // Senha correta NÃO abre sessão: cria o desafio e devolve o desafioId.
      // Nenhum cookie é emitido aqui — a sessão nasce em verificar2fa().
      if (await mfa.exigeMfa(user)) {
        try {
          const { desafioId, emailMascarado } = await mfa.criarDesafio(user, req);
          console.log('🔐 Login aguardando 2FA:', { email });
          return res.status(200).json({
            mfaRequerido:    true,
            desafioId,
            emailMascarado,
            validadeMinutos: mfa.VALIDADE_MIN,
          });
        } catch (mfaErr) {
          // Sem e-mail não há segundo fator — não liberamos a sessão.
          console.error('❌ Falha ao enviar código 2FA:', mfaErr.message);
          return res.status(503).json({
            error: 'Não foi possível enviar o código de verificação. Tente novamente em instantes.',
          });
        }
      }

      console.log('✅ Login bem-sucedido!');
      res.json(await emitirSessao(res, user));
    } catch (err) {
      console.error('❌ Erro login:', err);
      res.status(500).json({ error: 'Erro interno no login' });
    }
  }

  // ── POST /api/auth/2fa/verificar ──────────────────────────────────────────
  // Segundo passo do login: valida o código e só então emite a sessão.
  async verificar2fa(req, res) {
    const { desafioId, codigo } = req.body ?? {};

    try {
      const r = await mfa.validarCodigo(desafioId, codigo);

      if (!r.ok) {
        // Mensagem genérica para código errado / desafio inválido — não permite
        // distinguir "usuário existe" de "código errado".
        const MENSAGENS = {
          EXPIRADO:             'Código expirado. Faça o login novamente.',
          TENTATIVAS_EXCEDIDAS: 'Muitas tentativas. Faça o login novamente.',
          REENVIOS_EXCEDIDOS:   'Limite de reenvios atingido. Faça o login novamente.',
        };
        return res.status(401).json({
          error:     MENSAGENS[r.motivo] ?? 'Código inválido.',
          motivo:    r.motivo,
          restantes: r.restantes,
        });
      }

      const user = await prisma.user.findUnique({
        where:  { id: r.userId },
        select: {
          id: true, email: true, fullName: true, role: true,
          userType: true, mustChangePassword: true, ativo: true,
        },
      });

      if (!user)                return res.status(401).json({ error: 'Código inválido.' });
      // Revalidado aqui: a conta pode ter sido desativada entre a senha e o código.
      if (user.ativo === false) return res.status(403).json({ error: 'Conta desativada. Entre em contato com o administrador da equipe.' });
      if (await acessoBloqueado(user)) return res.status(403).json({ error: MSG_SEM_ACESSO });

      console.log('✅ 2FA verificado — login concluído:', user.email);
      res.json(await emitirSessao(res, user));
    } catch (err) {
      console.error('❌ Erro verificar2fa:', err);
      res.status(500).json({ error: 'Erro interno na verificação' });
    }
  }

  // ── POST /api/auth/2fa/reenviar ───────────────────────────────────────────
  async reenviar2fa(req, res) {
    const { desafioId } = req.body ?? {};

    try {
      const r = await mfa.reenviarCodigo(desafioId, req);
      if (!r.ok) {
        const MENSAGENS = {
          EXPIRADO:           'Código expirado. Faça o login novamente.',
          REENVIOS_EXCEDIDOS: 'Limite de reenvios atingido. Faça o login novamente.',
        };
        return res.status(400).json({ error: MENSAGENS[r.motivo] ?? 'Não foi possível reenviar o código.', motivo: r.motivo });
      }
      res.json({ sucesso: true, emailMascarado: r.emailMascarado, validadeMinutos: mfa.VALIDADE_MIN });
    } catch (err) {
      console.error('❌ Erro reenviar2fa:', err);
      res.status(500).json({ error: 'Não foi possível reenviar o código.' });
    }
  }

  // ── GET /api/users/me ─────────────────────────────────────────────────────
  async me(req, res) {
    try {
      const user = await prisma.user.findUnique({
        where:  { id: Number(req.user.id) },
        select: {
          id:                 true,
          email:              true,
          fullName:           true,
          role:               true,
          userType:           true,
          phone:              true,
          photoUrl:           true,
          mustChangePassword: true, // ← NOVO
        },
      });
      if (!user) return res.status(404).json({ sucesso: false, mensagem: 'Usuário não encontrado' });
      res.json({ sucesso: true, ...user });
    } catch (err) {
      console.error('❌ Erro me:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  }

  // ── PATCH /api/users/me/senha ─────────────────────────────────────────────
  async alterarSenha(req, res) {
    const { senhaAtual, novaSenha } = req.body;

    if (!novaSenha || novaSenha.length < 8) {
      return res.status(400).json({ sucesso: false, mensagem: 'A nova senha deve ter ao menos 8 caracteres' });
    }

    try {
      const user = await prisma.user.findUnique({
        where:  { id: Number(req.user.id) },
        select: { passwordHash: true, mustChangePassword: true },
      });

      if (!user) return res.status(404).json({ sucesso: false, mensagem: 'Usuário não encontrado' });

      // Troca voluntária exige senha atual; troca obrigatória (primeiro login), não
      if (!user.mustChangePassword) {
        if (!senhaAtual) {
          return res.status(400).json({ sucesso: false, mensagem: 'Senha atual é obrigatória' });
        }
        const valida = await bcrypt.compare(senhaAtual, user.passwordHash);
        if (!valida) {
          return res.status(401).json({ sucesso: false, mensagem: 'Senha atual incorreta' });
        }
      }

      const hash = await bcrypt.hash(novaSenha, 10);

      await prisma.user.update({
        where: { id: Number(req.user.id) },
        data:  { passwordHash: hash, mustChangePassword: false },
      });

      res.json({ sucesso: true, mensagem: 'Senha alterada com sucesso' });
    } catch (err) {
      console.error('❌ Erro alterarSenha:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  }
}

module.exports = new UserController();