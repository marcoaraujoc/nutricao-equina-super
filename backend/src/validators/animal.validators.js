'use strict';

const { body, param } = require('express-validator');

// Falsy ignora undefined, null E string vazia — necessário para campos que chegam via FormData
const OPT = { values: 'falsy' };

const createAnimalRules = [
  body('nome')
    .trim()
    .notEmpty().withMessage('Nome do animal é obrigatório')
    .isLength({ min: 1, max: 255 }).withMessage('Nome deve ter até 255 caracteres'),

  // especieId chega como number (JSON) ou string "1" (FormData) — toInt() normaliza
  body('especieId')
    .notEmpty().withMessage('Espécie é obrigatória')
    .toInt()
    .isInt({ min: 1 }).withMessage('Espécie inválida'),

  body('racaId')
    .optional(OPT)
    .toInt()
    .isInt({ min: 1 }).withMessage('Raça inválida'),

  body('sexo')
    .optional(OPT)
    .isIn(['Macho', 'Fêmea', 'MACHO', 'FEMEA']).withMessage('Sexo inválido'),

  // Campo real no payload é 'peso' (não 'pesoAtual')
  body('peso')
    .optional(OPT)
    .toFloat()
    .isFloat({ min: 0, max: 10000 }).withMessage('Peso deve ser entre 0 e 10000 kg'),

  // Campo real no payload é 'idadeAnos' (não 'idade')
  body('idadeAnos')
    .optional(OPT)
    .toFloat()
    .isFloat({ min: 0, max: 100 }).withMessage('Idade deve ser entre 0 e 100 anos'),

  body('categoriaAnimal')
    .optional(OPT)
    .isLength({ max: 100 }).withMessage('Categoria muito longa'),

  body('tipoExercicio')
    .optional(OPT)
    .isLength({ max: 100 }).withMessage('Tipo de exercício muito longo'),

  body('local')
    .optional(OPT)
    .isLength({ max: 255 }).withMessage('Local muito longo'),

  body('ativo')
    .optional(OPT)
    .isBoolean().withMessage('Ativo deve ser booleano'),
];

const updateAnimalRules = [
  param('id')
    .isInt({ min: 1 }).withMessage('ID inválido'),
  ...createAnimalRules,
];

const animalIdParam = [
  param('id')
    .isInt({ min: 1 }).withMessage('ID de animal inválido'),
];

module.exports = { createAnimalRules, updateAnimalRules, animalIdParam };