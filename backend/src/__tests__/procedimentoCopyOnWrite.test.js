// backend/src/__tests__/procedimentoCopyOnWrite.test.js
//
// COPY-ON-WRITE NO CATÁLOGO DE PROCEDIMENTOS — premissa de 2026-09-25.
//
// 🔴 O PEDIDO: ativar/inativar um procedimento GLOBAL passou a criar uma cópia
// PRÓPRIA da clínica (o global nunca é tocado, e some da listagem dela — a cópia
// o substitui, sem duplicata). O NOME continua travado fora disso: só muda em
// procedimento que já nasceu da própria clínica.
//
// Este gate é de CÓDIGO (varredura + execução da lib pura com um Prisma falso),
// no molde de `procedimentoExclusaoSemUso.test.js` — o que precisa pegar é a
// AUSÊNCIA do fork/da exclusão da listagem, não a redação exata deles.
'use strict';

const fs   = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const leia = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');

const semComentarios = (t) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('copy-on-write do catálogo de procedimentos — varredura de código', () => {
  const ctrl = semComentarios(leia('controllers/ProcedimentoCadastroController.js'));
  const lib  = semComentarios(leia('lib/catalogoProcedimento.js'));

  test('toggleAtivoProprio forka o item GLOBAL em vez de recusar', () => {
    const trecho = ctrl.slice(ctrl.indexOf('const toggleAtivoProprio'), ctrl.indexOf('async function contarNoLedgerDoPrestador'));
    expect(trecho).toMatch(/garantirCopiaProcedimento\(tx, item, req\.empresaId\)/);
    // A recusa ANTIGA para item global saiu — o "ITEM_DO_SISTEMA" nesta função
    // seria o sinal de que o fork foi revertido para o bloqueio de antes.
    expect(trecho).not.toMatch(/ITEM_DO_SISTEMA/);
    // O update de ativo/inativo tem de ir no ALVO (a cópia, quando forkou), nunca
    // no `id` original — senão o toggle continuaria escrevendo na linha global.
    expect(trecho).toMatch(/procedimentoVeterinario\.update\(\{ where: \{ id: alvo\.id \}/);
  });

  test('atualizarProprio CONTINUA recusando nome/categoria em item global — sem mudança', () => {
    // O nome só muda em procedimento CRIADO PELA CLÍNICA: este teste é a garantia
    // de que o fork do toggle não vazou para a edição de nome/categoria.
    const trecho = ctrl.slice(ctrl.indexOf('const atualizarProprio'), ctrl.indexOf('const toggleAtivoProprio'));
    expect(trecho).toMatch(/ITEM_DO_SISTEMA/);
    expect(trecho).not.toMatch(/garantirCopiaProcedimento/);
  });

  test('listarComValores esconde o global já forkado por esta empresa', () => {
    const trecho = ctrl.slice(ctrl.indexOf('const listarComValores'), ctrl.indexOf('const definirValor'));
    expect(trecho).toMatch(/origensJaForkadas\(prisma, req\.empresaId\)/);
    expect(trecho).toMatch(/NOT: \{ empresaId: null, id: \{ in: origensForkadas \} \}/);
  });

  test('lib exporta o fork e a consulta de origens forkadas', () => {
    expect(lib).toMatch(/module\.exports = \{\s*garantirCopiaProcedimento,\s*origensJaForkadas,?\s*\}/);
  });

  test('garantirCopiaProcedimento reaproveita cópia existente (idempotente) antes de criar', () => {
    const trecho = lib.slice(lib.indexOf('async function garantirCopiaProcedimento'));
    const iExistente = trecho.indexOf('copiaExistente(tx');
    const iCreate     = trecho.indexOf('procedimentoVeterinario.create(');
    expect(iExistente).toBeGreaterThan(-1);
    expect(iCreate).toBeGreaterThan(iExistente);
  });

  test('o valor já definido pela empresa (overlay) MIGRA para a cópia por uma nova linha — nunca via valorVenda', () => {
    // `listarComValores` só lê `ProcedimentoValorEmpresa` para exibir/editar o
    // valor da empresa — gravar em `valorVenda` faria o valor sumir da tela
    // assim que a cópia nascesse (era o bug: "inativa OK, mas ao reativar perde
    // as alterações" — o valor não reaparecia porque não morava mais onde a
    // tela lê).
    const trecho = lib.slice(lib.indexOf('async function garantirCopiaProcedimento'));
    expect(trecho).toMatch(/procedimentoValorEmpresa\.findUnique/);
    expect(trecho).toMatch(/valorVenda: base\.valorVenda/);
    expect(trecho).not.toMatch(/valorVenda: override/);
    expect(trecho).toMatch(/procedimentoValorEmpresa\.create\(\{\s*data: \{ empresaId, procedimentoId: copia\.id, valor: override\.valor \}/);
    expect(trecho).toMatch(/procedimentoValorEmpresa\.delete/);
    // A cópia é criada e o UPDATE do origem_id acontece ANTES do overlay ser
    // movido — sem o id da cópia não haveria para onde mover o valor.
    const iCreate = trecho.indexOf('procedimentoVeterinario.create(');
    const iMove   = trecho.indexOf('procedimentoValorEmpresa.create(');
    expect(iCreate).toBeGreaterThan(-1);
    expect(iMove).toBeGreaterThan(iCreate);
  });

  test('origem_id é gravado por SQL cru (client pode não estar regenerado)', () => {
    const trecho = lib.slice(lib.indexOf('async function garantirCopiaProcedimento'));
    expect(trecho).toMatch(/UPDATE schs2vet\.tb_procedimentos_vet SET origem_id = \$\{base\.id\} WHERE id = \$\{copia\.id\}/);
  });

  test('reapontarParaCopiaProcedimento move prestador e itens de combo DESTA empresa para a cópia', () => {
    const trecho = lib.slice(lib.indexOf('async function reapontarParaCopiaProcedimento'), lib.indexOf('async function garantirCopiaProcedimento'));
    expect(trecho).toMatch(/procedimentoPrestador\.updateMany\(\{\s*where: \{ empresaId, procedimentoId: globalId \}/);
    expect(trecho).toMatch(/procedimentoComboItem\.updateMany\(\{\s*where: \{ procedimentoId: globalId, combo: \{ empresaId \} \}/);
    // Reapontamento é chamado dentro do fork — sem isso vínculo/combo ficam
    // pendurados no id que sai de circulação depois do fork.
    const forkTrecho = lib.slice(lib.indexOf('async function garantirCopiaProcedimento'));
    expect(forkTrecho).toMatch(/reapontarParaCopiaProcedimento\(tx, base\.id, copia\.id, empresaId\)/);
  });

  test('migration nova cria origem_id + FK + unique(empresaId, origemId)', () => {
    const sql = leia('../prisma/migrations/20261024000000_procedimento_copy_on_write/migration.sql');
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "origem_id" INTEGER/);
    expect(sql).toMatch(/REFERENCES "schs2vet"\."tb_procedimentos_vet"\("id"\)/);
    expect(sql).toMatch(/ON DELETE SET NULL/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS "tb_procedimentos_vet_empresa_id_origem_id_key"/);
  });

  test('schema.prisma declara origemId e o unique correspondente', () => {
    const schema = leia('../prisma/schema.prisma');
    const modelo = schema.slice(schema.indexOf('model ProcedimentoVeterinario'), schema.indexOf('model Vacina {'));
    expect(modelo).toMatch(/origemId\s+Int\?\s+@map\("origem_id"\)/);
    expect(modelo).toMatch(/@@unique\(\[empresaId, origemId\]\)/);
  });
});

describe('copy-on-write do catálogo de procedimentos — frontend', () => {
  const FRONT = path.join(__dirname, '..', '..', '..', 'frontend', 'src');
  const tela  = fs.readFileSync(path.join(FRONT, 'pages', 'CadastroProcedimento.tsx'), 'utf8');

  test('a chave ativar/inativar deixou de exigir p.daEmpresa — vale também no item do sistema', () => {
    expect(tela).toMatch(/tom="ativar"[\s\S]{0,120}visivel=\{podeExcluir\}/);
  });

  test('Excluir (hard delete) CONTINUA restrito ao procedimento DA CLÍNICA', () => {
    expect(tela).toMatch(/tom="cancelar" icone=\{Trash2\} rotulo="Excluir"\s*\n\s*visivel=\{podeExcluir && p\.daEmpresa\}/);
  });

  test('o toast avisa quando o toggle criou uma cópia (copiado: true)', () => {
    expect(tela).toMatch(/res\.data\?\.copiado/);
  });
});
