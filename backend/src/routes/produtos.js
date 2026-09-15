'use strict';
// Cadastro > PRODUTOS — prefixo /api/cadastro/produtos
//
// A tela da CLÍNICA para cadastrar medicamento e vacina, dizer de quem ela compra e
// (opcionalmente) dar entrada no estoque. Ver o cabeçalho de `ProdutoController`.

const express = require('express');
const multer  = require('multer');
const path    = require('path');

const ProdutoController   = require('../controllers/ProdutoController');
const NotaFiscalController = require('../controllers/NotaFiscalController');
const { authenticate }    = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permissao.middleware');
const { tenantRls }       = require('../middlewares/tenantRls');
const { MAX_PAGINAS }     = require('../services/notaFiscalService');

// A nota chega como IMAGEM (uma por página). PDF é convertido no NAVEGADOR, como o
// documento enviado à Central — ver `modules/documentos/upload.ts`. Motivo: aqui o
// arquivo só existe para ser LIDO pela IA, e converter no cliente evita subir
// megabytes e manter um segundo caminho de renderização no servidor.
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 15 * 1024 * 1024 },
  // Extensão E mimetype: validar só o mimetype aceita um .svg renomeado, e SVG é
  // HTML executável (o XSS armazenado da varredura de 2026-06-11).
  fileFilter: (_req, file, cb) => {
    const permitido = /jpeg|jpg|png|webp/;
    cb(null, permitido.test(path.extname(file.originalname).toLowerCase()) && permitido.test(file.mimetype));
  },
});

const router = express.Router();

// ⚠️ Literais ANTES de /:id (armadilha 1 do CLAUDE.md).
router.get('/catalogo', authenticate, checkPermission('cadastro.produto.ler', 'LEITURA'), ProdutoController.listarCatalogo);

// O item escolhido no seletor traz o que a clínica JÁ tem cadastrado dele — catálogo
// + vínculos de fornecedor — para o formulário abrir preenchido e editável.
router.get('/detalhe', authenticate, checkPermission('cadastro.produto.ler', 'LEITURA'), ProdutoController.detalhe);

// Leitura da NOTA FISCAL. Gate de CRIAR: o resultado alimenta um cadastro, e quem só
// pode ver produtos não tem por que gastar a quota de IA da clínica.
// ⚠️ `tenantRls` REENTRA logo APÓS o multer: o parsing do busboy se intercala entre o
// `authenticate` (que carimba o tenant) e o controller, e pode fazer o
// AsyncLocalStorage não sobreviver até lá — mesma ordem de `routes/documentos.js`.
router.post('/nota-fiscal', authenticate, checkPermission('cadastro.produto.criar', 'PROPRIO'),
  upload.array('paginas', MAX_PAGINAS), tenantRls, NotaFiscalController.ler);

router.get   ('/',    authenticate, checkPermission('cadastro.produto.ler',    'LEITURA'), ProdutoController.listar);
router.post  ('/',    authenticate, checkPermission('cadastro.produto.criar',   'PROPRIO'), ProdutoController.criar);
router.put   ('/:id', authenticate, checkPermission('cadastro.produto.editar',  'PROPRIO'), ProdutoController.atualizar);
router.delete('/:id', authenticate, checkPermission('cadastro.produto.deletar', 'PROPRIO'), ProdutoController.excluir);

module.exports = router;
