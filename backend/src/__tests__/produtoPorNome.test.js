// O NOME DIGITADO TRAZ O CADASTRO QUE JÁ EXISTE (2026-09-15).
//
// O QUE QUEBRA EM SILÊNCIO AQUI, e é por isso que o arquivo existe:
//   1. o escopo: devolver item PRIVADO de outra clínica entregaria o cadastro dela
//      preenchido na tela de quem digitou o nome — e ninguém desconfia de um
//      formulário preenchido "certo";
//   2. a precedência: com a cópia da empresa JÁ existente, carregar o GLOBAL homônimo
//      faz o salvar criar uma SEGUNDA cópia da mesma clínica;
//   3. o `NOT ILIKE` sobre classificação NULA não é verdadeiro — sem o `coalesce`, o
//      item legado de classificação nula fica FORA do recorte de medicamento e o nome
//      dele nunca é reconhecido (a armadilha já documentada em `catalogoManual`);
//   4. a rota literal depois de `/:id`: o Express leria "por-nome" como id e o
//      formulário nunca preencheria, sem erro na tela;
//   5. as duas tabelas do `translate()` com comprimentos diferentes deslocam todo o
//      resto e passam a trocar letras erradas.
'use strict';

const fs   = require('fs');
const path = require('path');

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });

const leia = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
// Comentários explicam a regra CITANDO as mesmas palavras; um gate que se satisfaz
// com a própria documentação é um gate que se aprende a ignorar.
const semComentarios = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const CONTROLLER = leia('controllers/ProdutoController.js');
const ROTAS      = leia('routes/produtos.js');
const CODIGO     = semComentarios(CONTROLLER);

// ─── 1. A CONSULTA ───────────────────────────────────────────────────────────
describe('a consulta por nome', () => {
  const sql = /SELECT m\.id[\s\S]*?LIMIT 1/.exec(CODIGO);

  test('existe e é uma consulta só, com LIMIT 1', () => {
    expect(sql).not.toBeNull();
  });

  test('ESCOPO: só o global e o da própria empresa — nunca o de outra clínica', () => {
    expect(sql[0]).toMatch(/m\.empresa_id IS NULL OR m\.empresa_id = \$1::int/);
  });

  test('a cópia da EMPRESA vence o global homônimo', () => {
    // `ASC NULLS LAST` põe o empresa_id preenchido na frente do global (NULL).
    expect(sql[0]).toMatch(/ORDER BY m\.empresa_id ASC NULLS LAST/);
  });

  test('o item INATIVO também é reconhecido — o salvar reaproveita e reativa', () => {
    expect(sql[0]).not.toMatch(/m\.ativo\s*=\s*true/);
  });

  test('classificação NULA entra no recorte de medicamento (coalesce nos dois lados)', () => {
    const ramos = sql[0].match(/coalesce\(m\.classificacao, ''\)/g) ?? [];
    expect(ramos.length).toBe(2);
  });

  test('a comparação é por translate(lower(btrim(...))), não por igualdade crua', () => {
    expect(sql[0]).toMatch(/translate\(lower\(btrim\(m\.nome\)\)/);
  });

  test('não usa unaccent() — a extensão pode não existir na base do cliente', () => {
    expect(CODIGO).not.toMatch(/unaccent\s*\(/);
  });

  test('FAIL-CLOSED sem empresa no contexto', () => {
    const corpo = /const porNome = async[\s\S]*?^};/m.exec(CODIGO)[0];
    expect(corpo).toMatch(/if \(!req\.empresaId\) return res\.json\(\{ encontrado: false \}\)/);
  });

  test('NUNCA levanta o filtro de tenant', () => {
    expect(CODIGO).not.toMatch(/comEscopoPlataforma/);
  });

  test('falha da consulta NÃO impede o cadastro — responde "não encontrado"', () => {
    const corpo = /const porNome = async[\s\S]*?^};/m.exec(CODIGO)[0];
    expect(corpo).toMatch(/catch[\s\S]*res\.json\(\{ encontrado: false \}\)/);
  });
});

// ─── 2. AS TABELAS DO translate() ────────────────────────────────────────────
describe('remoção de acento', () => {
  test('as duas cadeias têm o MESMO comprimento — uma sobra troca letras erradas', () => {
    const com = /const COM_ACENTO = '([^']+)'/.exec(CONTROLLER)[1];
    const sem = /const SEM_ACENTO = '([^']+)'/.exec(CONTROLLER)[1];
    expect([...com].length).toBe([...sem].length);
  });
});

// ─── 3. GATE ESTRUTURAL ──────────────────────────────────────────────────────
describe('os elos que somem em silêncio', () => {
  test('a rota /por-nome vem ANTES de /:id', () => {
    const porNome = ROTAS.indexOf("'/por-nome'");
    const porId   = ROTAS.search(/router\.(put|delete)\s*\(\s*'\/:id'/);
    expect(porNome).toBeGreaterThan(-1);
    expect(porId).toBeGreaterThan(-1);
    expect(porNome).toBeLessThan(porId);
  });

  test('a rota exige o slug de LEITURA de produto', () => {
    expect(ROTAS).toMatch(/'\/por-nome'[\s\S]{0,120}cadastro\.produto\.ler/);
  });

  test('o controller exporta porNome — sem isso a rota sobe quebrada', () => {
    expect(CODIGO).toMatch(/module\.exports\s*=\s*\{[^}]*porNome/);
  });

  test('a TELA consulta ao SAIR do campo, nunca por tecla digitada', () => {
    const form = semComentarios(
      fs.readFileSync(path.join(__dirname, '../../../frontend/src/components/produtos/FormProduto.tsx'), 'utf8'));
    expect(form).toMatch(/onBlur=\{\(\) => onNomeSaiu\?\.\(\)\}/);
    expect(form).not.toMatch(/onChange=\{[^}]*onNomeSaiu/);
  });

  test('a TELA só consulta no cadastro NOVO — em edição não troca o registro', () => {
    const tela = semComentarios(
      fs.readFileSync(path.join(__dirname, '../../../frontend/src/pages/Produtos.tsx'), 'utf8'));
    const corpo = /const consultarNome = useCallback[\s\S]*?\}, \[/.exec(tela)[0];
    expect(corpo).toMatch(/if \(form\.medicamentoId != null\) return;/);
    // Carga automática SÓ com o formulário vazio fora o nome: sobrescrever o que já
    // foi digitado seria perder trabalho em silêncio.
    expect(corpo).toMatch(/formSoTemNome\(form\)/);
    // setForm FUNCIONAL: a resposta chega depois, e um patch sobre a closure apagaria
    // o que foi digitado durante a espera.
    expect(tela).toMatch(/setForm\(prev => \(\{ \.\.\.formDoItem\(item\), nome: prev\.nome \}\)\)/);
  });
});
