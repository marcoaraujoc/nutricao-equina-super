'use strict';

const { body, param } = require('express-validator');

const criarEmpresaRules = [
  body('nome')
    .trim()
    .notEmpty().withMessage('Nome da empresa é obrigatório')
    .isLength({ min: 2, max: 255 }).withMessage('Nome deve ter entre 2 e 255 caracteres'),
  // A empresa nasce com uma equipe (o gestor precisa de vínculo GESTOR nela), mas nomeá-la
  // é OPCIONAL desde 2026-08-06: em branco, ela herda o NOME DA EMPRESA.
  // ⚠️ Herdar o nome da empresa ≠ "inventar nome de equipe" — a regra de 36-d continua
  // valendo, e é justamente ela que define esse fallback para os casos em que não há
  // ninguém para informar o nome. O que NÃO pode voltar é o genérico "Equipe Principal":
  // em empresa pessoal (CPF) é o nome da EQUIPE que aparece no seletor de contexto, e o
  // gestor veria "Equipe Principal" no lugar da própria clínica.
  // `checkFalsy` cobre a string vazia — o formulário pode mandar '' em vez de omitir.
  body('equipeNome')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isLength({ min: 2, max: 255 }).withMessage('Nome da equipe deve ter entre 2 e 255 caracteres'),
  // Aceita CNPJ (14) e CPF (11), com ou sem máscara — o campo da tela é "CNPJ / CPF" e a
  // clínica pessoa física assina com CPF. Antes só o CNPJ passava, e o CPF era recusado
  // com "CNPJ inválido" sem que o formulário desse pista do porquê.
  body('cnpj')
    .optional({ nullable: true, checkFalsy: true })
    .custom((v) => {
      const d = String(v).replace(/\D/g, '');
      if (d.length !== 11 && d.length !== 14) throw new Error('Informe um CNPJ (14 dígitos) ou CPF (11 dígitos)');
      return true;
    }),
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