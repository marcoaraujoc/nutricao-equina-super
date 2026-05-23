'use strict';

const { validationResult } = require('express-validator');

module.exports = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      sucesso: false,
      mensagem: 'Dados inválidos',
      erros: errors.array().map(e => ({ campo: e.path, mensagem: e.msg })),
    });
  }
  next();
};