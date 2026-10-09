// Fechamento da fatura: "último dia útil do mês" (ULTIMO_DIA_UTIL) e "primeiro dia
// útil do mês" (atalho de tela = DIA_UTIL dia 1). 2026-10-09.
const { deveFecharHoje, ultimoDiaUtil, TIPOS_FECHAMENTO_VALIDOS, TIPOS_FECHAMENTO_SEM_DIA } = require('../lib/faturaUtils');

const d = (s) => { const [a, m, dia] = s.split('-').map(Number); return new Date(a, m - 1, dia); };
const ULTIMO_UTIL = { tipoFechamento: 'ULTIMO_DIA_UTIL', diaFechamentoFatura: null };
const PRIMEIRO_UTIL = { tipoFechamento: 'DIA_UTIL', diaFechamentoFatura: 1 };

describe('ULTIMO_DIA_UTIL', () => {
  it('é tipo válido e não usa número', () => {
    expect(TIPOS_FECHAMENTO_VALIDOS).toContain('ULTIMO_DIA_UTIL');
    expect(TIPOS_FECHAMENTO_SEM_DIA).toEqual(['ULTIMO_DIA_MES', 'ULTIMO_DIA_UTIL']);
  });

  it('mês que termina em dia útil fecha no último dia', () => {
    // 30/09/2026 é quarta
    expect(deveFecharHoje(ULTIMO_UTIL, d('2026-09-30'))).toBe(true);
    expect(deveFecharHoje(ULTIMO_UTIL, d('2026-09-29'))).toBe(false);
  });

  it('mês que termina no fim de semana recua para a sexta', () => {
    // 31/10/2026 é sábado → sexta 30/10
    expect(deveFecharHoje(ULTIMO_UTIL, d('2026-10-30'))).toBe(true);
    expect(deveFecharHoje(ULTIMO_UTIL, d('2026-10-31'))).toBe(false);
  });

  it('pula feriado nacional (Natal no fim de dezembro não conta, 31/12 sim)', () => {
    // 31/12/2027 é sexta, dia útil
    expect(chave(ultimoDiaUtil(d('2027-12-05')))).toBe('2027-12-31');
    // fev/2026: 28 é sábado → sexta 27
    expect(chave(ultimoDiaUtil(d('2026-02-10')))).toBe('2026-02-27');
  });
});

describe('primeiro dia útil = DIA_UTIL dia 1', () => {
  it('mês que começa no domingo fecha na segunda', () => {
    // 01/11/2026 é domingo; 02/11 é Finados (feriado) → terça 03/11
    expect(deveFecharHoje(PRIMEIRO_UTIL, d('2026-11-03'))).toBe(true);
    expect(deveFecharHoje(PRIMEIRO_UTIL, d('2026-11-02'))).toBe(false);
  });
});

function chave(x) {
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
