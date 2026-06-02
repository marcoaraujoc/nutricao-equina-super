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

const registerRules = [
  body('fullName')
    .trim()
    .notEmpty().withMessage('Nome completo é obrigatório')
    .isLength({ min: 2, max: 255 }).withMessage('Nome deve ter entre 2 e 255 caracteres'),
  body('email')
    .trim()
    .notEmpty().withMessage('E-mail é obrigatório')
    .isEmail().withMessage('E-mail inválido')
    .isLength({ max: 255 }).withMessage('E-mail muito longo')
    .customSanitizer(v => v.toLowerCase()),
  body('password')
    .notEmpty().withMessage('Senha é obrigatória')
    .isLength({ min: 8, max: 128 }).withMessage('Senha deve ter entre 8 e 128 caracteres'),
  body('phone')
    .optional({ values: 'falsy' })
    .isMobilePhone('pt-BR').withMessage('Telefone inválido'),
  body('userType')
    .optional()
    .isIn(['PROPRIETARIO', 'VETERINARIO', 'ESTAGIARIO', 'ADMIN']).withMessage('Tipo de usuário inválido'),
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

const refreshTokenRules = [
  body('refreshToken')
    .notEmpty().withMessage('Refresh token é obrigatório')
    .isString().withMessage('Refresh token inválido'),
];

module.exports = {
  loginRules,
  registerRules,
  forgotPasswordRules,
  resetPasswordRules,
  refreshTokenRules,
};