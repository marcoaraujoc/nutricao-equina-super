const express = require('express');
const rateLimit = require('express-rate-limit');
const UserController  = require('../controllers/auth/UserController');
const GoogleController = require('../controllers/GoogleController');
const AuthController  = require('../controllers/AuthController');
const validate        = require('../middlewares/validate');
const {
  loginRules,
  registerRules,
  forgotPasswordRules,
  resetPasswordRules,
  refreshTokenRules,
  verificar2faRules,
  reenviar2faRules,
} = require('../validators/auth.validators');

const router = express.Router();

// Brute force no 2FA: o desafio já limita a 5 tentativas, mas sem limite por IP
// dá para varrer vários desafios em paralelo. 10 tentativas / 5 min por IP.
const mfaLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit:    10,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Muitas tentativas de verificação. Aguarde alguns minutos.' },
});

// Reenvio é mais caro (dispara e-mail) — 3 / 10 min por IP.
const reenvioLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit:    3,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Muitos reenvios solicitados. Aguarde alguns minutos.' },
});

router.post('/register',        registerRules,        validate, UserController.register);
router.post('/login',           loginRules,           validate, UserController.login);
router.post('/forgot-password', forgotPasswordRules,  validate, AuthController.forgotPassword);
router.post('/reset-password',  resetPasswordRules,   validate, AuthController.resetPassword);
router.post('/refresh',         refreshTokenRules,    validate, AuthController.refreshToken);
router.post('/logout',                                          AuthController.logout);

// 2FA POR E-MAIL — segundo passo do login com senha.
// A sessão (cookies HttpOnly) só nasce em /2fa/verificar.
router.post('/2fa/verificar', mfaLimiter,     verificar2faRules, validate, UserController.verificar2fa);
router.post('/2fa/reenviar',  reenvioLimiter, reenviar2faRules,  validate, UserController.reenviar2fa);

// GOOGLE
// Sem 2FA por e-mail: o Google já autenticou o usuário (e aplica o 2FA da conta
// dele). Somar um OTP por e-mail em cima disso é atrito sem ganho de segurança.
router.post('/google', GoogleController.login);

module.exports = router;
