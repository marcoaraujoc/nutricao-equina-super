// backend/src/__tests__/evolucaoFinalizadaFechada.test.js
//
// 🔴 EVOLUÇÃO FINALIZADA É DOCUMENTO FECHADO (2026-09-30, a pedido).
// Nada nela se altera — texto, título, anexos, relatório, aprovação, cancelamento
// ou exclusão —, nem pelo gestor, nem pelo ADMIN. Só se LÊ: visualizar, imprimir,
// WhatsApp e e-mail.
//
// Duas metades, e as duas quebram EM SILÊNCIO:
//  - BACKEND: cada rota que escreve na evolução chama `bloquearSeFinalizada`. Rota
//    nova (ou antiga "consertada") sem a guarda volta a aceitar a alteração.
//  - TELA: nenhuma ação de escrita é oferecida para a finalizada — botão que só
//    falha depois do clique é a armadilha 28-d.
//
// Varredura de código, ignorando comentários (senão o teste se satisfaz com a
// própria documentação da regra).
'use strict';

const fs   = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..', '..');
const CONTROLLER = path.join(RAIZ, 'backend', 'src', 'controllers', 'EvolucaoController.js');
const TELA       = path.join(RAIZ, 'frontend', 'src', 'pages', 'SubModuloEvolucao.tsx');
const SHELL      = path.join(RAIZ, 'frontend', 'src', 'pages', 'Atendimento.tsx');

function semComentarios(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/** Corpo de um método do objeto do controller: de `nome: async` até o próximo método. */
function metodo(src, nome) {
  const i = src.indexOf(`  ${nome}: async`);
  if (i < 0) return null;
  const resto = src.slice(i + nome.length + 10);
  const prox = resto.search(/\n {2}[a-zA-Z]+: async/);
  return prox < 0 ? resto : resto.slice(0, prox);
}

describe('backend — toda rota que escreve na evolução recusa a FINALIZADA', () => {
  const src = semComentarios(fs.readFileSync(CONTROLLER, 'utf8'));

  test('a guarda existe e responde 403 EVOLUCAO_FINALIZADA', () => {
    expect(src).toMatch(/function bloquearSeFinalizada\(/);
    expect(src).toContain("'EVOLUCAO_FINALIZADA'");
  });

  test.each([
    'atualizar', 'excluir', 'cancelar', 'aprovar',
    'salvarTitulo', 'adicionarMidia', 'removerMidia', 'salvarResumoIa',
  ])('%s chama bloquearSeFinalizada', (nome) => {
    const corpo = metodo(src, nome);
    expect(corpo).not.toBeNull();
    expect(corpo).toContain('bloquearSeFinalizada(');
  });

  test('ninguém tem passe livre: sem ramo de gestor/ADMIN para a finalizada', () => {
    expect(src).not.toMatch(/status === 'FINALIZADA' && !ehGestorNoContexto/);
    expect(src).not.toMatch(/status === 'FINALIZADA' && req\.user\.userType !== 'ADMIN'/);
  });

  test('o título em segundo plano não reescreve evolução já fechada', () => {
    expect(src).toMatch(/async function gravarTituloAssincrono\(/);
    expect(src).not.toMatch(/data:\s*\{\s*titulo:\s*tituloAssincrono\s*\}/);
  });
});

describe('tela — a finalizada só oferece Visualizar, Imprimir, WhatsApp e E-mail', () => {
  const src = semComentarios(fs.readFileSync(TELA, 'utf8'));
  const i = src.indexOf('const acoesDaEvolucao =');
  const bloco = src.slice(i, src.indexOf('\n  };', i));

  function visivelDe(rotulo) {
    const m = new RegExp(`rotulo="${rotulo}"[\\s\\S]*?visivel=\\{([^}]*)\\}`).exec(bloco);
    return m ? m[1].replace(/\s+/g, ' ') : null;
  }

  test.each(['Aprovar', 'Alterar'])('%s exige EM ANDAMENTO', (rotulo) => {
    expect(visivelDe(rotulo)).toContain('emAndamento');
  });

  test('Cancelar só pela evolução em andamento (podeCancelarPropria)', () => {
    expect(visivelDe('Cancelar')).toBe('podeCancelarPropria');
    expect(bloco).toMatch(/podeCancelarPropria = [^;]*emAndamento/);
  });

  test('nenhuma ação menciona FINALIZADA como condição de exibição', () => {
    expect(bloco).not.toMatch(/visivel=\{[^}]*FINALIZADA/);
  });

  test('formulário da finalizada abre em somente leitura', () => {
    expect(src).toMatch(/setFormLeitura\([^)]*ev\.status !== 'EM_ANDAMENTO'/);
  });

  test('relatório da finalizada não é editável', () => {
    expect(src).toMatch(/podeEditarRelatorio\s*=\s*relEv\.status === 'EM_ANDAMENTO'/);
  });

  test('anexos: adicionar e remover só com escrita liberada', () => {
    // Fonte CRUA: o `accept="image/*,video/*"` do input seria lido como início de
    // comentário `/*` pelo `semComentarios` e engoliria o trecho.
    const cru = fs.readFileSync(TELA, 'utf8');
    expect(cru).toMatch(/\{podeEscrever && <label/);
    expect(cru).toMatch(/onRemover=\{podeEscrever \?/);
  });

  test('ao finalizar, os anexos sobem ANTES do PUT FINALIZADA', () => {
    const f = src.slice(src.indexOf('const handleFinalizar'), src.indexOf('const handleCancelarEvolucao'));
    const up  = f.indexOf('uploadMidias(editingEv.id');
    const put = f.indexOf("status:        'FINALIZADA'");
    expect(up).toBeGreaterThan(-1);
    expect(up).toBeLessThan(put);
  });

  test('o shell não grava título por PATCH /titulo depois de finalizar', () => {
    const shell = semComentarios(fs.readFileSync(SHELL, 'utf8'));
    expect(shell).not.toMatch(/evolucoes\/\$\{evolucaoId\}\/titulo`/);
  });
});
