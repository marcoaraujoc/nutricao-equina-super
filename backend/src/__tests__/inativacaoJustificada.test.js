// backend/src/__tests__/inativacaoJustificada.test.js
//
// INATIVAR EXIGE JUSTIFICATIVA E DEIXA RASTRO — premissa de 2026-09-22.
//
// 🔴 POR QUE UM GATE, e não só a correção pontual: "inativar" está espalhado por
// ~13 controllers, cada um com o seu `toggle`, e a falha é SILENCIOSA nos dois
// sentidos. Sem o motivo, a linha da Auditoria responde "quem e quando" mas não
// "por quê" — que é a pergunta feita meses depois, quando ninguém lembra. Sem a
// chamada de auditoria, a inativação não existe em lugar nenhum: o cadastro
// simplesmente some da lista e não há o que consultar.
//
// Foi assim que Localização, Vacina (catálogo), Lote de vacina, Conta de usuário
// e Plano ficaram de fora por meses — nada quebrava, a tela funcionava, e a trilha
// só não tinha aquelas linhas.
//
// ⚠️ ATIVAR de propósito NÃO entra: reativar um cadastro é ato de correção e pedir
// justificativa ali só criaria atrito. A exceção deliberada é `toggleMembro`
// (EquipeController), que pede motivo NOS DOIS SENTIDOS — devolver acesso a uma
// pessoa é a decisão mais sensível das duas (ver o comentário lá).
//
// É varredura de CÓDIGO, grosseira de propósito: o que precisa pegar é a AUSÊNCIA
// do gate, não a semântica dele.
'use strict';

const fs   = require('fs');
const path = require('path');

const CONTROLLERS = path.join(__dirname, '..', 'controllers');

function fonte(arquivo) {
  return fs.readFileSync(path.join(CONTROLLERS, arquivo), 'utf8');
}

/** Recorta a função pelo marcador de início até o próximo marcador (ou o fim). */
function corpo(texto, de, ate) {
  const i = texto.indexOf(de);
  if (i < 0) return null;
  const f = ate ? texto.indexOf(ate, i + de.length) : -1;
  return texto.slice(i, f < 0 ? texto.length : f);
}

// Cada entrada: o arquivo, o marcador da função que inativa e o marcador do que vem
// depois dela (para recortar só o trecho relevante).
const INATIVACOES = [
  ['FornecedorController.js',          'toggleAtivo: async',   'module.exports'],
  ['PrestadorController.js',           'toggleAtivo: async',   'module.exports'],
  ['TratadorController.js',            'toggleAtivo: async',   'module.exports'],
  ['LocalizacaoAnimalController.js',   'toggleAtivo: async',   'module.exports'],
  ['ProprietarioController.js',        'toggleAtivo: async',   '// DELETE /api/cadastro/proprietarios/:id'],
  ['EstoqueController.js',             'const toggle = async', 'module.exports'],
  ['EstoqueVacinaController.js',       'const toggle = async', 'module.exports'],
  ['ProcedimentoCadastroController.js','const toggleCombo = async', 'const listarPrestadoresDaEmpresa'],
  ['ProcedimentoCadastroController.js','const toggleAtivoProprio = async', 'module.exports'],
  ['VacinaAdminController.js',         'async function toggleVacina', 'async function listarLotes'],
  ['VacinaAdminController.js',         'async function inativarLote', 'module.exports'],
  ['UserAdminController.js',           'toggleAtivo: async',   '// DELETE /api/users/:id'],
  ['PlanoController.js',               'toggle: async',        'module.exports'],
  ['ProdutoController.js',             'const toggleAtivo = async', 'module.exports'],
  ['EquipeController.js',              'toggleMembro: async',  'removerMembro:'],
];

describe('INATIVAR — justificativa obrigatória e rastro na Auditoria', () => {

  it.each(INATIVACOES)('%s · %s recorta um trecho de verdade', (arquivo, marcador, ate) => {
    // Guarda do próprio gate: função renomeada faria os testes abaixo passarem
    // vazios, e o gate viraria decoração.
    expect(corpo(fonte(arquivo), marcador, ate)).toBeTruthy();
  });

  it.each(INATIVACOES)('%s · %s lê `motivo` e recusa sem ele', (arquivo, marcador, ate) => {
    const f = corpo(fonte(arquivo), marcador, ate);
    expect(f).toMatch(/motivo/);
    // O 400 pode ser `res.status(400)` direto ou uma mensagem de obrigatoriedade —
    // o que não pode é não haver recusa nenhuma.
    expect(f).toMatch(/status\(400\)/);
    expect(f).toMatch(/obrigatório informar o motivo/i);
  });

  it.each(INATIVACOES)('%s · %s registra na Auditoria', (arquivo, marcador, ate) => {
    const f = corpo(fonte(arquivo), marcador, ate);
    expect(f).toMatch(/registrarAuditoria\(/);
  });

  it.each(INATIVACOES)('%s · %s usa a categoria INATIVACAO/ATIVACAO', (arquivo, marcador, ate) => {
    const f = corpo(fonte(arquivo), marcador, ate);
    // 🔴 A CATEGORIA É O RÓTULO EXIBIDO na tela de Auditoria (`${categoria}
    // ${entidade}`) e é o recorte dos Relatórios de Cadastro. Gravar 'ALTERACAO'
    // faz a inativação sumir de "quem foi inativado" — aconteceu com Estoque,
    // Estoque de Vacina e Combo de procedimento até 2026-09-22.
    expect(f).toMatch(/'INATIVACAO'/);
    expect(f).not.toMatch(/categoria:\s*'ALTERACAO'/);
  });

  it('o motivo CHEGA à linha de auditoria, não só à validação', (...args) => {
    // Validar e não gravar é o pior dos mundos: o usuário digita a justificativa,
    // o sistema a exige, e ela morre no meio do caminho.
    for (const [arquivo, marcador, ate] of INATIVACOES) {
      const f = corpo(fonte(arquivo), marcador, ate);
      // `motivo: <expressão>` ou o shorthand `motivo,` dentro do registrarAuditoria.
      const auditoria = f.slice(f.indexOf('registrarAuditoria('));
      expect([arquivo, /(motivo:\s*\S|\bmotivo,)/.test(auditoria)]).toEqual([arquivo, true]);
    }
  });

  it('as categorias usadas existem em lib/auditoria.js', () => {
    const lib = fs.readFileSync(path.join(__dirname, '..', 'lib', 'auditoria.js'), 'utf8');
    for (const c of ['INATIVACAO', 'ATIVACAO']) expect(lib).toMatch(new RegExp(`'${c}'`));
  });

  it('a tela de Auditoria sabe traduzir toda entidade inativável', () => {
    // Entidade sem rótulo aparece como o identificador cru ('VACINA_CATALOGO') na
    // coluna "Entidade" — legível para quem escreveu o código, não para o gestor.
    const tela = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'pages', 'AuditoriaGeral.tsx'), 'utf8');
    const entidades = new Set();
    for (const [arquivo, marcador, ate] of INATIVACOES) {
      const f = corpo(fonte(arquivo), marcador, ate);
      for (const m of f.matchAll(/entidade:\s*'([A-Z_]+)'/g)) entidades.add(m[1]);
    }
    expect(entidades.size).toBeGreaterThan(5);
    for (const e of entidades) expect([e, tela.includes(`${e}:`)]).toEqual([e, true]);
  });
});
