'use strict';

const { body, param } = require('express-validator');

const criarEvolucaoRules = [
  body('animalId')
    .notEmpty().withMessage('Animal é obrigatório')
    .isInt({ min: 1 }).withMessage('ID de animal inválido'),
  body('especialidade')
    .trim()
    .notEmpty().withMessage('Especialidade é obrigatória')
    .isLength({ max: 100 }).withMessage('Especialidade muito longa'),
  body('texto')
    .trim()
    .notEmpty().withMessage('Texto da evolução é obrigatório')
    .isLength({ min: 1, max: 10000 }).withMessage('Texto muito longo'),
  body('status')
    .optional()
    .isIn(['EM_ANDAMENTO', 'FINALIZADA', 'CANCELADA']).withMessage('Status inválido'),
];

const evolucaoIdParam = [
  param('id')
    .isInt({ min: 1 }).withMessage('ID de evolução inválido'),
];

module.exports = { criarEvolucaoRules, evolucaoIdParam };