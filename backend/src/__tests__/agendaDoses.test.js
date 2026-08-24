// backend/src/__tests__/agendaDoses.test.js
//
// Trava as três regras que mudaram em 2026-08-23 na agenda de doses:
//   1. o horário prescrito é LOCAL, não UTC (era a origem do "sistema 3h atrás");
//   2. Hora Início é OPCIONAL — quem fixa a grade é a 1ª execução;
//   3. rolling schedule a partir do horário REAL da última dose.
//
// ⚠️ As asserções de horário usam os getters LOCAIS (`getHours`) e comparam com o
// que foi PRESCRITO — nunca com um instante UTC literal. Assim o teste vale em
// qualquer fuso (CI em UTC, máquina do dev em America/Sao_Paulo) e ainda assim
// reprova a regressão: com `setUTCHours` o `getHours()` local só coincide com a
// hora prescrita num servidor em UTC, que não é onde o sistema roda.

const {
  elegivelParaFluxoNovo,
  semAncoraDeHorario,
  temHoraInicio,
  primeiraDoseEsperada,
  calcularProximaDose,
  horarioPrevistoDoItem,
  classificarExecucao,
  dosesTotaisEsperadas,
  dentroDaJanelaDoCurso,
  dataLocalDe,
} = require('../lib/agendaDoses');

const item = (over = {}) => ({
  frequencia:      '12em12h',
  duracaoDias:     1,
  dataInicio:      '2026-08-23T00:00:00.000Z',
  horaInicio:      null,
  dosesExecutadas: 0,
  proximaDoseEm:   null,
  ...over,
});

describe('primeiraDoseEsperada — horário é LOCAL, nunca UTC', () => {
  it('grava a hora prescrita como hora LOCAL do dia de dataInicio', () => {
    const d = primeiraDoseEsperada(item({ horaInicio: '20:00' }));
    expect(d.getHours()).toBe(20);
    expect(d.getMinutes()).toBe(0);
    // e continua no dia do calendário que foi prescrito
    expect(dataLocalDe(d)).toBe('2026-08-23');
  });

  it('preserva os minutos', () => {
    const d = primeiraDoseEsperada(item({ horaInicio: '06:45' }));
    expect(d.getHours()).toBe(6);
    expect(d.getMinutes()).toBe(45);
  });

  it('sem horaInicio ancora na meia-noite LOCAL do dia de início (âncora de calendário)', () => {
    const d = primeiraDoseEsperada(item());
    expect(d.getHours()).toBe(0);
    expect(dataLocalDe(d)).toBe('2026-08-23');
  });
});

describe('Hora Início é opcional', () => {
  it('frequência intra-dia sem hora continua elegível ao rolling schedule', () => {
    // Antes: sem horaInicio o item caía no fluxo LEGADO e UMA execução "cobria o
    // dia inteiro" — "4 em 4 horas" virava executado já na 1ª dose.
    expect(elegivelParaFluxoNovo(item({ frequencia: '4em4h' }))).toBe(true);
    expect(elegivelParaFluxoNovo(item({ frequencia: '12em12h' }))).toBe(true);
    expect(elegivelParaFluxoNovo(item({ frequencia: '1xDia' }))).toBe(true);
  });

  it('SOS / se necessário / dose única seguem fora do fluxo por dose', () => {
    for (const frequencia of ['agora', 'SOS', 'seNecessario']) {
      expect(elegivelParaFluxoNovo(item({ frequencia }))).toBe(false);
    }
  });

  it('sem hora e sem dose dada NÃO há horário previsto', () => {
    const i = item();
    expect(temHoraInicio(i)).toBe(false);
    expect(semAncoraDeHorario(i)).toBe(true);
    // null é o que impede a 1ª dose de nascer "atrasada" contra a meia-noite.
    expect(horarioPrevistoDoItem(i)).toBeNull();
  });

  it('a 1ª execução cria a âncora: a partir dela existe horário previsto', () => {
    const i = item({ dosesExecutadas: 1, proximaDoseEm: '2026-08-24T11:00:00.000Z' });
    expect(semAncoraDeHorario(i)).toBe(false);
    expect(horarioPrevistoDoItem(i)).toBe(i.proximaDoseEm);
  });

  it('sem âncora o item fica disponível em toda a janela do curso', () => {
    const i = item({ duracaoDias: 3 });
    expect(dentroDaJanelaDoCurso(i, '2026-08-23')).toBe(true);
    expect(dentroDaJanelaDoCurso(i, '2026-08-25')).toBe(true);
    expect(dentroDaJanelaDoCurso(i, '2026-08-26')).toBe(false);
    expect(dentroDaJanelaDoCurso(i, '2026-08-22')).toBe(false);
  });
});

describe('rolling schedule — a próxima dose parte do horário REAL da anterior', () => {
  it('12 em 12h executado às 20:00 → próxima às 08:00 do dia seguinte', () => {
    // O caso literal do pedido: "se foi executado às 20:00, a próxima deve ser 08:00".
    const executadaAs20 = new Date(2026, 7, 23, 20, 0, 0, 0); // 23/08/2026 20:00 local
    const proxima = calcularProximaDose(executadaAs20, '12em12h');
    expect(proxima.getHours()).toBe(8);
    expect(dataLocalDe(proxima)).toBe('2026-08-24');
  });

  it('respeita o intervalo de cada frequência intra-dia', () => {
    const base = new Date(2026, 7, 23, 10, 0, 0, 0);
    const horaDe = (f) => calcularProximaDose(base, f).getHours();
    expect(horaDe('1em1h')).toBe(11);
    expect(horaDe('4em4h')).toBe(14);
    expect(horaDe('6em6h')).toBe(16);
    expect(horaDe('8em8h')).toBe(18);
    expect(horaDe('12em12h')).toBe(22);
  });

  it('uma dose atrasada desloca a grade inteira (não volta ao horário prescrito)', () => {
    // Prescrito 08:00, mas a dose só saiu às 09:30 → a próxima é 21:30, não 20:00.
    const real = new Date(2026, 7, 23, 9, 30, 0, 0);
    const proxima = calcularProximaDose(real, '12em12h');
    expect(proxima.getHours()).toBe(21);
    expect(proxima.getMinutes()).toBe(30);
  });

  it('multi-dia conta em dias, não em horas', () => {
    const base = new Date(2026, 7, 23, 9, 0, 0, 0);
    expect(dataLocalDe(calcularProximaDose(base, '1xSemana'))).toBe('2026-08-30');
    expect(dataLocalDe(calcularProximaDose(base, '1x2dias'))).toBe('2026-08-25');
  });
});

describe('classificarExecucao — é ela que separa antecipada de atrasada', () => {
  const previsto = new Date(2026, 7, 23, 20, 0, 0, 0);

  it('antes do horário = ANTECIPADA (execução futura, exige justificativa)', () => {
    expect(classificarExecucao(new Date(2026, 7, 23, 18, 0), previsto)).toBe('ANTECIPADA');
  });

  it('depois do horário = ATRASADA (só confirmação)', () => {
    expect(classificarExecucao(new Date(2026, 7, 23, 22, 0), previsto)).toBe('ATRASADA');
  });

  it('tolera o clique poucos segundos fora do horário', () => {
    expect(classificarExecucao(new Date(2026, 7, 23, 20, 1), previsto)).toBe('NO_HORARIO');
    expect(classificarExecucao(new Date(2026, 7, 23, 19, 59), previsto)).toBe('NO_HORARIO');
  });
});

describe('dosesTotaisEsperadas', () => {
  it('conta as doses do curso inteiro pela frequência × duração', () => {
    expect(dosesTotaisEsperadas(item({ frequencia: '12em12h', duracaoDias: 1 }))).toBe(2);
    expect(dosesTotaisEsperadas(item({ frequencia: '12em12h', duracaoDias: 3 }))).toBe(6);
    expect(dosesTotaisEsperadas(item({ frequencia: '8em8h',   duracaoDias: 2 }))).toBe(6);
    expect(dosesTotaisEsperadas(item({ frequencia: '1xDia',   duracaoDias: 5 }))).toBe(5);
    // "1x/semana × 4" é guardado como 28 dias — 4 doses, não 28.
    expect(dosesTotaisEsperadas(item({ frequencia: '1xSemana', duracaoDias: 28 }))).toBe(4);
  });
});
