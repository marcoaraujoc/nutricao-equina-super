// backend/src/__tests__/memoriaClinicaEconomia.test.js
//
// A Memória Clínica só pode chamar a IA quando o histórico do paciente MUDOU desde a
// última consolidação. Abrir a ficha de novo NÃO pode custar uma chamada.
//
// São TRÊS perguntas diferentes, e as três precisam de resposta:
//   1. Abrir a tela → `obterResumo` NUNCA chama o LLM (só diz se está desatualizado).
//   2. Nada mudou → `atualizarResumo` devolve o salvo, sem chamar o LLM.
//   3. Duas chamadas SIMULTÂNEAS para o mesmo paciente → UMA chamada de LLM.
//      Esta é a que a checagem de "mudou?" não pega: as duas leem o banco antes de
//      qualquer uma gravar, e as duas concluem que está desatualizado. Acontece em
//      StrictMode (o efeito monta duas vezes), em duas abas e em dois profissionais
//      no mesmo paciente.
//
// ⚠️ Nomes com prefixo `mock` são exigência do jest: a fábrica de `jest.mock` não
// pode referenciar variável de fora do escopo sem esse prefixo.

const mockCallAI      = jest.fn();
const mockLinhaMemoria = [];
const mockListas = {
  evolucaoClinica: jest.fn(), vacinaClinica: jest.fn(), exameClinico: jest.fn(),
  encaminhamentoClinico: jest.fn(), prescricaoGrupo: jest.fn(),
  faturaItem: jest.fn(), documentoEmitido: jest.fn(),
};
const mockQueryRaw   = jest.fn();
const mockExecuteRaw = jest.fn();

jest.mock('../ai', () => ({
  callAI: (...args) => mockCallAI(...args),
  MODULOS_IA: { MEMORIA_CLINICA: 'MEMORIA_CLINICA' },
}), { virtual: true });

jest.mock('../lib/prisma', () => ({
  default: {
    $queryRawUnsafe:   (...a) => mockQueryRaw(...a),
    $executeRawUnsafe: (...a) => mockExecuteRaw(...a),
    evolucaoClinica:       { findMany: (...a) => mockListas.evolucaoClinica(...a) },
    vacinaClinica:         { findMany: (...a) => mockListas.vacinaClinica(...a) },
    exameClinico:          { findMany: (...a) => mockListas.exameClinico(...a) },
    encaminhamentoClinico: { findMany: (...a) => mockListas.encaminhamentoClinico(...a) },
    prescricaoGrupo:       { findMany: (...a) => mockListas.prescricaoGrupo(...a) },
    faturaItem:            { findMany: (...a) => mockListas.faturaItem(...a) },
    documentoEmitido:      { findMany: (...a) => mockListas.documentoEmitido(...a) },
  },
}), { virtual: true });

const { obterResumo, atualizarResumo, VERSAO_ATUAL, consolidacoesEmCurso } =
  require('../services/resumoAtendimentoService');

const req = { empresaId: 59, user: { id: 1 } };

// Uma evolução só, para haver ao menos um evento a consolidar.
const UMA_EVOLUCAO = [{
  id: 7, titulo: 'Teste', especialidade: null, texto: 'x',
  dataInicio: new Date('2026-08-21T10:00:00Z'), status: 'FINALIZADA',
}];

/** Grava no "banco" o que o serviço acabou de persistir, como o Postgres faria. */
function guardarComoSalvo() {
  // Ordem do INSERT em salvarRegistro:
  //   0 sql · 1 animalId · 2 empresaId · 3 resumo · 4 dados · 5 versao · 6 ultimoEvento · 7 total
  const [, , , resumo, dadosJson, versao, ultimoEventoEm, total] =
    mockExecuteRaw.mock.calls.at(-1);
  mockLinhaMemoria.length = 0;
  mockLinhaMemoria.push({
    id: 1, resumo, dados: dadosJson, versaoPrompt: versao,
    ultimoEventoEm, totalEventos: total, updatedAt: new Date(),
  });
  return versao;
}

beforeEach(() => {
  jest.clearAllMocks();
  consolidacoesEmCurso.clear();
  mockLinhaMemoria.length = 0;
  mockListas.evolucaoClinica.mockResolvedValue(UMA_EVOLUCAO);
  for (const k of Object.keys(mockListas)) {
    if (k !== 'evolucaoClinica') mockListas[k].mockResolvedValue([]);
  }
  mockQueryRaw.mockImplementation(() => Promise.resolve(mockLinhaMemoria.slice(0, 1)));
  mockExecuteRaw.mockResolvedValue(1);
  mockCallAI.mockResolvedValue(JSON.stringify({
    resumo:     ['No [[t1|atendimento de 21/08/2026]] houve avaliação.'],
    mudancas:   [],
    topicos:    [{ id: 't1', ref: 'evolucao-7', texto: 'Avaliação clínica.' }],
    highlights: [],
  }));
});

describe('Abrir a tela não custa uma chamada de IA', () => {
  test('obterResumo NUNCA chama o LLM — nem quando está desatualizado', async () => {
    const saida = await obterResumo(req, 92);
    expect(mockCallAI).not.toHaveBeenCalled();
    expect(saida.desatualizado).toBe(true);   // ainda não há registro salvo
  });

  test('com o registro em dia, obterResumo devolve desatualizado=false', async () => {
    await atualizarResumo(req, 92, 'Corbela');
    guardarComoSalvo();

    mockCallAI.mockClear();
    const saida = await obterResumo(req, 92);
    expect(saida.desatualizado).toBe(false);
    expect(mockCallAI).not.toHaveBeenCalled();
  });
});

describe('Nada mudou → nenhuma chamada de IA', () => {
  test('atualizarResumo devolve o salvo sem chamar o LLM', async () => {
    await atualizarResumo(req, 92, 'Corbela');
    expect(mockCallAI).toHaveBeenCalledTimes(1);
    expect(guardarComoSalvo()).toBe(VERSAO_ATUAL);

    mockCallAI.mockClear();
    await atualizarResumo(req, 92, 'Corbela');
    expect(mockCallAI).not.toHaveBeenCalled();
  });

  test('mesmo reabrindo várias vezes, segue sem chamar', async () => {
    await atualizarResumo(req, 92, 'Corbela');
    guardarComoSalvo();

    mockCallAI.mockClear();
    for (let i = 0; i < 5; i++) {
      await obterResumo(req, 92);
      await atualizarResumo(req, 92, 'Corbela');
    }
    expect(mockCallAI).not.toHaveBeenCalled();
  });
});

describe('Chamadas simultâneas para o mesmo paciente', () => {
  test('duas ao mesmo tempo = UMA chamada de IA', async () => {
    const [a, b] = await Promise.all([
      atualizarResumo(req, 92, 'Corbela'),
      atualizarResumo(req, 92, 'Corbela'),
    ]);
    expect(mockCallAI).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);   // a segunda recebe o resultado da primeira
  });

  test('pacientes diferentes NÃO compartilham a consolidação', async () => {
    await Promise.all([
      atualizarResumo(req, 92, 'Corbela'),
      atualizarResumo(req, 93, 'Outro'),
    ]);
    expect(mockCallAI).toHaveBeenCalledTimes(2);
  });

  test('empresas diferentes NÃO compartilham — a memória é por empresa', async () => {
    await Promise.all([
      atualizarResumo({ ...req, empresaId: 59 }, 92, 'Corbela'),
      atualizarResumo({ ...req, empresaId: 42 }, 92, 'Corbela'),
    ]);
    expect(mockCallAI).toHaveBeenCalledTimes(2);
  });

  test('a trava é liberada ao terminar', async () => {
    await atualizarResumo(req, 92, 'Corbela');
    expect(consolidacoesEmCurso.size).toBe(0);
  });

  test('falha também libera a trava — senão o paciente ficaria travado para sempre', async () => {
    mockCallAI.mockRejectedValue(new Error('Gemini API error 503'));
    await expect(atualizarResumo(req, 92, 'Corbela')).rejects.toThrow('503');
    expect(consolidacoesEmCurso.size).toBe(0);
  });
});
