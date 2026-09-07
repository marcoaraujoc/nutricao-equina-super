// backend/src/__tests__/duplicidadeAnimal.test.js
//
// DUPLICATA DE PACIENTE = NOME + LOCAL + DONO.
//
// 🔴 O QUE ESTE ARQUIVO PROTEGE: a regra tem dois lados que se quebram em silêncio.
// Apertar demais (barrar por NOME, como era antes) impede o cadastro legítimo de dois
// pacientes homônimos de donos diferentes no mesmo haras — e o vet fica sem saída.
// Afrouxar (esquecer o dono, ou comparar nome com acento) deixa nascer um segundo
// cadastro do MESMO paciente, e aí o histórico clínico fica partido em dois sem que
// nada acuse.
'use strict';

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });

const fs   = require('fs');
const path = require('path');
const { verificarDuplicidadeAnimal, normalizarNome } = require('../lib/duplicidadeAnimal');

// Banco falso — imita o POSTGRES, não a lib: aplica em cada linha a mesma
// transformação que o `translate(lower(btrim(nome)))` da consulta faz, e compara com o
// parâmetro. É isso que torna o caso do ACENTO significativo: foi ele que reprovou a
// primeira versão (que buscava por `contains` e normalizava só em JS — e o Postgres
// nunca devolvia "Mél" para quem procurava "Mel").
function comoOPostgres(nome) {
  return String(nome).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function bancoFalso(animais) {
  return {
    $queryRawUnsafe: async (_sql, empresaId, alvo, ignorarId) => animais
      .filter(a => a.empresaId === empresaId)
      .filter(a => ignorarId == null || a.id !== ignorarId)
      .filter(a => comoOPostgres(a.nome) === alvo)
      .map(a => ({
        id: a.id, nome: a.nome, ativo: a.ativo !== false, inativo: a.inativo === true,
        localizacaoId: a.localizacaoId ?? null, userId: a.userId ?? null,
        localNome: a.localNome ?? null, donoNome: a.donoNome ?? null,
      })),
  };
}

const BASE = [
  { id: 1, nome: 'Thor', empresaId: 7, localizacaoId: 10, userId: 100, localNome: 'Haras A', donoNome: 'Ana' },
];

describe('a cascata', () => {
  test('1) mesmo nome no mesmo local é PERGUNTA, não bloqueio', async () => {
    // Dono ainda desconhecido (a tela pede o e-mail depois do nome): há o que
    // perguntar, mas nada a concluir.
    const r = await verificarDuplicidadeAnimal(
      { nome: 'Thor', localizacaoId: 10, empresaId: 7 }, bancoFalso(BASE));
    expect(r.mesmoLocal).toHaveLength(1);
    expect(r.duplicado).toBeNull();
    expect(r.duplicadoInativo).toBeNull();
    expect(r.mesmoLocal[0].mesmoProprietario).toBeNull();  // "não sei", não "não"
  });

  test('2a) mesmo local, OUTRO dono → segue: são dois pacientes diferentes', async () => {
    const r = await verificarDuplicidadeAnimal(
      { nome: 'Thor', localizacaoId: 10, empresaId: 7, proprietarioId: 999 }, bancoFalso(BASE));
    expect(r.mesmoLocal).toHaveLength(1);
    expect(r.mesmoLocal[0].mesmoProprietario).toBe(false);
    expect(r.duplicado).toBeNull();
  });

  test('2b) mesmo local e MESMO dono → duplicata, não se cadastra', async () => {
    const r = await verificarDuplicidadeAnimal(
      { nome: 'Thor', localizacaoId: 10, empresaId: 7, proprietarioId: 100 }, bancoFalso(BASE));
    expect(r.duplicado).not.toBeNull();
    expect(r.duplicado.nome).toBe('Thor');
    expect(r.duplicadoInativo).toBeNull();   // está em uso: não há o que reativar
  });

  test('2c) o existente está CONGELADO → oferece reativar em vez de duplicar', async () => {
    const r = await verificarDuplicidadeAnimal(
      { nome: 'Thor', localizacaoId: 10, empresaId: 7, proprietarioId: 100 },
      bancoFalso([{ ...BASE[0], inativo: true }]));
    expect(r.duplicado).toBeNull();
    expect(r.duplicadoInativo.id).toBe(1);
  });

  test('2d) o existente foi EXCLUÍDO logicamente → também é reativável', async () => {
    // `ativo:false` e `inativo:true` são recursos diferentes, mas para quem cadastra
    // significam a mesma coisa: existe e não está em uso.
    const r = await verificarDuplicidadeAnimal(
      { nome: 'Thor', localizacaoId: 10, empresaId: 7, proprietarioId: 100 },
      bancoFalso([{ ...BASE[0], ativo: false }]));
    expect(r.duplicadoInativo.id).toBe(1);
  });

  test('um ATIVO entre inativos vence — a duplicata é ele', async () => {
    const r = await verificarDuplicidadeAnimal(
      { nome: 'Thor', localizacaoId: 10, empresaId: 7, proprietarioId: 100 },
      bancoFalso([
        { ...BASE[0], id: 1, inativo: true },
        { ...BASE[0], id: 2 },
      ]));
    expect(r.duplicado.id).toBe(2);
    expect(r.duplicadoInativo).toBeNull();
  });
});

describe('o que NÃO é duplicata', () => {
  test('mesmo nome e mesmo dono em OUTRO local', async () => {
    const r = await verificarDuplicidadeAnimal(
      { nome: 'Thor', localizacaoId: 20, empresaId: 7, proprietarioId: 100 }, bancoFalso(BASE));
    expect(r.mesmoLocal).toHaveLength(0);
    expect(r.duplicado).toBeNull();
  });

  test('🔴 paciente de OUTRA empresa nunca entra na conta', async () => {
    // O cadastro é isolado por empresa (§5): o "Thor" da clínica vizinha é outro
    // paciente, e barrar por ele impediria esta clínica de cadastrar o seu.
    const r = await verificarDuplicidadeAnimal(
      { nome: 'Thor', localizacaoId: 10, empresaId: 8, proprietarioId: 100 }, bancoFalso(BASE));
    expect(r.conflitos).toHaveLength(0);
  });

  test('o PRÓPRIO animal não conflita consigo (edição)', async () => {
    const r = await verificarDuplicidadeAnimal(
      { nome: 'Thor', localizacaoId: 10, empresaId: 7, proprietarioId: 100, ignorarId: 1 }, bancoFalso(BASE));
    expect(r.conflitos).toHaveLength(0);
  });

  test('nome PARECIDO não é o mesmo nome', async () => {
    // A comparação é de IGUALDADE, não de prefixo: "Thorzinho" é outro paciente.
    const r = await verificarDuplicidadeAnimal(
      { nome: 'Thor', localizacaoId: 10, empresaId: 7, proprietarioId: 100 },
      bancoFalso([{ ...BASE[0], nome: 'Thorzinho' }]));
    expect(r.conflitos).toHaveLength(0);
  });
});

describe('comparação de nome', () => {
  test('ignora acento, caixa e espaço — é onde a duplicata escapava', () => {
    expect(normalizarNome('  Mél ')).toBe('mel');
    expect(normalizarNome('MEL')).toBe('mel');
    expect(normalizarNome('Thor  Jr')).toBe('thor jr');
  });

  test('"Mél" e "Mel" são o MESMO paciente', async () => {
    const r = await verificarDuplicidadeAnimal(
      { nome: 'Mel', localizacaoId: 10, empresaId: 7, proprietarioId: 100 },
      bancoFalso([{ ...BASE[0], nome: 'Mél' }]));
    expect(r.duplicado).not.toBeNull();
  });
});

/** Sem comentários: um gate que reprova o texto que EXPLICA a regra vira ruído — e
 *  ruído é o que se aprende a ignorar (mesma lição do gate de e-mail, CLAUDE.md). */
function semComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('a comparação acontece no BANCO', () => {
  test('🔴 a consulta normaliza acento e caixa no SQL, não só em JS', () => {
    // A primeira versão filtrava com `contains` e normalizava depois, em JS — e o
    // candidato acentuado nunca chegava lá. Se este `translate` sair da consulta, a
    // duplicata com acento volta a passar sem que nada acuse.
    const lib = semComentarios(fs.readFileSync(path.join(__dirname, '..', 'lib/duplicidadeAnimal.js'), 'utf8'));
    expect(lib).toMatch(/translate\(lower\(btrim\(a\.nome\)\)/);
    expect(lib).not.toMatch(/contains:/);
  });

  test('as duas tabelas do translate têm o mesmo comprimento', () => {
    // `translate` mapeia caractere a caractere: uma sobra desloca todo o resto e
    // passa a trocar letras erradas ("ç" virando "n", por exemplo).
    const lib = fs.readFileSync(path.join(__dirname, '..', 'lib/duplicidadeAnimal.js'), 'utf8');
    const com = lib.match(/const COM_ACENTO = '(.+)';/)[1];
    const sem = lib.match(/const SEM_ACENTO = '(.+)';/)[1];
    expect([...sem]).toHaveLength([...com].length);
  });
});

describe('o nome do dono é o do CADASTRO DA EMPRESA', () => {
  test('🔴 não sai de `users.fullName` — sai de `tb_proprietario_perfis` (§36)', () => {
    // Caso real: o mesmo login é "Laura" na identidade global e "Patricia Costa" no
    // cadastro da clínica. O aviso dizia "de Laura" — um nome que ninguém naquela
    // clínica reconhece. `users.fullName` é só a reserva do cliente LEGADO.
    const lib = semComentarios(fs.readFileSync(path.join(__dirname, '..', 'lib/duplicidadeAnimal.js'), 'utf8'));
    expect(lib).toMatch(/COALESCE\(pp\.full_name, u\."fullName"\)/);
    expect(lib).toMatch(/tb_proprietario_perfis pp[\s\S]{0,120}pp\.empresa_id = a\."empresaId"/);
  });
});

describe('gate estrutural — a regra vale no SALVAR, não só na tela', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'controllers/AnimalController.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  test('o `criar` chama o MESMO helper da verificação em tempo real', () => {
    // Uma segunda implementação no controller divergiria da tela na primeira
    // correção — e o que divergiria é o que se considera duplicata.
    expect(src).toMatch(/verificarDuplicidadeAnimal\(\{[\s\S]{0,400}proprietarioId:\s*Number\(targetUserId\)/);
  });

  test('duplicata ATIVA é recusada com 409', () => {
    expect(src).toMatch(/dup\.duplicado[\s\S]{0,300}status\(409\)/);
  });

  test('duplicata INATIVA devolve o animal, para a tela oferecer a reativação', () => {
    expect(src).toMatch(/duplicadoInativo:\s*true/);
    expect(src).toMatch(/dup\.duplicadoInativo\.id/);
  });
});
