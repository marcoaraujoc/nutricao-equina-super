// backend/src/__tests__/pacienteDeClienteInativo.test.js
//
// O PACIENTE DO CLIENTE INATIVADO NÃO SOME DA APLICAÇÃO — ELE VAI PARA "INATIVOS".
//
// 🔴 O DEFEITO QUE ESTE ARQUIVO TRANCA (2026-09-06): `removerDaEmpresa` inativa os
// animais do cliente removido, e a regra de visibilidade (`lib/visibilidade.js`)
// esconde o animal de quem não é cliente ativo da empresa. As duas coisas estão
// certas isoladamente e, JUNTAS, faziam o paciente desaparecer da aplicação INTEIRA:
// nem na aba "Inativos" da tela de Pacientes ele aparecia. Não havia onde conferir o
// que tinha acontecido nem botão por onde desfazer — e o único rastro era a
// justificativa gravada numa linha que ninguém mais conseguia enxergar.
//
// A REGRA, agora: quem enxerga o invisível é a ABA DE PACIENTES, e só ela. Ali o
// estado do dono deixa de FILTRAR e passa a ser REPORTADO (`proprietarioInativo`), e
// a TELA o classifica como inativo. Toda outra listagem (agenda, plantão, dashboard,
// relatórios) continua em `animalVisivelNaEmpresa` — tratando o paciente de cliente
// inativo como inativo, que é exatamente o que a tela passa a dizer dele.
//
// ⚠️ São DOIS lados, e os dois falham em silêncio:
//   (a) o backend voltar a filtrar pelo dono → o paciente some de novo, sem erro;
//   (b) a tela deixar de contar o `proprietarioInativo` → ele reaparece na aba
//       "Ativos", prometendo uma atividade que não existe em tela nenhuma.
//
// Varredura de CÓDIGO (o projeto não tem runner de componente React nem banco no
// teste). Grosseira de propósito: o que ela precisa pegar é a AUSÊNCIA da regra.
'use strict';

const fs   = require('fs');
const path = require('path');

const RAIZ  = path.join(__dirname, '..', '..', '..');
const BACK  = fs.readFileSync(path.join(RAIZ, 'backend', 'src', 'controllers', 'AnimalController.js'), 'utf8');
const FRONT = fs.readFileSync(path.join(RAIZ, 'frontend', 'src', 'pages', 'AnimaisVet.tsx'), 'utf8');

/**
 * ⚠️ COMENTÁRIO NÃO VALE COMO IMPLEMENTAÇÃO. Sem isto a varredura passa só porque o
 * comentário que EXPLICA a regra cita as mesmas palavras dela — e um gate que se
 * satisfaz com a própria documentação é um gate que se aprende a ignorar.
 */
function semComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Recorta do marcador até o próximo fechamento indicado. */
function trecho(texto, de, ate) {
  const i = texto.indexOf(de);
  if (i < 0) return null;
  const f = texto.indexOf(ate, i + de.length);
  return texto.slice(i, f < 0 ? texto.length : f);
}

describe('BACKEND — a aba de Pacientes enxerga o paciente do cliente inativado', () => {
  const listar = trecho(semComentarios(BACK), 'async listar(req, res)', 'async obterPorId');

  test('a listagem existe e resolve a aba antes de montar o `where`', () => {
    expect(listar).toBeTruthy();
    expect(listar).toContain('abaDePacientes');
    // A trava de QUEM pode: gestor/admin do contexto E `?ativo=` explícito. Sem ela,
    // qualquer perfil que soubesse mandar o parâmetro veria o que a exclusão lógica
    // esconde — o oposto do que a regra quer.
    expect(listar).toMatch(
      /abaDePacientes\s*=\s*ehGestorNoContexto\(req\)\s*&&\s*req\.query\.ativo\s*!==\s*undefined/,
    );
  });

  test('🔴 na aba, o estado do DONO não entra no filtro', () => {
    // O `where` da aba pode falar de `ativo` (a coluna do PRÓPRIO animal) e de mais
    // nada. Reintroduzir ali qualquer pedaço de `animalVisivelNaEmpresa` — o
    // `visivelSemAtivo` de antes, ou um `user:` escrito à mão — faz o paciente do
    // cliente removido sumir outra vez, e sumir em SILÊNCIO.
    // ⚠️ O fechamento é a consulta que vem logo depois, e não o primeiro `}`: o ramo
    // usa `? {}` e cortar ali deixaria de fora justamente a linha a inspecionar.
    const ramo = trecho(listar, 'if (abaDePacientes)', 'let animais');
    expect(ramo).toBeTruthy();
    expect(ramo).not.toContain('visivel');
    expect(ramo).not.toContain('user');
    expect(ramo).toMatch(/ativo:\s*req\.query\.ativo === 'true'/);
  });

  test('o que saiu do filtro entra na LINHA, e só na aba', () => {
    // Sem a marca o paciente aparece na aba como um paciente comum — e nada explica
    // por que ele não está em mais tela nenhuma.
    expect(listar).toMatch(
      /if \(abaDePacientes\)\s*await marcarProprietarioInativo\(animais, req\.empresaId\)/,
    );
  });

  test('a marca sai da REGRA POSITIVA, nunca de uma negação escrita à mão', () => {
    const helper = trecho(
      semComentarios(BACK),
      'async function marcarProprietarioInativo',
      'const obterUserType',
    );
    expect(helper).toBeTruthy();
    // Reusa `animalVisivelNaEmpresa` e marca o COMPLEMENTO de quem passa por ela.
    // Uma negação própria seria uma segunda cópia da regra do §36 (perfil da empresa
    // × `users.ativo` do legado) e divergiria dela na primeira correção — aparecendo
    // como "o paciente está na lista e o dono consta ativo", que ninguém depura.
    expect(helper).toContain('animalVisivelNaEmpresa(empresaId).user');
    expect(helper).toContain('proprietarioInativo');
    expect(helper).not.toMatch(/\bNOT\b/);
  });

  test('nenhuma OUTRA listagem foi afrouxada junto', () => {
    // O afrouxamento vale só para a aba. Se `animalVisivelNaEmpresa` sumir das telas
    // operacionais, o paciente do cliente inativo volta à agenda e ao plantão — o
    // oposto do que "ele conta como inativo" significa.
    const OPERACIONAIS = [
      'AgendamentoController.js',
      'DashboardController.js',
      'MapaAtendimentoController.js',
      'RelatorioGerencialController.js',
    ];
    for (const arq of OPERACIONAIS) {
      const src = semComentarios(
        fs.readFileSync(path.join(RAIZ, 'backend', 'src', 'controllers', arq), 'utf8'),
      );
      expect(`${arq}: ${src.includes('animalVisivelNaEmpresa')}`).toBe(`${arq}: true`);
    }
  });
});

describe('TELA — o paciente do cliente inativado cai na aba "Inativos"', () => {
  const front = semComentarios(FRONT);

  test('🔴 `proprietarioInativo` conta como inativo nas abas', () => {
    const fn = trecho(front, 'function pacienteInativo', '}');
    expect(fn).toBeTruthy();
    expect(fn).toContain('proprietarioInativo');
    // Os outros dois estados continuam valendo — a aba reúne os três.
    expect(fn).toContain('ativo === false');
    expect(fn).toContain('inativo');
  });

  test('o selo diz o estado, em vez de exibir "Ativo" para quem está fora de tudo', () => {
    const fn = trecho(front, 'function seloStatus', 'function rastroInativacao');
    expect(fn).toBeTruthy();
    expect(fn).toContain('animal.proprietarioInativo');
  });

  test('a justificativa explica ONDE se desfaz', () => {
    // O paciente PRESERVADO (a opção "manter os animais" de `removerDaEmpresa`) não
    // tem trilha própria: ninguém o inativou. Sem esta linha a coluna sai vazia e a
    // pessoa fica sem saber por que ele está ali nem o que fazer.
    const fn = trecho(front, 'function rastroInativacao', 'function AnimalCardMobile');
    expect(fn).toBeTruthy();
    expect(fn).toContain('proprietarioInativo');
    expect(fn).toContain('Proprietários');
  });
});
