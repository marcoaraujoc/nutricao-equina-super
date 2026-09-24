'use strict';

/**
 * 🔴 A ABA "PRESTADOR" DO ENCAMINHAMENTO LISTA O CADASTRO, NÃO A EQUIPE (2026-09-23).
 *
 * Até aqui `listarPrestadores` varria `MembroEquipe` e devolvia duas coisas misturadas.
 * Os dois defeitos que isso produzia quebram EM SILÊNCIO — a tela mostra uma lista
 * plausível, só que com as pessoas erradas:
 *
 *   1. O prestador cadastrado SEM acesso ao sistema não existia no seletor.
 *      `MembroEquipe` só nasce quando há login (`PrestadorController` →
 *      `provisionarLogin`), e o ferrador/quiroprata cadastrado sem login simplesmente
 *      não aparecia. Ninguém via erro: via uma lista curta.
 *   2. O VETERINÁRIO da própria equipe entrava na lista, por `UsuarioEspecialidade`.
 *      A pergunta da aba é "que serviço este prestador presta", e quem responde isso é
 *      o `tipo_servico` do CADASTRO.
 *
 * ⚠️ FORNECEDOR entra junto de PRESTADOR de propósito: o cargo `PRESTADOR` nasceu em
 * 2026-09-09 e NADA foi migrado (CLAUDE.md §4) — quem já estava cadastrado segue em
 * `tb_fornecedores`. Ler só `tb_prestadores` sumiria com a maior parte da base, de novo
 * sem erro nenhum.
 *
 * ⚠️ O QUE NÃO MUDOU: a `DesignacaoPrestador` continua sendo do LOGIN. Designação é
 * ESCOPO DE ACESSO — sem usuário não há a quem dar acesso. Encaminhar para prestador
 * sem login grava o registro clínico e NÃO libera o paciente, e a tela diz isso ANTES
 * de salvar (prometer acesso que não acontece é pior que não oferecer o destino).
 */

const fs   = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler  = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const lerFront = (rel) =>
  fs.readFileSync(path.join(RAIZ, '..', '..', 'frontend', 'src', rel), 'utf8');

/** Comentário não é código — ver a nota em `execucaoSemTravas.test.js`. */
const semComentarios = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Recorta um método do objeto do controller (`nome: async (req, res) => {`). */
function corpoDoMetodo(src, nome) {
  const i = src.indexOf(`${nome}: async (req, res)`);
  expect(i).toBeGreaterThan(-1);
  const abre = src.indexOf('{', src.indexOf(')', i));
  let nivel = 0;
  for (let p = abre; p < src.length; p++) {
    if (src[p] === '{') nivel++;
    if (src[p] === '}') { nivel--; if (nivel === 0) return src.slice(abre, p + 1); }
  }
  throw new Error(`corpo de ${nome} nao fechou`);
}

const CTRL = semComentarios(ler('controllers/EncaminhamentoController.js'));
const LIB  = semComentarios(ler('lib/encaminhamentoPrestador.js'));
const TELA = semComentarios(lerFront('pages/SubModuloEncaminhamento.tsx'));

describe('a lista de destino vem dos CADASTROS de prestador', () => {
  const listar = corpoDoMetodo(CTRL, 'listarPrestadores');

  test('le as DUAS tabelas de cadastro', () => {
    expect(listar).toMatch(/prisma\.prestador\.findMany/);
    expect(listar).toMatch(/prisma\.fornecedor\.findMany/);
  });

  test('nao varre mais a equipe nem o catalogo de especialidade do usuario', () => {
    expect(listar).not.toMatch(/membroEquipe\.findMany/);
    expect(listar).not.toMatch(/usuarioEspecialidade|fornecedorEspecialidade/);
    // O veterinario entrava por aqui.
    expect(listar).not.toMatch(/cargo: 'VETERINARIO'/);
  });

  test('a especialidade sai do `tipoServico` do cadastro', () => {
    expect(listar).toMatch(/String\(b\.tipoServico \?\? ''\)/);
  });

  test('e escopado a empresa do contexto, e so cadastro ATIVO', () => {
    expect(listar).toMatch(/ativo: true, tipoEntrada: 'CLIENTE', empresaId: req\.empresaId/);
  });

  test('quem so vende (loja, laboratorio, farmacia) some da lista', () => {
    expect(listar).toMatch(/EXCLUIR_SERVICOS/);
    expect(listar).toMatch(/if \(servicos\.length === 0\) continue;/);
  });

  test('o payload endereca o CADASTRO e diz se ha login', () => {
    expect(listar).toMatch(/cadastroId:\s+b\.id/);
    expect(listar).toMatch(/cadastroOrigem: b\.origem/);
    expect(listar).toMatch(/temAcesso,/);
  });

  test('a designacao so alcanca quem tem login', () => {
    expect(listar).toMatch(/jaDesignado:\s+temAcesso && designadoSet\.has\(userId\)/);
  });
});

describe('criar resolve o login a partir do cadastro', () => {
  const criar = corpoDoMetodo(CTRL, 'criar');

  test('valida o cadastro contra a empresa antes de qualquer coisa', () => {
    expect(criar).toMatch(/encPrestador\.buscarCadastro\(prisma, \{/);
    expect(criar).toMatch(/PRESTADOR_CADASTRO_INVALIDO/);
  });

  test('`prestadorId` passa a ser DERIVADO do cadastro (contrato antigo preservado)', () => {
    expect(criar).toMatch(/const prestadorId = cadastroDestino \? cadastroDestino\.userId : \(prestadorIdBody \?\? null\)/);
  });

  test('prestador sem login e destino informado — nao cai em DESTINO_OBRIGATORIO', () => {
    expect(criar).toMatch(/if \(!cadastroDestino && !prestadorId && !String\(veterinarioDestino/);
  });

  test('sem vinculo de equipe o registro e gravado, sem designacao (so o legado 400)', () => {
    expect(criar).toMatch(/if \(memberships\.length === 0\) \{\s*\n\s*if \(!cadastroDestino\) \{/);
  });

  test('a designacao continua exigindo o LOGIN', () => {
    expect(criar).toMatch(/if \(prestadorId && equipeDesignacao\) \{/);
    expect(criar).toMatch(/designacaoPrestador\.upsert/);
  });

  test('a origem e gravada por SQL cru, DEPOIS do create', () => {
    const iCreate = criar.indexOf('encaminhamentoClinico.create');
    const iGrava  = criar.indexOf('encPrestador.gravarCadastro');
    expect(iCreate).toBeGreaterThan(-1);
    expect(iGrava).toBeGreaterThan(iCreate);
  });
});

describe('a leitura devolve o cadastro — senao o destino some da tela', () => {
  test('as tres saidas anexam o cadastro', () => {
    expect((CTRL.match(/encPrestador\.anexar(EmLista)?\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  test('a lib tem guarda de coluna — base nao migrada nao derruba a tela', () => {
    expect(LIB).toMatch(/information_schema\.columns/);
    expect(LIB).toMatch(/if \(!\(await temColunas\(\)\)\) return/);
  });

  test('o nome vem por JOIN, nao por snapshot — renomear o prestador aparece', () => {
    expect(LIB).toMatch(/LEFT JOIN schs2vet\.tb_prestadores/);
    expect(LIB).toMatch(/LEFT JOIN schs2vet\.tb_fornecedores/);
  });

  test('origem so aceita os dois valores conhecidos', () => {
    expect(LIB).toMatch(/const ORIGENS = Object\.freeze\(\{ PRESTADOR: 'PRESTADOR', FORNECEDOR: 'FORNECEDOR' \}\)/);
    expect(LIB).toMatch(/return ORIGENS\[v\] \?\? null;/);
  });
});

describe('a tela nao promete acesso que nao acontece', () => {
  test('a aba chama-se "Prestador"', () => {
    expect(TELA).toMatch(/label: 'Prestador'/);
    expect(TELA).not.toMatch(/'Prestador da equipe'/);
  });

  test('manda o CADASTRO no payload, nunca o `userId`', () => {
    expect(TELA).toMatch(/prestadorCadastroId:\s+destinoTipo === 'EQUIPE' \? prestadorSel\?\.cadastroId/);
    expect(TELA).not.toMatch(/prestadorId:\s+destinoTipo === 'EQUIPE'/);
  });

  test('a chave da lista e o par (origem, id) — `userId` nulo colapsaria os itens', () => {
    expect(TELA).toMatch(/key=\{chaveDoPrestador\(p\)\}/);
    expect(TELA).not.toMatch(/key=\{p\.userId\}/);
  });

  test('prestador sem login recebe o aviso de que NAO passa a ver o paciente', () => {
    expect(TELA).toMatch(/\{prestadorSel && !prestadorSel\.temAcesso && \(/);
  });

  test('o selo "com acesso a este paciente" olha o LOGIN, nao o destino interno', () => {
    expect(TELA).toMatch(/\{enc\.prestadorId != null && enc\.status === 'PENDENTE' && \(/);
  });
});
