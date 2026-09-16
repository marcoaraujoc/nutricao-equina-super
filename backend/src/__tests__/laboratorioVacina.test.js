'use strict';

/**
 * LABORATÓRIO NO ESTOQUE DE VACINAS (2026-09-15)
 *
 * 🔴 POR QUE ESTE GATE EXISTE: o laboratório da vacina NÃO TEM TABELA PRÓPRIA — ele é
 * texto na coluna `fabricante` de `tb_medicamentos` mais, agora, uma entrada do catálogo
 * genérico `tb_catalogo_tipo_servico` (categoria LABORATORIO). Nada aqui quebra com
 * erro: as três regras abaixo falham em SILÊNCIO, devolvendo uma lista plausível.
 *
 *   1. A SENTINELA de "Outros" tem de ser a MESMA nos dois lados. Divergindo, a tela
 *      pede `__SEM_FABRICANTE__` e o backend procura um laboratório com esse NOME —
 *      resultado: "Outros" devolve lista vazia, e a pessoa conclui que não há vacina
 *      sem laboratório (medido: há 52 nesta base).
 *
 *   2. O VAZIO conta como ausente, não só o NULL. O campo Fabricante do cadastro é
 *      opcional e grava string vazia quando alguém passa por ele sem digitar. Olhando
 *      só o NULL, essas vacinas ficam fora de "Outros" E de todo laboratório —
 *      alcançáveis apenas por "Todos", que é exatamente o problema que "Outros" veio
 *      resolver.
 *
 *   3. A UNIÃO das duas fontes. Se `listarFabricantes` voltar a ler só a coluna da
 *      vacina, o laboratório cadastrado na tela some no primeiro refresh — o cadastro
 *      "funciona", grava no banco, e não aparece em lugar nenhum.
 */

const fs   = require('fs');
const path = require('path');

const lerBack  = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const lerFront = (rel) =>
  fs.readFileSync(path.join(__dirname, '..', '..', '..', 'frontend', 'src', rel), 'utf8');

/** Descarta comentários: um gate satisfeito pela própria documentação da regra é um
 *  gate que se aprende a ignorar. */
const semComentarios = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SENTINELA = '__SEM_FABRICANTE__';

// ─────────────────────────────────────────────────────────────────────────────
// 1. O catálogo genérico aceita a categoria nova
// ─────────────────────────────────────────────────────────────────────────────
describe('laboratório entra no catálogo genérico, sem tabela nova', () => {
  const src = semComentarios(lerBack('controllers/CatalogoTipoServicoController.js'));

  it("LABORATORIO é categoria válida", () => {
    expect(src).toMatch(/CATEGORIAS_VALIDAS = \[[^\]]*'LABORATORIO'[^\]]*\]/);
  });

  it('e tem gate próprio — categoria sem slug seria 403 em todo cadastro', () => {
    // `SLUG_CRIAR[categoria]` undefined faz `getNivelEfetivo` devolver NENHUM: a opção
    // aparece na tela e nunca grava, sem dizer por quê.
    expect(src).toMatch(/LABORATORIO: 'vacina\.estoque\.criar'/);
  });

  it('NÃO usa o slug do catálogo global, que é ADMIN-only', () => {
    // `medicamentos.catalogo.*` é do ADMIN da plataforma (catálogo GLOBAL). Usá-lo aqui
    // deixaria a opção morta para toda clínica.
    expect(src).not.toMatch(/LABORATORIO: 'medicamentos\./);
  });

  it('o nome cabe na coluna — VARCHAR(100), validado antes do INSERT', () => {
    // Estourar o limite não dá erro de validação: dá `22001 value too long` do Postgres,
    // a armadilha do status VARCHAR(20) registrada no CLAUDE.md.
    expect(src).toMatch(/nome\.length > 100/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. "Outros" — a sentinela e o que conta como "sem laboratório"
// ─────────────────────────────────────────────────────────────────────────────
describe('opção "Outros" (vacina sem laboratório informado)', () => {
  const back  = semComentarios(lerBack('controllers/EstoqueVacinaController.js'));
  const front = semComentarios(lerFront('pages/EstoqueVacina.tsx'));

  it('a sentinela é a MESMA nos dois lados', () => {
    expect(back).toMatch(new RegExp(`SEM_FABRICANTE = '${SENTINELA}'`));
    expect(front).toMatch(new RegExp(`SEM_FABRICANTE = '${SENTINELA}'`));
  });

  it('o VAZIO conta como ausente, não só o NULL', () => {
    // Nos DOIS ramos da consulta (com e sem recorte por espécie).
    expect(back).toMatch(/m\.fabricante IS NULL OR btrim\(m\.fabricante\) = ''/);
    expect(back).toMatch(/fabricante IS NULL OR btrim\(fabricante\) = ''/);
  });

  it('a sentinela NÃO vai como parâmetro da consulta', () => {
    // Mandá-la como texto procuraria um laboratório chamado `__SEM_FABRICANTE__` e
    // "Outros" devolveria lista vazia.
    expect(back).toMatch(/const semFab = fabricante === SEM_FABRICANTE;/);
    expect(back).toMatch(/const params = \(!semFab && fabricante\)/);
    expect(back).toMatch(/const params {4}= \(!semFab && fabricante\)/);
  });

  it('a opção só é oferecida quando há o que filtrar', () => {
    // Opção que não filtra nada é botão morto — a mesma regra da aba vazia.
    expect(back).toMatch(/semFabricante: await existeVacinaSemFabricante\(especiesIds\)/);
    expect(front).toMatch(/\{temSemFabricante && \(/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. A lista de laboratórios é a UNIÃO das duas fontes
// ─────────────────────────────────────────────────────────────────────────────
describe('lista de laboratórios', () => {
  const back  = semComentarios(lerBack('controllers/EstoqueVacinaController.js'));
  const front = semComentarios(lerFront('pages/EstoqueVacina.tsx'));

  it('une o que está nas vacinas com o catálogo da clínica', () => {
    // Sem o catálogo, o laboratório cadastrado na tela some no primeiro refresh.
    // ⚠️ Exige a CHAMADA dentro da união, não a definição da função: `labsDoCatalogo`
    // continuaria declarada (e o gate passaria) com a chamada removida da lista.
    expect(back).toMatch(/\[\.\.\.rows\.map\(r => r\.fabricante\), \.\.\.\(await labsDoCatalogo\(\)\)\]/);
    expect(back).toMatch(/categoria = \$1/);
  });

  it('a leitura do catálogo NÃO lança — recurso acessório não derruba o estoque', () => {
    const trecho = back.slice(back.indexOf('async function labsDoCatalogo'));
    expect(trecho.slice(0, 600)).toMatch(/catch \{\s*return \[\];/);
  });

  it('deduplica sem olhar a caixa', () => {
    // 'Zoetis' e 'ZOETIS' são o mesmo laboratório; duas linhas iguais no seletor fariam
    // a pessoa escolher uma ao acaso.
    expect(back).toMatch(/toLocaleLowerCase\('pt-BR'\)/);
  });

  it('o laboratório digitado no cadastro da vacina já aparece no seletor', () => {
    // A lista só é recarregada em `carregarLotes`; sem isto o nome recém-digitado no
    // modal só apareceria depois de recarregar a tela.
    expect(front).toMatch(/const labNovo = \(item\.fabricante \?\? ''\)\.trim\(\);/);
    expect(front).toMatch(/setFabricantes\(prev => \(/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Cadastrar laboratório pela tela — um só caminho de escrita
// ─────────────────────────────────────────────────────────────────────────────
describe('cadastro de laboratório na tela de estoque', () => {
  const front  = semComentarios(lerFront('pages/EstoqueVacina.tsx'));
  const seletor = semComentarios(lerFront('components/TipoServicoSelect.tsx'));

  it('grava pelo MESMO POST dos demais tipos do catálogo', () => {
    // Duas chamadas divergiriam no QUE ENTRA no catálogo da clínica (armadilha 28-g).
    expect(front).toMatch(/criarTipoCatalogo\('LABORATORIO', nome\)/);
    expect(front).not.toMatch(/api\.post\('\/cadastro\/tipos-servico'/);
    expect(seletor).toMatch(/export async function criarTipoCatalogo/);
    expect(seletor).toMatch(/const criado = await criarTipoCatalogo\(categoria, nome\)/);
  });

  it('reusa o campo de texto do "+ Adicionar novo"', () => {
    expect(seletor).toMatch(/export function NovoTipoInput/);
    expect(front).toMatch(/<NovoTipoInput/);
  });

  it('a opção de cadastrar é só da TELA — nunca vira filtro no backend', () => {
    // `__novo_lab__` abre o campo de texto; mandá-lo ao backend procuraria um
    // laboratório com esse nome e a lista de vacinas voltaria vazia.
    expect(front).toMatch(/OPCAO_NOVO_LAB = '__novo_lab__'/);
    expect(front).toMatch(/if \(e\.target\.value === OPCAO_NOVO_LAB\) \{ setAdicionandoLab\(true\); return; \}/);
    expect(semComentarios(lerBack('controllers/EstoqueVacinaController.js'))).not.toMatch(/__novo_lab__/);
  });
});
