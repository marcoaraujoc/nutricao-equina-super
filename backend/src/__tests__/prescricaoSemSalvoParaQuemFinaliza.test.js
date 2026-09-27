'use strict';

/**
 * QUEM PODE FINALIZAR NUNCA FICA COM PRESCRIÇÃO "SALVA" (2026-09-26, a pedido).
 *
 *   com a permissão de finalizar → botão "Finalizar": grava E finaliza.
 *   sem a permissão              → botão "Salvar": grava SALVO; quem pode finaliza depois.
 *
 * Três pontos quebram em silêncio, e cada um devolveria o SALVO a quem não deveria vê-lo:
 *   1. o rótulo do botão (era sempre "Finalizar", mesmo quando só salvava);
 *   2. o estoque conferido DEPOIS de criar — cancelar o alerta deixava o documento SALVO;
 *   3. reabrir para alterar e sair sem finalizar.
 */

const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..', '..', '..');
const ler = (rel) => fs.readFileSync(path.join(raiz, rel), 'utf8');
const semComentarios = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const tela = semComentarios(ler('frontend/src/pages/SubModuloPrescricao.tsx'));

describe('botão do formulário de prescrição', () => {
  it('chama-se Finalizar só para quem pode finalizar; para os demais, Salvar', () => {
    expect(tela).toMatch(/const rotuloGravar = canFinalizarCancelar \? 'Finalizar' : 'Salvar';/);
    // os dois lugares onde o botão é desenhado usam o rótulo — nenhum "Finalizar" fixo
    expect((tela.match(/\{rotuloGravar\}/g) ?? []).length).toBe(2);
  });
});

describe('estoque conferido ANTES de criar', () => {
  it('o formulário checa o estoque antes do POST que cria a prescrição', () => {
    const i = tela.indexOf("api.post('/clinica/prescricoes/grupos/verificar-estoque'");
    // o POST que CRIA vem depois da checagem, no mesmo ramo de criação
    const j = tela.indexOf("api.post('/clinica/prescricoes/grupos', { animalId, evolucaoId, itens: semRastreio(itens) })", i);
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    // quem já viu o alerta e mandou seguir não é checado de novo
    expect(tela).toMatch(/if \(!forcar\) \{\s*const chk = await api\.post\('\/clinica\/prescricoes\/grupos\/verificar-estoque'/);
  });

  it('a rota existe, com a permissão de FINALIZAR', () => {
    const rotas = ler('backend/src/routes/prescricoes.js');
    const r = rotas.indexOf("router.post('/grupos/verificar-estoque'");
    expect(r).toBeGreaterThan(-1);
    expect(rotas.slice(r, rotas.indexOf('\n', r))).toContain("checkPermission('atendimento.prescricoes.finalizar', 'PROPRIO')");
  });

  it('usa a MESMA verificação do finalizar e não grava nada', () => {
    const ctrl = semComentarios(ler('backend/src/controllers/PrescricaoGrupoController.js'));
    const i = ctrl.indexOf('const verificarEstoque = async');
    const corpo = ctrl.slice(i, ctrl.indexOf('const finalizar = async', i));
    expect(corpo).toContain('verificarDisponibilidade(itens, null,');
    expect(corpo).not.toMatch(/\$transaction|\.create\(|\.update\(|registrarAuditoria|criarReservas/);
  });
});

describe('reabrir e sair sem finalizar', () => {
  it('a prescrição reaberta nesta tela é finalizada de novo ao fechar a edição', () => {
    expect(tela).toMatch(/reabertaRef\.current = g\.id;/);
    const i = tela.indexOf('const fecharModal = async');
    const corpo = tela.slice(i, i + 900);
    expect(corpo).toContain('if (!id || !canFinalizarCancelar) return;');
    expect(corpo).toContain("!== 'SALVO') return;");
    expect(corpo).toContain('forcarFinalizacao: true');
  });
});
