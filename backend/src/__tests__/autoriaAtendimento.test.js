'use strict';

/**
 * PREMISSA DE AUTORIA (2026-08-04) e ARRASTO DO ATENDIMENTO.
 *
 * Estas duas regras são silenciosas quando quebram: um erro na autoria libera o
 * prontuário alheio (ou tranca o próprio dono com 403), e um erro no arrasto deixa
 * prescrição/exame/encaminhamento com o profissional antigo — quem assumiu o
 * atendimento fica sem poder operá-lo. Nenhum dos dois aparece em teste de fumaça.
 *
 * `permissao.middleware` puxa `lib/prisma.ts` (TypeScript) na cadeia de require, que o
 * jest deste projeto não transpila — por isso o módulo é mockado. O que está sob teste
 * é a REGRA, não o acesso ao banco.
 */

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });

const { podeOperarRegistro, ehGestorNoContexto } = require('../middlewares/permissao.middleware');
const { transferirFilhosDasEvolucoes, transferirEvolucoesDoAgendamento } = require('../lib/transferenciaAtendimento');

const req = ({ userId = 10, nivel = 'PROPRIO', cargo = 'VETERINARIO', userType = 'VETERINARIO' } = {}) => ({
  user: { id: userId, userType },
  permissaoNivel: nivel,
  membroCargo: cargo,
});

describe('podeOperarRegistro — a ação vale sobre o que é de quem a executa', () => {
  it('deixa o autor operar o próprio registro', () => {
    expect(podeOperarRegistro(req(), 10)).toBe(true);
  });

  it('BLOQUEIA o registro de outro profissional, mesmo com nível EQUIPE', () => {
    expect(podeOperarRegistro(req({ nivel: 'EQUIPE' }), 99)).toBe(false);
  });

  it('BLOQUEIA o registro de outro mesmo com FULL vindo da matriz (não é gestor)', () => {
    // FULL é nível, não cargo: conceder FULL a um perfil comum não pode virar
    // passe livre para o prontuário alheio.
    expect(podeOperarRegistro(req({ nivel: 'FULL' }), 99)).toBe(false);
  });

  it('deixa o GESTOR operar o registro de qualquer um', () => {
    expect(podeOperarRegistro(req({ cargo: 'GESTOR', nivel: 'FULL' }), 99)).toBe(true);
  });

  it('deixa o ADMIN da plataforma operar o registro de qualquer um', () => {
    expect(podeOperarRegistro(req({ cargo: null, userType: 'ADMIN', nivel: 'FULL' }), 99)).toBe(true);
  });

  it('barra quem só tem LEITURA, ainda que seja o autor', () => {
    expect(podeOperarRegistro(req({ nivel: 'LEITURA' }), 10)).toBe(false);
    expect(podeOperarRegistro(req({ nivel: 'NEGADO' }), 10)).toBe(false);
  });

  it('registro órfão (sem responsável) só é operado pelo gestor', () => {
    expect(podeOperarRegistro(req(), null)).toBe(false);
    expect(podeOperarRegistro(req({ cargo: 'GESTOR' }), null)).toBe(true);
  });

  it('ehGestorNoContexto não confunde nível FULL com cargo de gestor', () => {
    expect(ehGestorNoContexto(req({ nivel: 'FULL' }))).toBe(false);
    expect(ehGestorNoContexto(req({ cargo: 'GESTOR' }))).toBe(true);
  });
});

// ── Transaction falsa: registra o que foi lido e escrito, sem banco ──────────────
function fakeTx(dados) {
  const chamadas = [];
  const modelo = (nome) => ({
    findMany: async ({ where }) => {
      chamadas.push([nome, 'findMany', where]);
      return (dados[nome] ?? []).filter(r => {
        if (where.evolucaoId?.in && !where.evolucaoId.in.includes(r.evolucaoId)) return false;
        if (where.agendamentoId != null && r.agendamentoId !== where.agendamentoId) return false;
        if (where.ativo === true && r.ativo === false) return false;
        if (where.status?.in && !where.status.in.includes(r.status)) return false;
        return true;
      });
    },
    updateMany: async ({ where, data }) => {
      chamadas.push([nome, 'updateMany', where, data]);
      return { count: 1 };
    },
  });
  return {
    chamadas,
    prescricaoGrupo:       modelo('prescricaoGrupo'),
    exameClinico:          modelo('exameClinico'),
    encaminhamentoClinico: modelo('encaminhamentoClinico'),
    vacinaClinica:         modelo('vacinaClinica'),
    prescricao:            modelo('prescricao'),
    evolucaoClinica:       modelo('evolucaoClinica'),
  };
}

describe('arrasto do atendimento — quem assume a cabeça assume tudo embaixo', () => {
  it('move prescrição, exame, encaminhamento e vacina da evolução', async () => {
    const tx = fakeTx({
      prescricaoGrupo:       [{ id: 1, animalId: 7, veterinarioId: 3, evolucaoId: 50 }],
      exameClinico:          [{ id: 2, animalId: 7, veterinarioId: 3, evolucaoId: 50, ativo: true }],
      encaminhamentoClinico: [{ id: 3, animalId: 7, veterinarioId: 3, evolucaoId: 50, ativo: true }],
      vacinaClinica:         [{ id: 4, animalId: 7, veterinarioId: 3, evolucaoId: 50, ativo: true }],
    });

    const movidos = await transferirFilhosDasEvolucoes(tx, [50], 9);

    expect(movidos.map(m => m.entidade).sort())
      .toEqual(['ENCAMINHAMENTO', 'EXAME_CLINICO', 'PRESCRICAO', 'VACINA']);
    expect(movidos.every(m => m.deVetId === 3)).toBe(true);
    // Os ITENS da prescrição vão junto — a autoria do item é avaliada por eles
    expect(tx.chamadas.some(([m, op]) => m === 'prescricao' && op === 'updateMany')).toBe(true);
  });

  it('não reporta como movido o registro que já era de quem assume', async () => {
    const tx = fakeTx({
      exameClinico: [{ id: 2, animalId: 7, veterinarioId: 9, evolucaoId: 50, ativo: true }],
    });
    expect(await transferirFilhosDasEvolucoes(tx, [50], 9)).toEqual([]);
  });

  it('arrasta o registro ÓRFÃO (sem responsável) — é o que ninguém consegue operar', async () => {
    const tx = fakeTx({
      exameClinico: [{ id: 2, animalId: 7, veterinarioId: null, evolucaoId: 50, ativo: true }],
    });
    const movidos = await transferirFilhosDasEvolucoes(tx, [50], 9);
    expect(movidos).toHaveLength(1);
    expect(movidos[0].deVetId).toBeNull();
  });

  it('ignora registro inativo (soft delete)', async () => {
    const tx = fakeTx({
      exameClinico: [{ id: 2, animalId: 7, veterinarioId: 3, evolucaoId: 50, ativo: false }],
    });
    expect(await transferirFilhosDasEvolucoes(tx, [50], 9)).toEqual([]);
  });

  it('sem evolução informada, não toca em nada', async () => {
    const tx = fakeTx({});
    expect(await transferirFilhosDasEvolucoes(tx, [], 9)).toEqual([]);
    expect(tx.chamadas).toHaveLength(0);
  });

  it('pelo agendamento: só arrasta evolução EM_ANDAMENTO (finalizada é histórico fechado)', async () => {
    const tx = fakeTx({
      evolucaoClinica: [
        { id: 50, animalId: 7, veterinarioId: 3, agendamentoId: 80, ativo: true, status: 'EM_ANDAMENTO' },
        { id: 51, animalId: 7, veterinarioId: 3, agendamentoId: 80, ativo: true, status: 'FINALIZADA' },
      ],
      exameClinico: [{ id: 2, animalId: 7, veterinarioId: 3, evolucaoId: 50, ativo: true }],
    });

    const movidos = await transferirEvolucoesDoAgendamento(tx, 80, 9);
    const evolucoes = movidos.filter(m => m.entidade === 'EVOLUCAO');

    expect(evolucoes).toHaveLength(1);
    expect(evolucoes[0].entidadeId).toBe(50);
    expect(movidos.some(m => m.entidade === 'EXAME_CLINICO')).toBe(true);
  });
});
