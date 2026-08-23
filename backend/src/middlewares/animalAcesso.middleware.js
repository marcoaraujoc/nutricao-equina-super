// src/middlewares/animalAcesso.middleware.js
//
// PORTA ÚNICA de "este paciente é meu?" para rotas que carregam o animal na URL.
//
// POR QUÊ existe: `checkPermission` responde SE a pessoa pode ler/gravar aquele módulo
// — nunca SOBRE QUAL paciente. Um vet da empresa A com `nutricao.dietas.ler` concedido
// passava no checkPermission e lia `/api/dietas/planos/animal/:animalId` de QUALQUER
// animal da plataforma, bastando trocar o id na URL. O mesmo valia para análise,
// relatório nutricional, exame nutricional e resenha — o módulo de Nutrição inteiro
// não tinha uma única chamada a `verificarAcessoAnimal`.
//
// Uso (SEMPRE depois do checkPermission da rota, que é quem popula req.empresaId /
// req.equipeId / req.membroCargo):
//   router.get('/animal/:animalId', authenticate, checkPermission(...), exigirAcessoAnimal(), handler)
//   router.post('/',                authenticate, checkPermission(...), exigirAcessoAnimal({ de: 'body' }), handler)
//
// Regra de resposta (espelha os callers já existentes de verificarAcessoAnimal):
//   animal inexistente → 404 · sem acesso → 403 · id ausente/inválido → 400
'use strict';

const { verificarAcessoAnimal } = require('../lib/animalAccess');
const { registrarAcessoNegado } = require('../lib/auditoria');

/**
 * @param {object}  [opts]
 * @param {string}  [opts.campo='animalId'] nome do parâmetro que carrega o id
 * @param {'params'|'body'|'query'} [opts.de='params'] onde procurar
 * @param {boolean} [opts.opcional=false] true = segue adiante quando o id não veio
 *                  (rota em que o animal é filtro opcional, não o recurso)
 */
function exigirAcessoAnimal(opts = {}) {
  const { campo = 'animalId', de = 'params', opcional = false } = opts;

  return async function guardAnimal(req, res, next) {
    try {
      const bruto = req[de]?.[campo];

      if (bruto === undefined || bruto === null || bruto === '') {
        if (opcional) return next();
        return res.status(400).json({ error: `${campo} é obrigatório` });
      }

      const animalId = Number(bruto);
      if (!Number.isInteger(animalId) || animalId <= 0) {
        return res.status(400).json({ error: `${campo} inválido` });
      }

      const acesso = await verificarAcessoAnimal({
        animalId,
        userId:    req.user.id,
        empresaId: req.empresaId,
        equipeId:  req.equipeId,
        userType:  req.user.userType,
      });

      if (acesso === null) return res.status(404).json({ error: 'Animal não encontrado' });
      if (!acesso) {
        await registrarAcessoNegado(req, {
          motivo:   'Acesso não autorizado a paciente (fora do escopo do usuário)',
          entidade: 'ANIMAL',
          animalId,
        });
        return res.status(403).json({ error: 'Acesso não autorizado a este animal' });
      }

      // Deixa o id já normalizado para o handler não reconverter.
      req.animalIdAcessivel = animalId;
      return next();
    } catch (err) {
      console.error('exigirAcessoAnimal:', err);
      return res.status(500).json({ error: 'Erro ao verificar acesso ao animal' });
    }
  };
}

/**
 * Versão para usar DENTRO do handler, quando o animal só é conhecido depois de
 * carregar o registro (ex.: `PUT /dietas/:id` → o animal vem do item).
 * Devolve true quando pode seguir; já respondeu 403/404 quando devolve false.
 */
async function garantirAcessoAnimal(req, res, animalId) {
  const acesso = await verificarAcessoAnimal({
    animalId:  Number(animalId),
    userId:    req.user.id,
    empresaId: req.empresaId,
    equipeId:  req.equipeId,
    userType:  req.user.userType,
  });

  if (acesso === null) {
    res.status(404).json({ error: 'Animal não encontrado' });
    return false;
  }
  if (!acesso) {
    await registrarAcessoNegado(req, {
      motivo:   'Acesso não autorizado a paciente (fora do escopo do usuário)',
      entidade: 'ANIMAL',
      animalId: Number(animalId),
    });
    res.status(403).json({ error: 'Acesso não autorizado a este animal' });
    return false;
  }
  return true;
}

module.exports = { exigirAcessoAnimal, garantirAcessoAnimal };
