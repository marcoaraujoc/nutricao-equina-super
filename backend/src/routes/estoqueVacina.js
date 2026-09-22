// routes/estoqueVacina.js — estoque de lotes de vacinas por clínica
'use strict';

const router = require('express').Router();
const multer  = require('multer');
const path    = require('path');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permissao.middleware');
const { tenantRls } = require('../middlewares/tenantRls');
const ctrl = require('../controllers/EstoqueVacinaController');
const NotaFiscalController = require('../controllers/NotaFiscalController');
const { MAX_PAGINAS } = require('../services/notaFiscalService');

router.use(authenticate);

// 🔴 CARREGAR NOTA FISCAL — o MESMO recurso da Farmácia, agora no estoque de vacinas
// (a pedido, 2026-09-19). Controller e serviço são os MESMOS (`NotaFiscalController.ler`
// + `services/notaFiscalService`): uma segunda leitura de nota divergiria da primeira
// na correção seguinte, e o que divergiria é o que a IA entende por "item da nota".
// O que muda entre as duas telas é só o GATE (`vacina.estoque.criar`) e o que a tela
// faz com o resultado — a vacina fica com os itens de tipo `vacina`.
//
// A nota chega como IMAGEM (uma por página); PDF é convertido NO NAVEGADOR, como na
// Farmácia e no documento enviado à Central de Documentos.
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

// ⚠️ Gate de CRIAR (não de ler): o resultado alimenta uma ENTRADA de estoque e gasta a
// quota de IA da clínica — quem só consulta não abre o leitor.
// ⚠️ `tenantRls` REENTRA logo APÓS o multer: o parsing do busboy se intercala entre o
// `authenticate` (que carimba o tenant) e o controller, e pode fazer o
// AsyncLocalStorage não sobreviver até lá — mesma ordem de `routes/farmacia.js`.
// ⚠️ LITERAL antes de `/:id` (armadilha 1 do CLAUDE.md).
router.post('/documento-compra',
  checkPermission('vacina.estoque.criar', 'PROPRIO'),
  upload.array('paginas', MAX_PAGINAS), tenantRls, NotaFiscalController.ler);

// Catálogo auxiliar (dropdowns do formulário e catálogo com estoque)
router.get('/fabricantes',        checkPermission('vacina.estoque.ler', 'LEITURA'), ctrl.listarFabricantes);
router.get('/vacinas',            checkPermission('vacina.estoque.ler', 'LEITURA'), ctrl.listarVacinasPorFabricante);
router.get('/catalogo',           checkPermission('vacina.estoque.ler', 'LEITURA'), ctrl.listarCatalogoComEstoque);
router.get('/lotes-disponiveis',  checkPermission('vacina.estoque.ler', 'LEITURA'), ctrl.listarLotesDisponiveisPorMed);

// CRUD de lotes
router.get('/',    checkPermission('vacina.estoque.ler',    'LEITURA'), ctrl.listar);
router.post('/',   checkPermission('vacina.estoque.criar',   'PROPRIO'), ctrl.criar);
router.put('/:id', checkPermission('vacina.estoque.editar',  'PROPRIO'), ctrl.atualizar);
router.patch('/:id/ajuste', checkPermission('vacina.estoque.ajustar', 'PROPRIO'), ctrl.ajustar);
router.patch('/:id/toggle', checkPermission('vacina.estoque.deletar', 'PROPRIO'), ctrl.toggle);
router.delete('/:id', checkPermission('vacina.estoque.deletar', 'PROPRIO'), ctrl.excluir);

module.exports = router;
