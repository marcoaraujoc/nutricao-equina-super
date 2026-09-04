'use strict';

const bcrypt  = require('bcryptjs');

const prisma = require('../../lib/prisma').default;
const { setAuthCookies } = require('../../lib/authCookies');
const { normalizeEmail, findUserByEmail } = require('../../lib/email');
const mfa = require('../../services/mfaService');
const { podeAcessarSistema } = require('../../lib/usuarioEmpresa');
const { registrarAcesso, registrarAcessoNegado } = require('../../lib/auditoria');
const bloqueio = require('../../lib/bloqueioLogin');
// Duração da sessão e assinatura dos tokens: fonte única em lib/sessionTokens.js
const { assinarAccessToken, gerarRefreshToken: generateRefreshToken } = require('../../lib/sessionTokens');

// Acesso ao sistema é concedido pela EMPRESA, no cadastro do membro (checkbox
// "Terá acesso ao sistema"). Quem não tem esse acesso em NENHUMA empresa fica só
// como cadastro da clínica e não entra na aplicação. ADMIN da plataforma nunca é
// barrado — é ele quem socorre a clínica que se trancou para fora.
const MSG_SEM_ACESSO = 'Seu acesso ao sistema está desativado. Fale com o gestor da clínica.';

// Hash bcrypt "isca" (cost 10, o MESMO dos hashes reais) para o login gastar o
// mesmo tempo quando o e-mail NÃO existe. Sem isto, e-mail inexistente retornava
// antes do bcrypt (~6ms) e e-mail real rodava o compare (~400ms): a diferença de
// tempo distinguia conta existente de inexistente, permitindo enumerar usuários
// mesmo com a mensagem já sendo genérica. É uma senha aleatória descartada; o
// compare SEMPRE falha — só serve para consumir o tempo do bcrypt.
const DUMMY_PASSWORD_HASH = '$2b$10$H2DGIUfnhk5ZdGiswg6FiO0dprvrNFSQ6q2agb7mGDpmuzeLqmORa';

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
async function emitirSessao(req, res, user) {
  const refreshToken = generateRefreshToken(user.id);

  // Incrementa a versão de sessão do usuário — é o que derruba na hora o access
  // token de um dispositivo anterior (ver `authenticate`, middlewares/auth.js, e
  // o comentário de `User.sessionVersion` no schema). O token é assinado só DEPOIS,
  // com o valor que acabou de ser gravado.
  const { sessionVersion } = await prisma.user.update({
    where:  { id: user.id },
    data:   { refreshToken, sessionVersion: { increment: 1 } },
    select: { sessionVersion: true },
  });
  const token = assinarAccessToken({ ...user, sessionVersion });

  // Tokens em cookies HttpOnly (não legíveis por JS) — a ÚNICA via de transporte.
  // 🔒 Os tokens NÃO são mais ecoados no corpo da resposta: um XSS pós-login não pode
  // colhê-los do JSON, e o cookie HttpOnly cumpre o mesmo papel (o front carrega a
  // identidade por /me). Cliente não-navegador autentica pelo Set-Cookie (cookie jar).
  setAuthCookies(res, { accessToken: token, refreshToken });

  // Trilha de acesso gravada AQUI, no servidor, com a identidade que o backend acabou de
  // autenticar. Antes quem gravava era o frontend, por uma rota pública que aceitava
  // usuário e empresa do corpo — ver `registrarAcesso` em lib/auditoria.js.
  // `await` de propósito: o helper é fire-and-forget por dentro (nunca lança), então isso
  // não adia a resposta de forma perceptível e evita promessa órfã.
  await registrarAcesso(req, user, 'LOGIN');

  return {
    success: true,
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
          ...bloqueio.SELECT_BLOQUEIO,
        },
      });

      // ⚠️ E-mail inexistente e senha errada devolvem A MESMA mensagem, de propósito:
      // distinguir os dois transforma a tela de login num verificador de cadastro
      // (enumeração de usuário). Não "melhorar" isso com "usuário não encontrado".
      if (!user) {
        console.log('❌ Usuário não encontrado');
        // Consome o mesmo tempo de um bcrypt.compare real, para o tempo de resposta
        // não denunciar que o e-mail não existe (ver DUMMY_PASSWORD_HASH). O
        // resultado é descartado — o compare sempre falha contra a isca.
        await bcrypt.compare(String(password ?? ''), DUMMY_PASSWORD_HASH);
        await registrarAcessoNegado(req, {
          motivo: 'Login: e-mail não cadastrado', entidade: 'LOGIN', emailTentativa: email,
        });
        return res.status(401).json({ error: 'Usuário ou Senha Inválidos' });
      }

      if (user.ativo === false) {
        await registrarAcessoNegado(req, {
          motivo: 'Login: conta desativada', entidade: 'LOGIN', entidadeId: user.id, emailTentativa: email,
        });
        return res.status(403).json({ error: 'Conta desativada. Entre em contato com o administrador da equipe.' });
      }

      // ── Conta travada por senha errada ───────────────────────────────────
      // ANTES do bcrypt: quem está bloqueado não tem senha certa nem errada, tem
      // conta fechada — e conferir o hash só gastaria CPU (bcrypt é caro de
      // propósito), o que transformaria a trava num amplificador de carga.
      // ⚠️ Aqui a mensagem é ESPECÍFICA, ao contrário do "Usuário ou Senha
      // Inválidos" genérico: para chegar a este ponto é preciso ter acertado o
      // e-mail de uma conta que já falhou 6 vezes, então não há enumeração a
      // proteger — e sem dizer o motivo a pessoa fica tentando a senha certa para
      // sempre, sem entender por que não entra.
      if (bloqueio.estaBloqueado(user)) {
        await registrarAcessoNegado(req, {
          motivo: 'Login: conta bloqueada por tentativas de senha inválidas',
          entidade: 'LOGIN', entidadeId: user.id, emailTentativa: email,
        });
        return res.status(403).json({
          error: await bloqueio.mensagemBloqueio(user.id),
          code:  'CONTA_BLOQUEADA',
        });
      }

      const match = await bcrypt.compare(password, user.passwordHash);
      if (!match) {
        const r = await bloqueio.registrarFalha(user.id);
        await registrarAcessoNegado(req, {
          motivo: r.bloqueado
            ? `Login: senha incorreta (${r.tentativas}ª tentativa) — CONTA BLOQUEADA`
            : `Login: senha incorreta (${r.tentativas}ª tentativa, restam ${r.restantes})`,
          entidade: 'LOGIN', entidadeId: user.id, emailTentativa: email,
        });
        if (r.bloqueado) {
          return res.status(403).json({
            error: await bloqueio.mensagemBloqueio(user.id),
            code:  'CONTA_BLOQUEADA',
          });
        }
        return res.status(401).json({ error: 'Usuário ou Senha Inválidos' });
      }

      // Senha certa: zera o contador. Não limpa `bloqueadoEm` — quem está bloqueado
      // nem chega aqui, e limpar seria um caminho de autodesbloqueio.
      await bloqueio.limparTentativas(user);

      // Antes do 2FA: não faz sentido mandar código a quem não pode entrar.
      if (await acessoBloqueado(user)) {
        await registrarAcessoNegado(req, {
          motivo: 'Login: acesso ao sistema desativado pelo gestor', entidade: 'LOGIN', entidadeId: user.id, emailTentativa: email,
        });
        return res.status(403).json({ error: MSG_SEM_ACESSO });
      }

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
      res.json(await emitirSessao(req, res, user));
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
        await registrarAcessoNegado(req, {
          motivo:   `2FA: ${r.motivo} (desafio ${desafioId})`,
          entidade: 'LOGIN',
        });
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

      if (!user) {
        await registrarAcessoNegado(req, { motivo: '2FA: usuário do desafio não encontrado', entidade: 'LOGIN' });
        return res.status(401).json({ error: 'Código inválido.' });
      }
      // Revalidado aqui: a conta pode ter sido desativada entre a senha e o código.
      if (user.ativo === false) {
        await registrarAcessoNegado(req, { motivo: '2FA: conta desativada', entidade: 'LOGIN', entidadeId: user.id });
        return res.status(403).json({ error: 'Conta desativada. Entre em contato com o administrador da equipe.' });
      }
      if (await acessoBloqueado(user)) {
        await registrarAcessoNegado(req, { motivo: '2FA: acesso ao sistema desativado pelo gestor', entidade: 'LOGIN', entidadeId: user.id });
        return res.status(403).json({ error: MSG_SEM_ACESSO });
      }

      console.log('✅ 2FA verificado — login concluído:', user.email);
      res.json(await emitirSessao(req, res, user));
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