// backend/src/routes/fatura.js

const express = require('express');
const router  = express.Router();
const Ctrl    = require('../controllers/FaturaController');
const { authenticate }    = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permissao.middleware');
const { exigirAcessoAnimal } = require('../middlewares/animalAcesso.middleware');

// Listagem e consulta por proprietário
router.get('/proprietarios',                   authenticate, checkPermission('financeiro.faturas.ler',    'LEITURA'), Ctrl.listarProprietarios);
router.get('/proprietario/:proprietarioId',    authenticate, checkPermission('financeiro.faturas.ler',    'LEITURA'), Ctrl.obterFaturaProprietario);
router.get('/proprietario/:proprietarioId/logo-empresa', authenticate, checkPermission('financeiro.faturas.ler', 'LEITURA'), Ctrl.obterLogoEmpresaProprietario);

// Catálogo de itens frequentes (reutilizáveis em novas faturas)
router.get('/catalogo-itens',        authenticate, checkPermission('financeiro.faturas.ler',   'LEITURA'), Ctrl.listarCatalogo);
router.post('/catalogo-itens',       authenticate, checkPermission('financeiro.faturas.criar', 'PROPRIO'), Ctrl.criarItemCatalogo);
router.delete('/catalogo-itens/:id', authenticate, checkPermission('financeiro.faturas.criar', 'PROPRIO'), Ctrl.excluirItemCatalogo);

// Itens
router.post('/:faturaId/itens',  authenticate, checkPermission('financeiro.faturas.criar',  'PROPRIO'), Ctrl.adicionarItem);
router.put('/itens/:itemId',     authenticate, checkPermission('financeiro.faturas.editar', 'PROPRIO'), Ctrl.atualizarItem);
router.delete('/itens/:itemId',  authenticate, checkPermission('financeiro.faturas.editar', 'EQUIPE'),  Ctrl.removerItem);

// Link público (WhatsApp/e-mail) — reusa o slug de WhatsApp para os dois
// canais: "compartilhar a fatura para fora da clínica" é a mesma ação, e não
// existe slug próprio de e-mail no catálogo de permissões.
router.post('/:faturaId/enviar-whatsapp', authenticate, checkPermission('financeiro.faturas.whatsapp', 'PROPRIO'), Ctrl.enviarLinkWhatsapp);
router.post('/:faturaId/enviar-email',    authenticate, checkPermission('financeiro.faturas.whatsapp', 'PROPRIO'), Ctrl.enviarLinkEmail);

// Histórico/gestão dos links já enviados — mesmo slug (é a mesma ação de
// "compartilhar a fatura para fora da clínica").
router.get('/:faturaId/links',                    authenticate, checkPermission('financeiro.faturas.whatsapp', 'PROPRIO'), Ctrl.listarLinks);
router.patch('/:faturaId/links/:linkId/revogar',  authenticate, checkPermission('financeiro.faturas.whatsapp', 'PROPRIO'), Ctrl.revogarLink);

// Fechamento em lote — fecha todas as faturas ABERTAS de um mês (IDs no body)
router.post('/fechar-lote', authenticate, checkPermission('financeiro.faturas.fechar', 'EQUIPE'), Ctrl.fecharFaturasLote);

// Fechamento de fatura (adiciona assistência mensal + status FECHADA)
router.patch('/:faturaId/fechar', authenticate, checkPermission('financeiro.faturas.fechar', 'PROPRIO'), Ctrl.fecharFatura);

// Status da fatura (uso geral: PAGA, ABERTA, CANCELADA)
//
// 🔴 NIVEL 'PROPRIO', NAO 'EQUIPE' (2026-09-04). Exigir EQUIPE aqui devolvia 403
// para quem via o botao: o seed da VETERINARIO **PROPRIO** em
// `financeiro.faturas.editar`, e o front libera "Marcar como Pago" com qualquer
// nivel a partir de LEITURA (`podeExecutar` sem minimo). Resultado relatado:
// clicar em Marcar como Pago dava "Erro ao atualizar status", sem dizer o motivo.
// ⚠️ O nivel PROPRIO nao vira EQUIPE sozinho: o `PermCheck` do Controle de Acesso
// e BINARIO (NENHUM -> EQUIPE -> NEGADO), entao o valor PROPRIO so existe em
// perfil que NUNCA foi tocado na tela — exatamente o caso comum. Rota que exija
// EQUIPE nasce quebrada para o padrao do seed.
// ⚠️ PROPRIO tambem e o nivel de `adicionarItem`, `atualizarItem` e `fecharFatura`:
// marcar como paga nao pode ser mais restrito que FECHAR a fatura.
// A protecao que importa continua no controller — sair de PAGA e' ato de GESTOR
// (`ehGestorNoContexto`) e vai para a auditoria.
router.patch('/:faturaId/status', authenticate, checkPermission('financeiro.faturas.editar', 'PROPRIO'), Ctrl.atualizarStatus);

// Legado
router.get('/animal/:animalId',   authenticate, checkPermission('financeiro.faturas.ler',    'LEITURA'), exigirAcessoAnimal(), Ctrl.obterFaturaAberta);

module.exports = router;