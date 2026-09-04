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
const multer  = require('multer');
const path    = require('path');
const router  = express.Router();
const { authenticate }    = require('../middlewares/auth');
const { tenantRls }       = require('../middlewares/tenantRls');
const { checkPermission } = require('../middlewares/permissao.middleware');

// Upload da IMAGEM de um documento enviado pela clínica. PDF não chega aqui: é
// convertido em imagem (uma por página) no navegador — ver o comentário de
// `DocumentoTemplateController.enviarArquivo`.
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 15 * 1024 * 1024 },
  // Extensão E mimetype, como em `routes/animais.js`: validar só o mimetype aceita um
  // .svg renomeado, e SVG é HTML executável (o XSS armazenado da varredura de 06/11).
  fileFilter: (_req, file, cb) => {
    const permitido = /jpeg|jpg|png|webp/;
    cb(null, permitido.test(path.extname(file.originalname).toLowerCase()) && permitido.test(file.mimetype));
  },
});

const DocumentoCompartilharController = require('../controllers/DocumentoCompartilharController');
const DocumentoTemplateController     = require('../controllers/DocumentoTemplateController');
const DocumentoEmitidoController      = require('../controllers/DocumentoEmitidoController');
const DocumentoChatController         = require('../controllers/DocumentoChatController');
const { MAX_PAGINAS }                 = require('../services/documentoConversaoService');

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
// ⚠️ `/templates/upload` ANTES de `/templates/:id` — senão o Express lê "upload" como
// o valor de `:id` (armadilha 1).
// ⚠️ `tenantRls` REENTRA logo APÓS o multer: o parsing de stream do busboy se intercala
// entre o `authenticate` (que carimba o tenant) e o controller, e há evidência de que
// isso pode fazer o `AsyncLocalStorage` do tenant não sobreviver até lá — mesmo motivo
// e mesma ordem de `routes/animais.js`.
// Conversão do documento ENVIADO em MODELO (IA multimodal): recebe as páginas já
// convertidas em imagem pelo navegador + o texto extraído do PDF, e devolve os blocos
// com `{{variáveis}}` e `[[lacunas]]` identificadas. NÃO grava nada — quem cria o
// modelo é o `POST /templates` logo abaixo. Gate de CRIAR MODELO, como o upload: é um
// modelo da clínica que vai nascer disto — e valem para ela as DUAS ordens acima.
router.post('/templates/converter',       authenticate, checkPermission('documentos.templates.criar',   'PROPRIO'), upload.array('paginas', MAX_PAGINAS), tenantRls, DocumentoTemplateController.converter);
router.post('/templates/upload',          authenticate, checkPermission('documentos.templates.criar',   'PROPRIO'), upload.single('arquivo'), tenantRls, DocumentoTemplateController.enviarArquivo);
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
