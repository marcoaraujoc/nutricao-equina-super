// src/lib/cadastroScopeAccess.js
// Verificação de acesso por escopo empresa/equipe para os cadastros
// Fornecedor, Tratador e LocalizacaoAnimal — mesmo espírito de animalAccess.js,
// mas recebe o registro já carregado (não precisa saber em qual tabela buscar).

/**
 * Verifica se o usuário pode alterar (editar/ativar-inativar) um registro de
 * cadastro escopado por empresa/equipe.
 *
 * Regras:
 *  - ADMIN: acesso total
 *  - tipoEntrada === 'SYSTEM': catálogo global, só ADMIN
 *  - empresaId null (CLIENTE órfão/legado): só ADMIN
 *  - empresaId diferente do contexto ativo (req.empresaId): negado
 *  - membroCargo === 'GESTOR' (ou dono da empresa): qualquer equipe da empresa
 *  - registro sem equipeId (legado dentro da empresa): empresa inteira
 *  - caso contrário: equipeId do registro precisa bater com req.equipeId
 */
function podeAlterarRegistroEscopado(record, req) {
  if (req.user?.role === 'ADMIN') return true;
  if (record.tipoEntrada === 'SYSTEM') return false;
  if (!record.empresaId) return false;
  if (record.empresaId !== req.empresaId) return false;
  if (req.membroCargo === 'GESTOR') return true;
  if (!record.equipeId) return true;
  return record.equipeId === req.equipeId;
}

module.exports = { podeAlterarRegistroEscopado };
