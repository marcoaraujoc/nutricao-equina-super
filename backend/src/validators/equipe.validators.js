'use strict';

const { body, param } = require('express-validator');

// Criação de GESTOR (2026-08-17) — o Admin cadastra só a pessoa que vai gerenciar a
// empresa (dados básicos + plano); a identidade da empresa fica para o gestor
// preencher em Cadastro da Empresa. Ver EquipeController.criarGestor.
const criarGestorRules = [
  body('fullName')
    .trim()
    .notEmpty().withMessage('Nome é obrigatório')
    .isLength({ min: 2, max: 255 }).withMessage('Nome deve ter entre 2 e 255 caracteres'),
  body('email')
    .trim()
    .notEmpty().withMessage('E-mail é obrigatório')
    .isEmail().withMessage('E-mail inválido'),
  body('telefone')
    .trim()
    .notEmpty().withMessage('Telefone é obrigatório')
    .isLength({ max: 30 }).withMessage('Telefone muito longo'),
  body('cep')
    .trim()
    .notEmpty().withMessage('CEP é obrigatório')
    .isLength({ max: 10 }).withMessage('CEP inválido'),
  body('endereco')
    .trim()
    .notEmpty().withMessage('Endereço é obrigatório')
    .isLength({ max: 255 }).withMessage('Endereço muito longo'),
  body('bairro')
    .trim()
    .notEmpty().withMessage('Bairro é obrigatório')
    .isLength({ max: 100 }).withMessage('Bairro muito longo'),
  body('cidade')
    .trim()
    .notEmpty().withMessage('Cidade é obrigatória')
    .isLength({ max: 100 }).withMessage('Cidade muito longa'),
  body('estado')
    .trim()
    .notEmpty().withMessage('UF é obrigatória')
    .isLength({ min: 2, max: 2 }).withMessage('UF deve ter 2 letras'),
  body('complemento')
    .optional({ nullable: true, checkFalsy: true })
    .isLength({ max: 100 }).withMessage('Complemento muito longo'),
  body('planoId')
    .notEmpty().withMessage('Plano é obrigatório')
    .isInt({ min: 1 }).withMessage('Plano inválido'),
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

module.exports = { criarGestorRules, convidarMembroRules, equipeIdParam };