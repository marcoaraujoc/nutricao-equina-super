// backend/src/routes/farmacia.js
'use strict';

const express           = require('express');
const multer            = require('multer');
const path              = require('path');
const router            = express.Router();
const EstoqueController = require('../controllers/EstoqueController');
const NotaFiscalController = require('../controllers/NotaFiscalController');
const { authenticate }  = require('../middlewares/auth');
const { exigirEmpresaAtiva } = require('../middlewares/empresaAtiva.middleware');
const { checkPermission } = require('../middlewares/permissao.middleware');
const { tenantRls }     = require('../middlewares/tenantRls');
const { MAX_PAGINAS }   = require('../services/notaFiscalService');

// 🔴 LEITURA DO DOCUMENTO DE COMPRA — DE VOLTA, e agora na FARMÁCIA (a pedido,
// 2026-09-18). Ela existia em `/cadastro/produtos/nota-fiscal` e foi desmontada em
// 2026-09-15, quando a tela de Produtos passou a cadastrar o ITEM e não a compra —
// o controller e o serviço ficaram inteiros de propósito, com o bilhete dizendo
// "provavelmente na Farmácia, que é quem trata de compra". É exatamente aqui.
// A volta custou esta rota; se tivessem sido apagados, custaria a reconstrução.
//
// A nota chega como IMAGEM (uma por página). PDF é convertido NO NAVEGADOR, como o
// documento enviado à Central (`modules/documentos/upload.ts`): o arquivo só existe
// para ser LIDO pela IA, e converter no cliente evita subir megabytes e manter um
// segundo caminho de renderização no servidor.
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

// Gate de CRIAR (não de ler): o resultado alimenta uma ENTRADA de estoque, e quem só
// pode consultar o estoque não tem por que gastar a quota de IA da clínica.
// ⚠️ `tenantRls` REENTRA logo APÓS o multer: o parsing do busboy se intercala entre o
// `authenticate` (que carimba o tenant) e o controller, e pode fazer o
// AsyncLocalStorage não sobreviver até lá — mesma ordem de `routes/documentos.js`.
// ⚠️ LITERAL antes de `/estoque/:id` (armadilha 1 do CLAUDE.md).
router.post('/estoque/documento-compra', authenticate,
  checkPermission('farmacia.estoque.criar', 'PROPRIO'),
  upload.array('paginas', MAX_PAGINAS), tenantRls, NotaFiscalController.ler);

// Movimentos (rotas estáticas antes das parametrizadas)
router.get('/estoque/movimentos/:id', authenticate, checkPermission('farmacia.movimentacoes.ler', 'LEITURA'), EstoqueController.listarMovimentos);

// CRUD de estoque por clínica
// Sem empresa resolvida o `where` do estoque perde o filtro e lista o de todas as
// clínicas (EstoqueController.listar linhas 93-94).
router.get('/estoque',         authenticate, checkPermission('farmacia.estoque.ler',    'LEITURA'), exigirEmpresaAtiva, EstoqueController.listar);
router.get('/estoque/:id',     authenticate, checkPermission('farmacia.estoque.ler',    'LEITURA'), EstoqueController.obterPorId);
router.post('/estoque',        authenticate, checkPermission('farmacia.estoque.criar',   'PROPRIO'), EstoqueController.criar);
router.put('/estoque/:id',     authenticate, checkPermission('farmacia.estoque.editar',  'PROPRIO'), EstoqueController.atualizar);
router.delete('/estoque/:id',  authenticate, checkPermission('farmacia.estoque.deletar', 'PROPRIO'), EstoqueController.excluir);
router.patch('/estoque/:id/toggle', authenticate, checkPermission('farmacia.estoque.deletar', 'PROPRIO'), EstoqueController.toggle);
router.patch('/estoque/:id/ajuste', authenticate, checkPermission('farmacia.estoque.ajustar', 'PROPRIO'), EstoqueController.ajustarEstoque);

module.exports = router;
