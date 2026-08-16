// backend/src/routes/clinica-exames.js  — montado em /api/clinica/exames
'use strict';

const express                  = require('express');
const router                   = express.Router();
const multer                   = require('multer');
const path                     = require('path');
const crypto                   = require('crypto');
const ExameClinicoController   = require('../controllers/ExameClinicoController');
const { authenticate }         = require('../middlewares/auth');
const { tenantRls }            = require('../middlewares/tenantRls');
const { checkPermission }      = require('../middlewares/permissao.middleware');

// Formatos com TEXTO extraível no servidor (sem precisar de visão): PDF (pdf-parse),
// .docx (mammoth) e .txt (lido direto). Imagem também passa — sem texto, vai pro
// Gemini Vision. .doc (binário OLE antigo) TAMBÉM passa — sem transcrição alguma
// (nem texto, nem visão: o Gemini não entende `.doc` como anexo), mas o arquivo é
// aceito e salvo normalmente como anexo do resultado; quem avisa que não há
// prévia automática é `exameParserService.ArquivoSemTranscricaoError`, capturada
// à parte no controller (não é erro, é aviso — ver `naoTranscritos`).
// Fora esses formatos (planilha, zip etc.) chegava até `processarExame`/
// `processarLaudoImagem` e estourava lá dentro, como erro genérico de IA. Recusar
// aqui, ANTES do upload, dá o motivo real na hora (415
// `FORMATO_ARQUIVO_NAO_SUPORTADO`, tratado no error handler global — server.ts).
const MIME_TXT  = 'text/plain';
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIME_DOC  = 'application/msword';

function fileFilter(_req, file, cb) {
  if (
    file.mimetype === 'application/pdf'
    || file.mimetype === MIME_TXT
    || file.mimetype === MIME_DOCX
    || file.mimetype === MIME_DOC
    || file.mimetype.startsWith('image/')
  ) {
    return cb(null, true);
  }
  const err = new Error(`Formato não suportado: "${file.originalname || file.mimetype}". Envie PDF, DOCX, TXT ou imagem.`);
  err.status = 415;
  err.code   = 'FORMATO_ARQUIVO_NAO_SUPORTADO';
  cb(err);
}

// diskStorage: o exameParserService (LLM) precisa do path do arquivo; nome final
// imprevisível e sem originalname (evita path traversal), como em routes/exames.js.
const uploadResultado = multer({
  fileFilter,
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, 'uploads/exames/'),
    filename:    (_req, file, cb) => {
      const extRaw = path.extname(file.originalname || '').toLowerCase();
      const ext = /^\.[a-z0-9]{1,8}$/.test(extRaw) ? extRaw : '';
      cb(null, `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${ext}`);
    },
  }),
});

// memoryStorage: a ANÁLISE do exame "não pedido" não grava nada — só lê o arquivo
// para a IA e devolve sugestões. Nada é persistido em disco antes da confirmação.
const uploadAnalise = multer({ fileFilter, storage: multer.memoryStorage() });

router.get('/animal/:animalId',   authenticate, checkPermission('atendimento.exames.ler',       'LEITURA'), ExameClinicoController.listarPorAnimal);
router.get('/:id',                authenticate, checkPermission('atendimento.exames.ler',       'LEITURA'), ExameClinicoController.obterPorId);
router.post('/',                  authenticate, checkPermission('atendimento.exames.criar',      'PROPRIO'), ExameClinicoController.criar);
// ANALISAR (exame não pedido) — entra por atendimento.exames.ler (popula contexto p/ o
// bypass do gestor); o gate REAL é no controller (slug de RESULTADO, ver comentário lá).
// Aceita VÁRIOS arquivos de uma vez (campo `arquivos`) — a IA lê cada um pela MESMA
// regra do tipo (tabela por arquivo em Lab, transcrição por arquivo em Imagem) e o
// controller funde o resultado; ver comentário em `analisarNaoPedido`.
// ⚠️ tenantRls REENTRA no contexto do tenant logo APÓS o multer — mesma armadilha de
// `/:id/resultado` abaixo: sem isto, `verificarAcessoAnimal` cai em RLS mesmo com
// req.empresaId correto.
router.post('/analisar',          authenticate, checkPermission('atendimento.exames.ler',       'LEITURA'), uploadAnalise.array('arquivos', 20), tenantRls, ExameClinicoController.analisarNaoPedido);
// CRIAR NÃO PEDIDO — cria + já realiza, sem evolucaoId (registro avulso, ver comentário
// no controller). Mesmo par de middlewares de `/:id/resultado`: entra pela LEITURA do
// pedido (contexto/bypass do gestor), o gate real é o slug de RESULTADO no controller.
router.post('/nao-pedido',        authenticate, checkPermission('atendimento.exames.ler',       'LEITURA'), uploadResultado.array('arquivos', 20), tenantRls, ExameClinicoController.criarNaoPedido);
router.put('/:id',                authenticate, checkPermission('atendimento.exames.editar',     'PROPRIO'), ExameClinicoController.atualizar);
router.patch('/:id/finalizar',    authenticate, checkPermission('atendimento.exames.finalizar',  'PROPRIO'), ExameClinicoController.finalizar);
// CARREGAR RESULTADO — entra por atendimento.exames.ler (popula contexto p/ o bypass do
// gestor); o gate REAL do resultado (exames.laboratorial.*/exames.imagem.*) é no controller.
// ⚠️ `tenantRls` REENTRA no contexto do tenant logo APÓS o multer — ver comentário em
// routes/animais.js. Sem isto, salvar o resultado cai em RLS mesmo com req.empresaId correto.
router.patch('/:id/resultado',    authenticate, checkPermission('atendimento.exames.ler',       'LEITURA'), uploadResultado.array('arquivos', 20), tenantRls, ExameClinicoController.salvarResultado);
router.delete('/:id',             authenticate, checkPermission('atendimento.exames.deletar',    'PROPRIO'), ExameClinicoController.excluir);
// EXCLUIR UMA IMAGEM do resultado — entra por atendimento.exames.ler (popula contexto
// p/ o bypass do gestor); o gate REAL (exames.laboratorial.deletar/exames.imagem.deletar,
// por tipo do exame) é no controller, mesmo padrão de `/:id/resultado`.
router.delete('/:id/imagens/:imagemId', authenticate, checkPermission('atendimento.exames.ler', 'LEITURA'), ExameClinicoController.excluirImagem);

module.exports = router;
