// backend/src/lib/animalPropriedadeCorte.js
//
// Corte de visibilidade por JANELA DE PROPRIEDADE — o proprietário ATUAL de um
// animal transferido só enxerga, nas telas normais do sistema, dados clínicos
// gerados a partir de `Animal.propriedadeDesde` (o início da janela ABERTA em
// `AnimalProprietarioHistorico`). GESTOR/VET/ADMIN continuam vendo o histórico
// completo — a restrição existe só quando o próprio proprietário acessa.
//
// `req.user.userType` já é o tipo CONTEXTUAL, resolvido por `resolverTipoNoContexto`
// no `authenticate` (CLAUDE.md §12 36-e) — só é 'PROPRIETARIO' quando a pessoa está
// de fato agindo como dona do animal NESTA empresa. GESTOR/VET/ADMIN nunca caem
// aqui, mesmo que também sejam proprietários em outra empresa.
'use strict';

/**
 * @param {object} req      request autenticado
 * @param {{propriedadeDesde: Date}} animal  precisa ter o campo `propriedadeDesde`
 * @returns {Date|null}  a data de corte, ou null quando não se aplica (staff)
 */
function corteDePropriedade(req, animal) {
  if (req?.user?.userType !== 'PROPRIETARIO') return null;
  return animal?.propriedadeDesde ?? null;
}

module.exports = { corteDePropriedade };
