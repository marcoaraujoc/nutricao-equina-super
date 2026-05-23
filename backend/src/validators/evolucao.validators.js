'use strict';

const { body, param } = require('express-validator');

const criarEvolucaoRules = [
  body('animalId')
    .notEmpty().withMessage('Animal é obrigatório')
    .isInt({ min: 1 }).withMessage('ID de animal inválido'),
  body('descricao')
    .trim()
    .notEmpty().withMessage('Descrição é obrigatória')
    .isLength({ min: 1, max: 10000 }).withMessage('Descrição muito longa'),
  body('tipoAtendimento')
    .optional()
    .isLength({ max: 100 }).withMessage('Tipo de atendimento muito longo'),
  body('peso')
    .optional({ nullable: true })
    .isFloat({ min: 0.1, max: 10000 }).withMessage('Peso deve ser entre 0.1 e 10000 kg'),
  body('temperatura')
    .optional({ nullable: true })
    .isFloat({ min: 30, max: 45 }).withMessage('Temperatura deve ser entre 30 e 45°C'),
  body('frequenciaCardiaca')
    .optional({ nullable: true })
    .isInt({ min: 1, max: 500 }).withMessage('FC deve ser entre 1 e 500 bpm'),
  body('frequenciaRespiratoria')
    .optional({ nullable: true })
    .isInt({ min: 1, max: 200 }).withMessage('FR deve ser entre 1 e 200 irpm'),
];

const evolucaoIdParam = [
  param('id')
    .isInt({ min: 1 }).withMessage('ID de evolução inválido'),
];

module.exports = { criarEvolucaoRules, evolucaoIdParam };