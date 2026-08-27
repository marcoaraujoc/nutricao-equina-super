// backend/src/routes/documentos.js
//
// Central de Documentos. Duas famílias de permissão, separadas de propósito
// (`002_permissoes_padrao.seed.js` já as semeava desde antes de existir backend):
//
//   documentos.templates.*  → o MODELO da clínica
//   documentos.emitidos.*   → o DOCUMENTO entregue ao cliente
//
// Quem emite atestado no campo não precisa poder reescrever o modelo da clínica; e
// quem desenha o modelo não necessariamente emite. Por isso o gate do editor é o
// primeiro grupo e o da emissão é o segundo.
'use strict';

const express = require('express');
const router  = express.Router();
const { authenticate }    = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permissao.middleware');

const DocumentoCompartilharController = require('../controllers/DocumentoCompartilharController');
const DocumentoTemplateController     = require('../controllers/DocumentoTemplateController');
const DocumentoEmitidoController      = require('../controllers/DocumentoEmitidoController');
const DocumentoChatController         = require('../controllers/DocumentoChatController');

// ── Envio genérico (HTML → PDF) por WhatsApp/e-mail ──────────────────────────
// Só `authenticate`, mesmo padrão de POST /dietas/compartilhar e de
// /orcamentos/:id/enviar-whatsapp: quem chama já teve acesso ao dado que virou o
// HTML lá na tela de origem.
router.post('/whatsapp', authenticate, DocumentoCompartilharController.whatsapp);
router.post('/email',    authenticate, DocumentoCompartilharController.email);
router.post('/pdf',      authenticate, DocumentoCompartilharController.pdf);

// ── Chat da IA ───────────────────────────────────────────────────────────────
// Gate de CRIAR MODELO: o chat existe para montar/ajustar modelo, e é isso que ele
// devolve. Quem só emite não precisa dele.
router.post('/chat', authenticate, checkPermission('documentos.templates.criar', 'PROPRIO'), DocumentoChatController.conversar);

// ── Contexto do paciente (variáveis já resolvidas) ───────────────────────────
// Gate de LER MODELO: é o que a tela precisa para pré-visualizar a folha com dado
// real. O acesso ao PACIENTE é verificado dentro do controller
// (`verificarAcessoAnimal`) — permissão de módulo não substitui escopo de animal.
router.get('/contexto/:animalId', authenticate, checkPermission('documentos.templates.ler', 'LEITURA'), DocumentoEmitidoController.contexto);
// "O que falta preencher" — a chamada que abre a tela de emissão. É POST porque
// recebe os BLOCOS do editor (que podem estar alterados e não salvos), não cabem
// numa query string. Gate de EMITIR: quem não emite não precisa saber o que falta.
router.post('/campos', authenticate, checkPermission('documentos.emitidos.criar', 'PROPRIO'), DocumentoEmitidoController.campos);

// ── Documentos emitidos ──────────────────────────────────────────────────────
// Literais e rotas mais específicas ANTES de /:id (armadilha 1).
router.get('/emitidos',        authenticate, checkPermission('documentos.emitidos.ler',   'LEITURA'), DocumentoEmitidoController.listar);
router.post('/emitidos',       authenticate, checkPermission('documentos.emitidos.criar', 'PROPRIO'), DocumentoEmitidoController.emitir);
router.get('/emitidos/:id',    authenticate, checkPermission('documentos.emitidos.ler',   'LEITURA'), DocumentoEmitidoController.obterPorId);
// Cancelar o documento entregue é ato do mesmo perfil que o emitiu — não há slug de
// exclusão para emitidos no catálogo, e criar um agora nasceria sem ninguém
// configurado. Justificativa obrigatória + auditoria ficam no controller.
router.delete('/emitidos/:id', authenticate, checkPermission('documentos.emitidos.criar', 'PROPRIO'), DocumentoEmitidoController.cancelar);

// ── Modelos ──────────────────────────────────────────────────────────────────
router.get('/templates',                  authenticate, checkPermission('documentos.templates.ler',     'LEITURA'), DocumentoTemplateController.listar);
router.post('/templates',                 authenticate, checkPermission('documentos.templates.criar',   'PROPRIO'), DocumentoTemplateController.criar);
router.get('/templates/:id',              authenticate, checkPermission('documentos.templates.ler',     'LEITURA'), DocumentoTemplateController.obterPorId);
router.put('/templates/:id',              authenticate, checkPermission('documentos.templates.editar',  'PROPRIO'), DocumentoTemplateController.atualizar);
// Duplicar CRIA um modelo — gate de criar, não de editar.
router.post('/templates/:id/duplicar',    authenticate, checkPermission('documentos.templates.criar',   'PROPRIO'), DocumentoTemplateController.duplicar);
router.patch('/templates/:id/favorito',   authenticate, checkPermission('documentos.templates.editar',  'PROPRIO'), DocumentoTemplateController.alternarFavorito);
router.patch('/templates/:id/restaurar',  authenticate, checkPermission('documentos.templates.editar',  'PROPRIO'), DocumentoTemplateController.restaurar);
router.delete('/templates/:id',           authenticate, checkPermission('documentos.templates.deletar', 'PROPRIO'), DocumentoTemplateController.excluir);

module.exports = router;
