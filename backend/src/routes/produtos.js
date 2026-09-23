'use strict';
// Cadastro > PRODUTOS — prefixo /api/cadastro/produtos
//
// A tela da CLÍNICA para cadastrar o ITEM que ela usa: medicamento e vacina, com
// forma farmacêutica, apresentação, unidade, via, controlado e doses por embalagem.
// Ver o cabeçalho de `ProdutoController`.
//
// ⚠️ A LEITURA DO DOCUMENTO DE COMPRA saiu desta tela a pedido (2026-09-15), junto de
// fornecedor, nota fiscal e preços. A rota `/nota-fiscal` foi REMOVIDA daqui porque
// ficaria sem nenhum chamador; `NotaFiscalController` e `services/notaFiscalService`
// continuam no projeto e podem ser montados de novo em uma linha se a leitura voltar
// a ser pedida (provavelmente na Farmácia, que é quem trata de compra).

const express = require('express');

const ProdutoController   = require('../controllers/ProdutoController');
const { authenticate }    = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permissao.middleware');

const router = express.Router();

// ⚠️ Literais ANTES de /:id (armadilha 1 do CLAUDE.md).
// O item escolhido na busca traz o que a clínica já tem cadastrado dele, para o
// formulário abrir preenchido e editável.
router.get('/detalhe', authenticate, checkPermission('cadastro.produto.ler', 'LEITURA'), ProdutoController.detalhe);
// O NOME digitado no formulário traz o cadastro que já existe (global + o da clínica):
// sem isso a pessoa redigita o que o sistema tem e nasce um item divergente do global
// com o mesmo nome. Também LITERAL, antes de /:id.
router.get('/por-nome', authenticate, checkPermission('cadastro.produto.ler', 'LEITURA'), ProdutoController.porNome);

router.get   ('/',    authenticate, checkPermission('cadastro.produto.ler',    'LEITURA'), ProdutoController.listar);
router.post  ('/',    authenticate, checkPermission('cadastro.produto.criar',   'PROPRIO'), ProdutoController.criar);
router.put   ('/:id', authenticate, checkPermission('cadastro.produto.editar',  'PROPRIO'), ProdutoController.atualizar);
router.delete('/:id', authenticate, checkPermission('cadastro.produto.deletar', 'PROPRIO'), ProdutoController.excluir);
// ATIVAR/INATIVAR — o que a tela oferece desde 2026-09-22, no lugar do "Excluir".
// ⚠️ Mesmo slug do `deletar`: inativar É a exclusão lógica deste cadastro, e quem
// pode tirá-lo da frente é quem pode reativá-lo — criar um slug novo faria o gestor
// configurar duas permissões para um par de ações que é um só.
router.patch('/:id/toggle', authenticate, checkPermission('cadastro.produto.deletar', 'PROPRIO'), ProdutoController.toggleAtivo);

module.exports = router;
