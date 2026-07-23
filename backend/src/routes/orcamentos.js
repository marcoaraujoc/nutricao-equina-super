// backend/src/routes/orcamentos.js
'use strict';

const express             = require('express');
const router              = express.Router();
const OrcamentoController  = require('../controllers/OrcamentoController');
const { authenticate }    = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permissao.middleware');

// Literais ANTES de /:id
router.get('/proprietarios',              authenticate, checkPermission('orcamento.orcamentos.ler', 'LEITURA'), OrcamentoController.listarProprietarios);
router.get('/proprietario/:id/animais',   authenticate, checkPermission('orcamento.orcamentos.ler', 'LEITURA'), OrcamentoController.listarAnimaisDoProprietario);
router.get('/para-importar',              authenticate, checkPermission('orcamento.orcamentos.ler', 'LEITURA'), OrcamentoController.listarParaImportar);
router.post('/importar',                  authenticate, checkPermission('orcamento.orcamentos.ler', 'LEITURA'), OrcamentoController.marcarImportados);

// Itens "Outros" → fatura. A leitura segue o orçamento; o lançamento é ação do
// financeiro, então usa a permissão de lançar cobrança na fatura.
router.get('/outros-para-fatura', authenticate, checkPermission('orcamento.orcamentos.ler',  'LEITURA'), OrcamentoController.listarOutrosParaFatura);
router.post('/lancar-na-fatura',  authenticate, checkPermission('financeiro.faturas.lancar', 'PROPRIO'), OrcamentoController.lancarNaFatura);

router.get('/',            authenticate, checkPermission('orcamento.orcamentos.ler',     'LEITURA'), OrcamentoController.listar);
router.post('/',           authenticate, checkPermission('orcamento.orcamentos.criar',   'PROPRIO'), OrcamentoController.criar);
router.get('/:id',         authenticate, checkPermission('orcamento.orcamentos.ler',     'LEITURA'), OrcamentoController.obterPorId);
router.put('/:id',         authenticate, checkPermission('orcamento.orcamentos.editar',  'PROPRIO'), OrcamentoController.atualizar);
router.post('/:id/decidir', authenticate, checkPermission('orcamento.orcamentos.aprovar', 'PROPRIO'), OrcamentoController.decidir);
// Envio do PDF ao cliente — mesma permissão da leitura/impressão do orçamento
router.post('/:id/enviar-whatsapp', authenticate, checkPermission('orcamento.orcamentos.ler', 'LEITURA'), OrcamentoController.enviarWhatsApp);
router.delete('/:id',      authenticate, checkPermission('orcamento.orcamentos.deletar', 'PROPRIO'), OrcamentoController.excluir);

module.exports = router;
