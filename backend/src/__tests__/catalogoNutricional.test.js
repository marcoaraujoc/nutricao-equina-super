// backend/src/__tests__/catalogoNutricional.test.js
//
// GATE do CATÁLOGO NUTRICIONAL como CATÁLOGO MISTO (2026-09-09).
//
// O que quebra em SILÊNCIO aqui, e por isso é travado:
//   · a clínica passar a editar/excluir a linha GLOBAL — o catálogo do sistema é
//     compartilhado por todas as outras, e o estrago só aparece nelas;
//   · a exclusão voltar a ser possível com o item EM USO — como ela agora APAGA do
//     banco, isso arrasta dieta de paciente e resultado de exame;
//   · um handler novo (ou reescrito) esquecer o guard — nada acusa: o RLS devolve
//     "0 linhas" e a tela mostra um erro genérico, nunca o motivo real.

const fs = require('fs');
const path = require('path');

const {
  ehAdminPlataforma, empresaDoNovoItem, bloqueioDeEscrita, bloqueioDeUso,
  marcarOrigem, marcarOrigemEmLista,
} = require('../lib/catalogoNutricional');

const reqAdmin    = { user: { role: 'ADMIN', userType: 'ADMIN' }, empresaId: null };
const reqClinica  = { user: { role: 'VETERINARIO', userType: 'VETERINARIO' }, empresaId: 58 };
const reqSemEmp   = { user: { role: 'VETERINARIO', userType: 'VETERINARIO' }, empresaId: null };

const globalItem  = { id: 1, nome: 'Feno', empresaId: null };
const item58      = { id: 2, nome: 'Ração da casa', empresaId: 58 };
const item59      = { id: 3, nome: 'Ração da outra', empresaId: 59 };

const arquivo = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
// Comentários citam as regras que o gate procura — varrer o texto cru faria o teste
// passar só porque a documentação menciona a função (lição do gate de e-mail).
const semComentarios = (txt) => txt.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('quem é o dono da linha', () => {
  test('ADMIN da plataforma é reconhecido por role e por userType', () => {
    expect(ehAdminPlataforma(reqAdmin)).toBe(true);
    expect(ehAdminPlataforma({ user: { userType: 'ADMIN' } })).toBe(true);
    expect(ehAdminPlataforma(reqClinica)).toBe(false);
    expect(ehAdminPlataforma({})).toBe(false);
  });

  test('ADMIN cria linha GLOBAL; a clínica cria a dela', () => {
    expect(empresaDoNovoItem(reqAdmin)).toBeNull();
    expect(empresaDoNovoItem(reqClinica)).toBe(58);
  });

  test('sem empresa e sem ser ADMIN não há dono possível — o caller responde 400', () => {
    expect(empresaDoNovoItem(reqSemEmp)).toBeUndefined();
  });
});

describe('escrita: global é somente leitura para a clínica', () => {
  test('ADMIN escreve em qualquer linha', () => {
    expect(bloqueioDeEscrita(reqAdmin, globalItem)).toBeNull();
    expect(bloqueioDeEscrita(reqAdmin, item58)).toBeNull();
  });

  test('a clínica escreve no que é DELA', () => {
    expect(bloqueioDeEscrita(reqClinica, item58)).toBeNull();
  });

  test('🔴 a clínica NÃO escreve na linha do sistema', () => {
    const b = bloqueioDeEscrita(reqClinica, globalItem, 'alimento');
    expect(b).not.toBeNull();
    expect(b.status).toBe(403);
    expect(b.corpo.code).toBe('ITEM_DO_SISTEMA');
    // A mensagem precisa dizer a SAÍDA, não só o "não pode" — senão o gestor fica
    // sem saber que basta cadastrar um item próprio.
    expect(b.corpo.mensagem).toMatch(/cadastre um alimento próprio/i);
  });

  test('🔴 a clínica NÃO escreve na linha de outra empresa', () => {
    const b = bloqueioDeEscrita(reqClinica, item59);
    expect(b.status).toBe(403);
    expect(b.corpo.code).toBe('ITEM_DE_OUTRA_EMPRESA');
  });
});

describe('exclusão: o que está em uso não é apagado', () => {
  test('nada em uso ⇒ pode apagar', () => {
    expect(bloqueioDeUso([{ quantidade: 0, singular: 'dieta', plural: 'dietas' }])).toBeNull();
  });

  test('🔴 em uso ⇒ 409 dizendo QUANTOS registros seguram o item', () => {
    const b = bloqueioDeUso([{ quantidade: 3, singular: 'dieta', plural: 'dietas' }], 'alimento');
    expect(b.status).toBe(409);
    expect(b.corpo.code).toBe('EM_USO');
    expect(b.corpo.mensagem).toContain('3 dietas');
  });

  test('singular e plural saem certos, e o que está zerado não é citado', () => {
    const b = bloqueioDeUso([
      { quantidade: 1, singular: 'dieta', plural: 'dietas' },
      { quantidade: 0, singular: 'exame nutricional', plural: 'exames nutricionais' },
      { quantidade: 2, singular: 'exigência NRC', plural: 'exigências NRC' },
    ], 'nutriente');
    expect(b.corpo.mensagem).toContain('1 dieta');
    expect(b.corpo.mensagem).toContain('2 exigências NRC');
    expect(b.corpo.mensagem).not.toContain('exame');
  });
});

describe('origem viaja para a tela', () => {
  test('doSistema = true só quando empresaId é nulo', () => {
    expect(marcarOrigem(globalItem).doSistema).toBe(true);
    expect(marcarOrigem(item58).doSistema).toBe(false);
    expect(marcarOrigemEmLista([globalItem, item58]).map((x) => x.doSistema)).toEqual([true, false]);
  });
});

// ─── GATE ESTRUTURAL ─────────────────────────────────────────────────────────
describe('gate estrutural: os controllers não podem esquecer o guard', () => {
  const controllers = {
    'controllers/AlimentoController.js':            'alimento',
    'controllers/NutrientesController.js':          'nutriente',
    'controllers/ComposicaoAlimentarController.js': 'composição',
  };

  for (const [rel, rotulo] of Object.entries(controllers)) {
    test(`${rotulo}: atualizar e excluir passam por bloqueioDeEscrita`, () => {
      const src = semComentarios(arquivo(rel));
      // Duas ocorrências no mínimo: uma no atualizar, outra no excluir.
      const usos = (src.match(/bloqueioDeEscrita\(/g) ?? []).length;
      expect(usos).toBeGreaterThanOrEqual(2);
    });

    test(`${rotulo}: a criação carimba o dono (empresaDoNovoItem)`, () => {
      const src = semComentarios(arquivo(rel));
      expect(src).toMatch(/empresaDoNovoItem\(req\)/);
      expect(src).toMatch(/empresaId,/);
    });

    test(`${rotulo}: excluir exige motivo (§33 — a exclusão apaga do banco)`, () => {
      const src = semComentarios(arquivo(rel));
      expect(src).toMatch(/motivo\?\.trim\(\)/);
      expect(src).toMatch(/registrarAuditoria/);
    });
  }

  test('🔴 alimento e nutriente medem o USO antes de apagar', () => {
    const alimento  = semComentarios(arquivo('controllers/AlimentoController.js'));
    const nutriente = semComentarios(arquivo('controllers/NutrientesController.js'));
    // Alimento: a dieta do paciente é o que trava.
    expect(alimento).toMatch(/prisma\.dieta\.count/);
    expect(alimento).toMatch(/bloqueioDeUso\(/);
    // Nutriente: composição, exame e exigência.
    expect(nutriente).toMatch(/composicaoAlimento\.count/);
    expect(nutriente).toMatch(/exameNutricional\.count/);
    expect(nutriente).toMatch(/exigenciasNRC\.count/);
    expect(nutriente).toMatch(/bloqueioDeUso\(/);
  });

  test('🔴 as rotas do catálogo não voltam a ser ADMIN-only (soAdmin)', () => {
    for (const rel of ['routes/alimentos.js', 'routes/nutrientes.js', 'routes/composicaoAlimentar.js']) {
      const src = arquivo(rel);
      expect(src).not.toMatch(/soAdmin/);
      expect(src).toMatch(/checkPermission\('nutricao\.catalogo\.criar'/);
      expect(src).toMatch(/checkPermission\('nutricao\.catalogo\.editar'/);
      expect(src).toMatch(/checkPermission\('nutricao\.catalogo\.deletar'/);
    }
  });

  test('os três slugs existem no catálogo de módulos do seed', () => {
    const seed = arquivo('seeds/002_permissoes_padrao.seed.js');
    for (const slug of ['nutricao.catalogo.criar', 'nutricao.catalogo.editar', 'nutricao.catalogo.deletar']) {
      expect(seed).toContain(`slug: '${slug}'`);
    }
  });
});
