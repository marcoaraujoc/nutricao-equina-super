'use strict';

const { body } = require('express-validator');

const loginRules = [
  body('email')
    .trim()
    .notEmpty().withMessage('E-mail é obrigatório')
    .isEmail().withMessage('E-mail inválido')
    .isLength({ max: 255 }).withMessage('E-mail muito longo')
    .customSanitizer(v => v.toLowerCase()),
  body('password')
    .notEmpty().withMessage('Senha é obrigatória')
    .isLength({ min: 6, max: 128 }).withMessage('Senha deve ter entre 6 e 128 caracteres'),
];

const forgotPasswordRules = [
  body('email')
    .trim()
    .notEmpty().withMessage('E-mail é obrigatório')
    .isEmail().withMessage('E-mail inválido'),
];

const resetPasswordRules = [
  body('token')
    .notEmpty().withMessage('Token é obrigatório'),
  body('newPassword')
    .notEmpty().withMessage('Nova senha é obrigatória')
    .isLength({ min: 8, max: 128 }).withMessage('Nova senha deve ter entre 8 e 128 caracteres'),
];

// O refresh token vem do cookie HttpOnly (s2vet_rt); o corpo é apenas fallback
// para clientes não-navegador. Por isso é opcional aqui — o controller valida
// a presença (cookie OU corpo) e responde 401 quando nenhum está presente.
const refreshTokenRules = [
  body('refreshToken')
    .optional()
    .isString().withMessage('Refresh token inválido'),
];

// 2FA por e-mail — o desafioId é opaco (hex de 32 bytes) e o código tem 6 dígitos.
const verificar2faRules = [
  body('desafioId')
    .isString().withMessage('Desafio inválido')
    .isLength({ min: 16, max: 128 }).withMessage('Desafio inválido'),
  body('codigo')
    .isString().withMessage('Código inválido')
    .trim()
    .matches(/^\d{6}$/).withMessage('O código tem 6 dígitos'),
];

const reenviar2faRules = [
  body('desafioId')
    .isString().withMessage('Desafio inválido')
    .isLength({ min: 16, max: 128 }).withMessage('Desafio inválido'),
];

module.exports = {
  loginRules,
  forgotPasswordRules,
  resetPasswordRules,
  refreshTokenRules,
  verificar2faRules,
  reenviar2faRules,
};