'use strict';

/**
 * FORNECEDOR E PRESTADOR **NÃO SÃO EQUIPE** (decisão de 2026-09-09).
 *
 * São atuações ESTANQUES: saem da tela Equipe, do Controle de Acesso e da grade da
 * Agenda, e passam a ser criados e geridos nos PRÓPRIOS cadastros
 * (`/cadastro/fornecedores`, `/cadastro/prestadores`) + Designações.
 *
 * 🔴 O QUE **NÃO** MUDOU, e é a parte que este arquivo protege: `MembroEquipe`
 * continua existindo para eles — como CARTÃO DE ACESSO emitido pelo cadastro, não
 * como cadeira na equipe. Não é contradição, é infraestrutura: TODO o RBAC se resolve
 * por ele (`resolveEquipeId` → `checkPermission` → `PermissaoMembro` →
 * `DesignacaoPrestador`). Apagá-lo "para deixar estanque de verdade" derrubaria o
 * acesso da pessoa inteira, com um 403 genérico de "nenhuma equipe ativa".
 *
 * As duas metades falham em silêncio, e por isso são varridas no CÓDIGO:
 *   • esquecer o filtro numa consulta de membros os traz de volta para a tela Equipe
 *     e para a Agenda, sem erro nenhum;
 *   • esquecer de emitir o cartão faz o cadastro prometer acesso e entregar uma tela
 *     vazia — que era exatamente o estado documentado em `Prestador.userId`.
 */

// ⚠️ `virtual: true` SÓ em modulo que o jest realmente nao resolve — `lib/prisma` e
// TypeScript e o babel-jest nao o transpila. `lib/logger` e `lib/usuarioEmpresa` sao
// `.js` REAIS: com o flag, um worker que ja tivesse carregado o modulo de verdade num
// arquivo anterior resolvia o REAL em vez do mock, e `salvarPagamentoEAcesso` deixava
// de ser um `jest.fn()` — o caso "revogar NAO apaga o vinculo" falhava ~1 em 8
// execucoes, SO na suite COMPLETA (isolado passava sempre). Mesma licao registrada no
// CLAUDE.md em 2026-09-10 (parte 2).
jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });
jest.mock('../lib/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
// `salvarVinculo`/`salvarPagamentoEAcesso` batem no banco de verdade (e checam se as
// colunas existem). Aqui o que se testa é o CONTRATO de `acessoExterno`: o que ele
// manda gravar, e o que ele NUNCA manda apagar.
jest.mock('../lib/usuarioEmpresa', () => ({
  salvarVinculo:          jest.fn().mockResolvedValue({}),
  salvarPagamentoEAcesso: jest.fn().mockResolvedValue(undefined),
}));

const fs   = require('fs');
const path = require('path');

const RAIZ  = path.join(__dirname, '..');
const FRONT = path.join(__dirname, '..', '..', '..', 'frontend', 'src');
const ler      = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const lerFront = (rel) => fs.readFileSync(path.join(FRONT, rel), 'utf8');
const semComentarios = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

// ---------------------------------------------------------------------------
describe('eles somem da listagem de membros', () => {
  const { SEM_EXTERNOS, CARGOS_PRESTADOR } = require('../lib/cargosPrestador');

  it('o filtro é pelo cargo PRIMÁRIO', () => {
    // ⚠️ De propósito. Quem é VETERINARIO e ACUMULA prestador em `cargos[]` continua
    // na equipe — ele é da casa e também atende como externo; sumir da lista o
    // tornaria ingerenciável. É o oposto de `membroEhPrestador`, que existe para
    // RESTRINGIR acesso (e lá qualquer cargo da família basta).
    expect(SEM_EXTERNOS).toEqual({ cargo: { notIn: CARGOS_PRESTADOR } });
  });

  it('TODA consulta de membro de listarMembros/listarMembrosPorEquipe aplica o filtro', () => {
    const src = semComentarios(ler('controllers/EquipeController.js'));
    // Uma consulta esquecida devolve os externos para a tela Equipe, para o Controle
    // de Acesso e para a grade da Agenda de uma vez — os três comem o mesmo endpoint.
    const consultas = src.match(/where:\s*\{\s*equipeId:[^}]*NOT:\s*\{\s*user:\s*\{\s*role:\s*'ADMIN'\s*\}\s*\}[^}]*\}/g) ?? [];
    expect(consultas.length).toBeGreaterThanOrEqual(4);
    for (const c of consultas) expect(c).toMatch(/\.\.\.semExternos/);
  });

  it('a porta de saída é explícita (?incluirExternos=1), não um filtro reescrito à mão', () => {
    const src = semComentarios(ler('controllers/EquipeController.js'));
    expect((src.match(/req\.query\.incluirExternos === '1' \? \{\} : SEM_EXTERNOS/g) ?? []).length).toBe(2);
  });

  it('o inventário da PLATAFORMA continua vendo todo vínculo', () => {
    // `listarTodasEmpresasAdmin` é a visão do ADMIN sobre todas as empresas: ali o
    // cartão de acesso PRECISA aparecer, senão o vínculo fica invisível para quem
    // administra a plataforma.
    const src = semComentarios(ler('controllers/EquipeController.js'));
    const ini = src.indexOf('listarTodasEmpresasAdmin:');
    const corpo = src.slice(ini, src.indexOf('listarMembros:', ini));
    expect(corpo).not.toMatch(/semExternos|SEM_EXTERNOS/);
  });
});

// ---------------------------------------------------------------------------
describe('o cartão de acesso — lib/acessoExterno.js', () => {
  const { emitirCartaoAcesso, revogarCartaoAcesso } = require('../lib/acessoExterno');

  const txFalso = ({ membro = null, equipe = { id: 7, empresaId: 3 } } = {}) => {
    const criados = [];
    const upserts = [];
    return {
      criados, upserts,
      equipe: {
        findFirst:  jest.fn().mockResolvedValue(equipe),
        findUnique: jest.fn().mockResolvedValue(equipe),
      },
      membroEquipe: {
        findUnique: jest.fn().mockResolvedValue(membro),
        create:     jest.fn(async ({ data }) => { criados.push(data); return { id: 99, cargo: data.cargo }; }),
      },
      usuarioEmpresa: { upsert: jest.fn(async (a) => { upserts.push(a); return {}; }) },
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    };
  };

  it('emite o vínculo quando ainda não existe', async () => {
    const tx = txFalso();
    const r = await emitirCartaoAcesso(tx, { userId: 42, empresaId: 3, equipeId: 7, cargo: 'PRESTADOR' });
    expect(r).toMatchObject({ userId: 42, equipeId: 7, criado: true });
    expect(tx.criados).toEqual([{ equipeId: 7, userId: 42, cargo: 'PRESTADOR' }]);
  });

  // 🔴 O caso que estraga o cadastro de quem é da casa: a veterinária que também tem
  // cadastro de prestador não pode ser REBAIXADA a prestador porque alguém marcou
  // "terá acesso" no cadastro homônimo dela.
  it('NÃO reescreve o cargo de quem já é membro', async () => {
    const tx = txFalso({ membro: { id: 5, cargo: 'VETERINARIO' } });
    const r = await emitirCartaoAcesso(tx, { userId: 42, empresaId: 3, equipeId: 7, cargo: 'PRESTADOR' });
    expect(tx.membroEquipe.create).not.toHaveBeenCalled();
    expect(r).toMatchObject({ cargoEfetivo: 'VETERINARIO', criado: false });
    // E o PERFIL do vínculo por empresa também não é imposto por cima.
    const { salvarVinculo } = require('../lib/usuarioEmpresa');
    const dados = salvarVinculo.mock.calls.at(-1)?.[3] ?? {};
    expect(dados.perfil).toBeUndefined();
  });

  it('sem equipe onde emitir, devolve null em vez de inventar uma', async () => {
    const tx = txFalso({ equipe: null });
    expect(await emitirCartaoAcesso(tx, { userId: 42, empresaId: null, equipeId: null, cargo: 'PRESTADOR' })).toBeNull();
  });

  // 🔴 Apagar o MembroEquipe levaria junto, por cascade, a PermissaoMembro da pessoa:
  // religar o acesso depois a devolveria SEM nenhuma das permissões que o gestor
  // configurou, em silêncio. O que corta o login é `acesso_sistema = false`.
  it('revogar NÃO apaga o vínculo — só desliga o acesso', async () => {
    const tx = txFalso();
    tx.membroEquipe.delete = jest.fn();
    tx.membroEquipe.deleteMany = jest.fn();
    await revogarCartaoAcesso(tx, { userId: 42, empresaId: 3 });
    expect(tx.membroEquipe.delete).not.toHaveBeenCalled();
    expect(tx.membroEquipe.deleteMany).not.toHaveBeenCalled();
    const { salvarPagamentoEAcesso } = require('../lib/usuarioEmpresa');
    expect(salvarPagamentoEAcesso).toHaveBeenCalledWith(tx, 42, 3, { acessoSistema: false });
  });
});

// ---------------------------------------------------------------------------
describe('o cadastro é a casa deles — e emite o cartão', () => {
  const src = semComentarios(ler('controllers/PrestadorController.js'));

  it('marcar "terá acesso ao sistema" emite o cartão', () => {
    // Sem isto o cadastro promete acesso e entrega tela vazia: era o estado
    // documentado em `Prestador.userId` ("dá para logar, mas sem RBAC").
    expect((src.match(/emitirCartaoAcesso\(tx,/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(src).toMatch(/cargo:\s*'PRESTADOR'/);
  });

  it('desmarcar revoga o acesso (sem apagar o vínculo)', () => {
    expect(src).toMatch(/revogarCartaoAcesso\(tx,/);
  });

  it('a tela recebe a equipe do cartão para poder abrir as designações', () => {
    // O `equipeId` do CADASTRO não serve: é `req.equipeId ?? null` na criação, e em
    // empresa com CNPJ o seletor resolve no nível da EMPRESA — vem nulo.
    expect(src).toMatch(/anexarEquipeDoAcesso\(/);
    expect(semComentarios(ler('controllers/FornecedorController.js'))).toMatch(/anexarEquipeDoAcesso\(/);
  });
});

// ---------------------------------------------------------------------------
describe('🔴 GATE do FRONT — a equipe não os oferece nem os gerencia', () => {
  it('o formulário de MEMBRO não oferece Fornecedor nem Prestador', () => {
    const src = semComentarios(lerFront('components/UsuarioFormModal.tsx'));
    const ini = src.indexOf('PERFIS_ACESSO');
    const lista = src.slice(ini, src.indexOf('];', ini));
    expect(lista).not.toMatch(/'FORNECEDOR'|'PRESTADOR'/);
  });

  it('mas continuam em PERFIS_LEGADOS — nada foi migrado', () => {
    // Vínculo antigo aberto por algum caminho mostra o rótulo, em vez de um
    // `<select>` em branco sobre um cargo que existe de verdade no banco.
    const src = semComentarios(lerFront('components/UsuarioFormModal.tsx'));
    const ini = src.indexOf('PERFIS_LEGADOS');
    const lista = src.slice(ini, src.indexOf('};', ini));
    expect(lista).toMatch(/FORNECEDOR:/);
    expect(lista).toMatch(/PRESTADOR:/);
  });

  it('"Gerenciar Acesso" saiu do Controle de Acesso', () => {
    const src = semComentarios(lerFront('pages/ControleAcesso.tsx'));
    expect(src).not.toMatch(/GerenciarAcessoPrestadorModal/);
    expect(src).not.toMatch(/setModalAcesso/);
  });

  it('e vive nos DOIS cadastros, num componente só', () => {
    // Duas cópias divergiriam na primeira correção — e o que divergiria seria o
    // alcance de um profissional externo aos prontuários.
    for (const tela of ['pages/CadastroPrestador.tsx', 'pages/CadastroFornecedor.tsx']) {
      const src = semComentarios(lerFront(tela));
      expect(src).toMatch(/GerenciarAcessoPrestadorModal/);
      // Sem login ou sem cartão, o botão NÃO é renderizado (armadilha 28-d).
      expect(src).toMatch(/!!\w+\.userId && !!\w+\.acessoEquipeId/);
    }
  });
});
