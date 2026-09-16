// backend/src/__tests__/agendaDosePostergada.test.js
//
// 🔴 A DOSE QUE NÃO FOI DADA EMPURRA AS SEGUINTES — inclusive ANTES DA 1ª EXECUÇÃO.
//
// POR QUE ESTE ARQUIVO EXISTE. A postergação nasceu em 2026-09-15 e foi relatada como
// "não feita" no mesmo dia. Ela existia — só que `agendaDaDose` derivava a data devida
// de `previsaoDaDose(item, 0)`, que devolve `null` quando o item não tem ÂNCORA
// (`proximaDoseEm`). E âncora só existe depois da 1ª dose dada, ou com Hora Início
// prescrita. Ou seja: a função ficava INERTE exatamente no caso que veio corrigir —
// procedimento sem hora, nada executado —, e o defeito seguia na tela sem nada quebrar.
// É o pior formato de regressão: a função está lá, é chamada, e não faz nada.
//
// O CASO MEDIDO (item 233 da base, 2026-09-15): "Acupuntura a laser", 1x/dia por 3 dias,
// `dataInicio` 15/09, `horaInicio` VAZIO, 0 doses executadas — logo `proximaDoseEm` NULL
// (o backend devolve `horarioPrevistoDoItem`, que é null sem âncora). No dia 16, com
// nada executado, a tela seguia anunciando 15/09 · 16/09 · 17/09.
//
// ⚠️ O teste EXECUTA o código real do front (extraído por AST e transpilado), em vez de
// varrer texto: "a função aparece no arquivo" não teria pegado este defeito — ela
// aparecia, era chamada, e o comentário em cima dela já descrevia o comportamento certo.
// O gate ESTRUTURAL no fim cobre só o que não dá para executar (o JSX do modal).
'use strict';

const fs   = require('fs');
const path = require('path');
const ts   = require('typescript');
const { DOSES_POR_DIA } = require('../lib/agendaDoses');

const TELA  = path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'pages', 'ExecucaoPrescricao.tsx');
const FONTE = fs.readFileSync(TELA, 'utf8');

// Fuso fixo para o teste ser determinístico. É o padrão do sistema (§6) e é justamente
// nele que o meio-dia UTC vira "09:00" — a hora fantasma do defeito relatado.
const TZ = 'America/Sao_Paulo';
const fmtDia = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Espelho do `diaISO` de utils/dateUtils: instante -> 'YYYY-MM-DD' no fuso da clínica. */
function diaISO(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : fmtDia.format(d);
}

/** Espelho de `formatDiaMesHora` — só para PROVAR a hora fantasma que `temHorario` evita. */
function horaNoFuso(iso) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
    .format(new Date(iso));
}

// ─── Extração do código REAL da tela ─────────────────────────────────────────────
// Por AST, e não por recorte de texto: a assinatura de `agendaDaDose` tem chaves no
// TIPO DE RETORNO, então contar chaves a partir do primeiro `{` recortaria o tipo em
// vez do corpo.
const NECESSARIAS = ['intervaloEmMs', 'dataDoDiaISO', 'previsaoPendenteISO',
                     'previsaoDaDose', 'agendaDaDose', 'itemAtrasadoEm'];

function carregarFuncoesDaTela() {
  const sf = ts.createSourceFile('ExecucaoPrescricao.tsx', FONTE,
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const achadas = new Map();
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && NECESSARIAS.includes(st.name.text)) {
      achadas.set(st.name.text, st.getText(sf));
    }
  }
  const faltando = NECESSARIAS.filter(n => !achadas.has(n));
  if (faltando.length) throw new Error('Funcoes ausentes na tela: ' + faltando.join(', '));

  const tsSrc = 'const HORA_MS = 60 * 60 * 1000;\n'
    + NECESSARIAS.map(n => achadas.get(n)).join('\n\n');
  const js = ts.transpileModule(tsSrc, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;

  const mod = {};
  // `DOSES_POR_DIA` e `diaISO` são importados pela tela — injetados como escopo. O mapa
  // vem da lib do BACKEND de propósito: ela é a fonte única da cadência (CLAUDE.md §12),
  // e usá-la aqui também prova que os dois lados concordam sobre "1xDia".
  new Function('exports', 'DOSES_POR_DIA', 'diaISO', js)(mod, DOSES_POR_DIA, diaISO);
  return mod;
}

const { agendaDaDose, itemAtrasadoEm, dataDoDiaISO } = carregarFuncoesDaTela();

/** O item do relato: procedimento sem Hora Início, nenhuma dose dada. */
const semAncora = {
  proximaDoseEm: null,          // o backend devolve null quando não há âncora
  frequencia: '1xDia',
  dataInicio: '2026-09-15T00:00:00.000Z',
  duracaoDias: 3,
  dosesExecutadas: 0,
  dosesTotaisEsperadas: 3,
  executadoEm: null,
  diaAtual: 1,
};

describe('agendaDaDose — item SEM âncora (antes da 1ª execução)', () => {
  test('no dia do início nada é postergado: 15/09 · 16/09 · 17/09', () => {
    const doses = [1, 2, 3].map((dia, i) => agendaDaDose(semAncora, i, '2026-09-15', dia));
    expect(doses.map(d => diaISO(d.iso))).toEqual(['2026-09-15', '2026-09-16', '2026-09-17']);
    expect(doses.every(d => d.atrasoDias === 0)).toBe(true);
  });

  test('🔴 no dia seguinte, com nada executado, TODO o curso desliza um dia', () => {
    const doses = [1, 2, 3].map((dia, i) => agendaDaDose(semAncora, i, '2026-09-16', dia));
    // A dose pendente é reapresentada HOJE; as seguintes saem da frente dela.
    expect(doses.map(d => diaISO(d.iso))).toEqual(['2026-09-16', '2026-09-17', '2026-09-18']);
    expect(doses.map(d => d.atrasoDias)).toEqual([1, 1, 1]);
    // ...e cada linha diz desde QUANDO está em atraso — a data ORIGINAL dela, não a da
    // primeira: "a 2ª do dia 16/09 passa para 17/09, em atraso desde 16/09".
    expect(doses.map(d => diaISO(d.originalISO)))
      .toEqual(['2026-09-15', '2026-09-16', '2026-09-17']);
  });

  test('dois dias parado desliza dois dias — o atraso não satura em 1', () => {
    const doses = [1, 2, 3].map((dia, i) => agendaDaDose(semAncora, i, '2026-09-17', dia));
    expect(doses.map(d => diaISO(d.iso))).toEqual(['2026-09-17', '2026-09-18', '2026-09-19']);
    expect(doses.map(d => d.atrasoDias)).toEqual([2, 2, 2]);
  });

  test('🔴 sem âncora NÃO existe horário — `temHorario` impede a hora fantasma', () => {
    const d = agendaDaDose(semAncora, 0, '2026-09-16', 1);
    expect(d.temHorario).toBe(false);
    // PROVA de que o flag não é decorativo: o ISO devolvido é DATA PURA (meio-dia UTC),
    // e formatá-lo com hora produz exatamente o "às 09:00" relatado — horário que
    // nenhuma prescrição informou, e que ainda mudaria com o fuso da clínica.
    expect(horaNoFuso(d.iso)).toBe('09:00');
  });

  test('frequência com mais de uma dose por dia usa o DIA do curso, não o índice', () => {
    const doisPorDia = { ...semAncora, frequencia: '12em12h', dosesTotaisEsperadas: 4, duracaoDias: 2 };
    // gerarResumoDoses dá dia 1,1,2,2 — as duas primeiras caem no MESMO dia.
    const dias = [1, 1, 2, 2].map((dia, i) => diaISO(agendaDaDose(doisPorDia, i, '2026-09-15', dia).iso));
    expect(dias).toEqual(['2026-09-15', '2026-09-15', '2026-09-16', '2026-09-16']);
  });

  test('o selo da fila e a agenda do modal concordam sobre o atraso', () => {
    expect(itemAtrasadoEm(semAncora, '2026-09-15')).toBe(false);
    expect(itemAtrasadoEm(semAncora, '2026-09-16')).toBe(true);
    // A mesma origem alimenta os dois (`previsaoPendenteISO`). Divergindo, o selo diz
    // "atrasada" e a agenda mostra o curso em dia — ou o contrário.
    expect(agendaDaDose(semAncora, 0, '2026-09-16', 1).atrasoDias).toBeGreaterThan(0);
  });
});

describe('agendaDaDose — item COM âncora (comportamento preservado)', () => {
  // 1ª dose executada às 14:05 de 12/09 -> próxima 13/09 14:05 (rolling schedule).
  const comAncora = {
    proximaDoseEm: '2026-09-13T17:05:32.885Z', // 14:05 em Brasília
    frequencia: '1xDia',
    dataInicio: '2026-09-12T00:00:00.000Z',
    duracaoDias: 3,
    dosesExecutadas: 1,
    dosesTotaisEsperadas: 3,
    executadoEm: '2026-09-12T17:05:32.885Z',
    diaAtual: 2,
  };

  test('em dia: a próxima é o próprio `proximaDoseEm`, com a HORA preservada', () => {
    const d = agendaDaDose(comAncora, 0, '2026-09-13', 2);
    expect(d.iso).toBe(comAncora.proximaDoseEm);
    expect(d.atrasoDias).toBe(0);
    expect(d.temHorario).toBe(true);
    expect(horaNoFuso(d.iso)).toBe('14:05');
  });

  test('atrasado: desliza os DIAS e não remonta a hora (14:05 continua 14:05)', () => {
    const d = agendaDaDose(comAncora, 0, '2026-09-15', 2);
    expect(d.atrasoDias).toBe(2);
    expect(diaISO(d.iso)).toBe('2026-09-15');
    expect(horaNoFuso(d.iso)).toBe('14:05');
  });

  test('com âncora o `diaDaDose` é IGNORADO — quem manda é a cadência real', () => {
    const comDia = agendaDaDose(comAncora, 1, '2026-09-13', 99);
    const semDia = agendaDaDose(comAncora, 1, '2026-09-13');
    expect(comDia.iso).toBe(semDia.iso);
    expect(diaISO(comDia.iso)).toBe('2026-09-14');
  });
});

describe('itens sem data utilizável', () => {
  test('sem âncora e sem `diaDaDose` não inventa data (só reporta o atraso)', () => {
    const d = agendaDaDose(semAncora, 0, '2026-09-16');
    expect(d.iso).toBeNull();
    expect(d.originalISO).toBeNull();
    expect(d.atrasoDias).toBe(1);
  });

  test('`dataDoDiaISO` devolve MEIO-DIA UTC — data pura segura em todo fuso do Brasil', () => {
    const iso = dataDoDiaISO('2026-09-15T00:00:00.000Z', 1);
    expect(iso).toBe('2026-09-15T12:00:00.000Z');
    for (const tz of ['America/Noronha', 'America/Sao_Paulo', 'America/Cuiaba', 'America/Rio_Branco']) {
      const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
      expect(f.format(new Date(iso))).toBe('2026-09-15');
    }
  });
});

// ─── Gate estrutural: os dois CHAMADORES ─────────────────────────────────────────
// O que não dá para executar (é JSX dentro do componente) fica travado por varredura.
// ⚠️ Sem comentários: o arquivo EXPLICA a regra em prosa, e casar com a explicação faria
// o teste passar sobre o código errado — foi assim que a documentação da postergação
// conviveu com a postergação inerte.
function semComentarios(txt) {
  return txt.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
}
const CODIGO = semComentarios(FONTE);

describe('gate estrutural dos chamadores', () => {
  test('o modal passa o DIA DO CURSO para `agendaDaDose`', () => {
    // Sem o 4º argumento a postergação volta a ser inerte no item sem âncora — o
    // defeito relatado, e sem nenhum sintoma no build.
    expect(CODIGO).toMatch(/agendaDaDose\(item,\s*passo,\s*dataRef,\s*linha\.dia\)/);
  });

  test('o modal só formata HORA quando a dose tem horário de verdade', () => {
    const usos = CODIGO.match(/formatDiaMesHora\(agenda\.iso\)/g) || [];
    expect(usos).toHaveLength(1);
    expect(CODIGO).toMatch(/agenda\.temHorario[\s\S]{0,120}formatDiaMesHora\(agenda\.iso\)/);
  });

  test('o selo "Atrasada" da fila não inventa hora em item sem âncora', () => {
    const bloco = CODIGO.slice(CODIGO.indexOf('const atrasoDoTipo'));
    const corpo = bloco.slice(0, bloco.indexOf('const renderGrupoAtivo'));
    expect(corpo).toMatch(/comHora:\s*!!i\.proximaDoseEm/);
    expect(corpo).toMatch(/comHora\s*\?\s*formatDiaMesHora\(iso\)\s*:\s*formatDiaMes\(iso\)/);
  });
});
