'use strict';

const { body, param } = require('express-validator');

const criarEmpresaRules = [
  body('nome')
    .trim()
    .notEmpty().withMessage('Nome da empresa é obrigatório')
    .isLength({ min: 2, max: 255 }).withMessage('Nome deve ter entre 2 e 255 caracteres'),
  // A empresa nasce com uma equipe (o gestor precisa de vínculo GESTOR nela) e o nome
  // dela é OBRIGATÓRIO — o sistema não inventa nome de equipe.
  body('equipeNome')
    .trim()
    .notEmpty().withMessage('Nome da equipe é obrigatório')
    .isLength({ min: 2, max: 255 }).withMessage('Nome da equipe deve ter entre 2 e 255 caracteres'),
  body('cnpj')
    .optional({ nullable: true })
    .matches(/^\d{14}$|^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/).withMessage('CNPJ inválido'),
  body('telefone')
    .optional({ nullable: true })
    .isLength({ max: 30 }).withMessage('Telefone muito longo'),
  body('endereco')
    .optional({ nullable: true })
    .isLength({ max: 500 }).withMessage('Endereço muito longo'),
];

const convidarMembroRules = [
  body('email')
    .trim()
    .notEmpty().withMessage('E-mail é obrigatório')
    .isEmail().withMessage('E-mail inválido'),
  body('cargo')
    .optional()
    .isIn(['ADMIN', 'VETERINARIO', 'ESTAGIARIO', 'PROPRIETARIO', 'MEMBRO']).withMessage('Cargo inválido'),
];

const equipeIdParam = [
  param('equipeId')
    .isInt({ min: 1 }).withMessage('ID de equipe inválido'),
];

module.exports = { criarEmpresaRules, convidarMembroRules, equipeIdParam };