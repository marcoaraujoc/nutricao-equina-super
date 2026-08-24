// backend/src/__tests__/fusoEmpresa.test.js
//
// Trava o fuso POR EMPRESA (migration 20260823000000). A aplicação roda nos 4 fusos
// do Brasil e o processo Node roda fixo em America/Sao_Paulo (server.ts) — então
// tudo que é "hora da clínica" precisa passar por aqui, com `timeZone` EXPLÍCITO.

const {
  FUSO_PADRAO,
  fusoPorUf,
  fusoPorCep,
  fusoPorEndereco,
  rotuloFuso,
  normalizarFuso,
  diaNaEmpresa,
  formatarHoraNaEmpresa,
  formatarDataNaEmpresa,
  formatarNaEmpresa,
  instanteNoFuso,
} = require('../lib/fusoEmpresa');

// Instante único: 24/08/2026 10:44 UTC = 07:44 em Brasília.
const INSTANTE = new Date('2026-08-24T10:44:00.000Z');

describe('formatação no fuso da clínica', () => {
  it('mostra o relógio de cada praça para o MESMO instante', () => {
    expect(formatarHoraNaEmpresa(INSTANTE, 'America/Noronha')).toBe('08:44');    // UTC−2
    expect(formatarHoraNaEmpresa(INSTANTE, 'America/Sao_Paulo')).toBe('07:44');  // UTC−3
    expect(formatarHoraNaEmpresa(INSTANTE, 'America/Manaus')).toBe('06:44');     // UTC−4
    expect(formatarHoraNaEmpresa(INSTANTE, 'America/Rio_Branco')).toBe('05:44'); // UTC−5
  });

  it('formata data e data+hora', () => {
    expect(formatarDataNaEmpresa(INSTANTE, 'America/Manaus')).toBe('24/08/2026');
    expect(formatarNaEmpresa(INSTANTE, 'America/Manaus')).toBe('24/08/2026 06:44');
  });

  it('sem fuso configurado cai no padrão (comportamento anterior)', () => {
    expect(formatarHoraNaEmpresa(INSTANTE, null)).toBe(
      formatarHoraNaEmpresa(INSTANTE, FUSO_PADRAO),
    );
  });

  it('fuso inválido não derruba a requisição — cai no padrão', () => {
    expect(formatarHoraNaEmpresa(INSTANTE, 'Nao/Existe')).toBe('07:44');
  });

  it('data inválida devolve vazio em vez de lançar', () => {
    expect(formatarHoraNaEmpresa('nao é data', 'America/Manaus')).toBe('');
    expect(diaNaEmpresa(null, 'America/Manaus')).toBeNull();
  });
});

describe('diaNaEmpresa — de que DIA é a dose', () => {
  it('a virada do dia acontece em horas diferentes em cada fuso', () => {
    // 25/08 02:00 UTC: já é dia 25 em Brasília (23:00 do dia 24), mas ainda é
    // dia 24 em Manaus (22:00) e no Acre (21:00). É exatamente esse desencontro
    // que fazia a dose da noite ser contabilizada no dia errado.
    const virada = new Date('2026-08-25T02:00:00.000Z');
    expect(diaNaEmpresa(virada, 'America/Sao_Paulo')).toBe('2026-08-24');
    expect(diaNaEmpresa(virada, 'America/Manaus')).toBe('2026-08-24');
    expect(diaNaEmpresa(virada, 'America/Rio_Branco')).toBe('2026-08-24');

    // 25/08 03:00 UTC: meia-noite em Brasília — vira o dia LÁ, mas não no Amazonas.
    const meiaNoiteBSB = new Date('2026-08-25T03:00:00.000Z');
    expect(diaNaEmpresa(meiaNoiteBSB, 'America/Sao_Paulo')).toBe('2026-08-25');
    expect(diaNaEmpresa(meiaNoiteBSB, 'America/Manaus')).toBe('2026-08-24');
    expect(diaNaEmpresa(meiaNoiteBSB, 'America/Rio_Branco')).toBe('2026-08-24');
  });
});

describe('instanteNoFuso — "HH:MM na clínica" vira o instante certo', () => {
  it('08:00 é 08:00 no relógio de cada praça (ida e volta)', () => {
    for (const fuso of ['America/Noronha', 'America/Sao_Paulo', 'America/Manaus', 'America/Rio_Branco']) {
      const i = instanteNoFuso(2026, 8, 24, 8, 0, fuso);
      expect(formatarHoraNaEmpresa(i, fuso)).toBe('08:00');
      expect(diaNaEmpresa(i, fuso)).toBe('2026-08-24');
    }
  });

  it('produz UTC diferente por fuso — é o que corrige a Hora Início', () => {
    // 08:00 em Manaus (UTC−4) é 12:00 UTC; em Brasília (UTC−3), 11:00 UTC.
    expect(instanteNoFuso(2026, 8, 24, 8, 0, 'America/Manaus').toISOString())
      .toBe('2026-08-24T12:00:00.000Z');
    expect(instanteNoFuso(2026, 8, 24, 8, 0, 'America/Sao_Paulo').toISOString())
      .toBe('2026-08-24T11:00:00.000Z');
  });

  it('mantém o DIA correto em horário de virada', () => {
    // 23:30 no Acre é 04:30 UTC do dia seguinte — o dia da clínica continua 24.
    const i = instanteNoFuso(2026, 8, 24, 23, 30, 'America/Rio_Branco');
    expect(i.toISOString()).toBe('2026-08-25T04:30:00.000Z');
    expect(diaNaEmpresa(i, 'America/Rio_Branco')).toBe('2026-08-24');
  });
});

// O gestor NÃO escolhe fuso — ele é deduzido do endereço que o cadastro já coleta.
// Estes casos são o contrato dessa dedução.
describe('dedução do fuso pelo endereço', () => {
  it('UF resolve os quatro fusos do país', () => {
    expect(fusoPorUf('SP')).toBe('America/Sao_Paulo');    // UTC−3
    expect(fusoPorUf('AM')).toBe('America/Manaus');       // UTC−4
    expect(fusoPorUf('MT')).toBe('America/Cuiaba');       // UTC−4
    expect(fusoPorUf('MS')).toBe('America/Campo_Grande'); // UTC−4
    expect(fusoPorUf('RO')).toBe('America/Porto_Velho');  // UTC−4
    expect(fusoPorUf('RR')).toBe('America/Boa_Vista');    // UTC−4
    expect(fusoPorUf('AC')).toBe('America/Rio_Branco');   // UTC−5
  });

  it('aceita a UF em minúscula e com espaço', () => {
    expect(fusoPorUf(' am ')).toBe('America/Manaus');
  });

  it('UF desconhecida devolve null (quem chama cai no padrão)', () => {
    expect(fusoPorUf('XX')).toBeNull();
    expect(fusoPorUf('')).toBeNull();
    expect(fusoPorUf(null)).toBeNull();
  });

  it('CEP resolve o estado, com ou sem máscara', () => {
    expect(fusoPorCep('01310-100')).toBe('America/Sao_Paulo');   // Av. Paulista
    expect(fusoPorCep('69050000')).toBe('America/Manaus');       // Manaus
    expect(fusoPorCep('69900-000')).toBe('America/Rio_Branco');  // Rio Branco
    expect(fusoPorCep('78000-000')).toBe('America/Cuiaba');      // Cuiabá
    expect(fusoPorCep('79002-000')).toBe('America/Campo_Grande');// Campo Grande
    expect(fusoPorCep('76800-000')).toBe('America/Porto_Velho'); // Porto Velho
    expect(fusoPorCep('90010-000')).toBe('America/Sao_Paulo');   // Porto Alegre
  });

  it('separa as faixas INTERCALADAS do 69xxx (AM / RR / AM / AC)', () => {
    // É por isso que a tabela é por intervalo e não por prefixo: o mesmo "69"
    // cobre Amazonas, Roraima e Acre.
    expect(fusoPorCep('69100-000')).toBe('America/Manaus');      // AM
    expect(fusoPorCep('69301-000')).toBe('America/Boa_Vista');   // RR
    expect(fusoPorCep('69500-000')).toBe('America/Manaus');      // AM de novo
    expect(fusoPorCep('69920-000')).toBe('America/Rio_Branco');  // AC
  });

  it('separa DF de GO, que também se intercalam no 7xxxx', () => {
    expect(fusoPorCep('70000-000')).toBe('America/Sao_Paulo');   // DF
    expect(fusoPorCep('72850-000')).toBe('America/Sao_Paulo');   // GO
    expect(fusoPorCep('73100-000')).toBe('America/Sao_Paulo');   // DF de novo
  });

  it('Fernando de Noronha (UTC−2) sai pelo CEP — a UF dela é PE, que é UTC−3', () => {
    expect(fusoPorCep('53990-000')).toBe('America/Noronha');
    expect(fusoPorUf('PE')).toBe('America/Recife');
    // e o endereço completo tem de escolher o CEP, não a UF
    expect(fusoPorEndereco({ cep: '53990-000', estado: 'PE' })).toBe('America/Noronha');
  });

  it('CEP tem precedência sobre a UF; sem CEP, a UF resolve', () => {
    expect(fusoPorEndereco({ cep: '69050-000', estado: 'AM' })).toBe('America/Manaus');
    expect(fusoPorEndereco({ cep: null, estado: 'AC' })).toBe('America/Rio_Branco');
    expect(fusoPorEndereco({ cep: '', estado: 'MT' })).toBe('America/Cuiaba');
  });

  it('endereço vazio/inválido devolve null — quem chama usa o padrão', () => {
    expect(fusoPorEndereco({})).toBeNull();
    expect(fusoPorEndereco({ cep: '123' })).toBeNull();
    expect(fusoPorEndereco()).toBeNull();
  });
});

describe('rotuloFuso — o que a tela EXIBE (o gestor não escolhe, só confere)', () => {
  it('mostra cidade e deslocamento', () => {
    expect(rotuloFuso('America/Manaus')).toBe('Manaus (UTC−4)');
    expect(rotuloFuso('America/Sao_Paulo')).toBe('Sao Paulo (UTC−3)');
    expect(rotuloFuso('America/Rio_Branco')).toBe('Rio Branco (UTC−5)');
    expect(rotuloFuso('America/Noronha')).toBe('Noronha (UTC−2)');
  });

  it('sem fuso cai no padrão e não lança com fuso inválido', () => {
    expect(rotuloFuso(null)).toBe('Sao Paulo (UTC−3)');
    expect(() => rotuloFuso('Nao/Existe')).not.toThrow();
  });
});

describe('normalizarFuso', () => {
  it('aceita fuso do Brasil, recusa o resto', () => {
    expect(normalizarFuso('America/Manaus')).toEqual({ valor: 'America/Manaus' });
    expect(normalizarFuso('Europe/Lisbon').erro).toBeTruthy();
    expect(normalizarFuso('America/Sao paulo').erro).toBeTruthy();
  });

  it('vazio volta ao padrão e undefined não altera', () => {
    expect(normalizarFuso('')).toEqual({ valor: null });
    expect(normalizarFuso(undefined)).toEqual({ valor: undefined });
  });
});
