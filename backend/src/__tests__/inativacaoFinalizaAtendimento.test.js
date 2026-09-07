// backend/src/__tests__/inativacaoFinalizaAtendimento.test.js
//
// INATIVAR O PACIENTE FECHA O ATENDIMENTO ABERTO (regra de 2026-09-06).
//
// 🔴 O PROBLEMA QUE ELA RESOLVE: a evolução EM_ANDAMENTO ficava aberta PARA SEMPRE.
// O prontuário congelava e o guard (`bloquearSeAnimalInativo`) passava a recusar toda
// escrita — inclusive a própria finalização. Ou seja: ninguém, nem o gestor, conseguia
// mais fechar aquele atendimento, e ele ficava pendurado na tela e nas listas.
// Congelar um atendimento no meio não é deixá-lo em aberto; é fechá-lo.
//
// 🔴 E FECHA PELA MESMA CASCATA DO "Finalizar" NORMAL — é o que "respeitando todas as
// demais regras da aplicação" quer dizer. Prescrição e vacina SALVAS vão para o
// plantão, o agendamento sai de EM_ANDAMENTO, os exames vão para a fatura. Uma cópia
// própria divergiria em silêncio: o atendimento fechado por um caminho mandaria a
// prescrição ao plantão e pelo outro não, sem nada acusar.
'use strict';

const fs   = require('fs');
const path = require('path');

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });
jest.mock('../lib/logger', () => ({ warn: () => {}, error: () => {}, info: () => {} }), { virtual: true });
// `faturaUtils` puxa o storage/prisma real; só o contrato importa aqui.
jest.mock('../lib/faturaUtils', () => ({ lancarExameNaFatura: jest.fn(async () => {}) }), { virtual: true });

const { cascataDaFinalizacao } = require('../lib/finalizacaoEvolucao');

/** tx falso que registra o que foi escrito, com a semântica de status que importa. */
function txFalso({ grupos = [], agendamento = null } = {}) {
  const eventos = [];
  return {
    eventos,
    agendamentoClinico: {
      updateMany: async ({ where, data }) => {
        eventos.push(['agendamento', where, data]);
        const casa = agendamento && agendamento.id === where.id && agendamento.status === where.status;
        return { count: casa ? 1 : 0 };
      },
    },
    prescricaoGrupo: {
      findMany: async ({ where }) => grupos.filter(g => g.evolucaoId === where.evolucaoId && g.status === where.status),
      updateMany: async ({ where, data }) => { eventos.push(['grupo', where, data]); return { count: 1 }; },
    },
    prescricao: {
      updateMany: async ({ where, data }) => { eventos.push(['itens', where, data]); return { count: 1 }; },
    },
    $executeRawUnsafe: async (sql, ...p) => { eventos.push(['sql', sql.replace(/\s+/g, ' ').trim(), p]); return 1; },
  };
}

describe('cascata da finalização — fonte única do Finalizar e da inativação', () => {

  test('prescrição SALVA vai para FINALIZADO e os itens para ATIVA (entram no plantão)', async () => {
    const tx = txFalso({ grupos: [{ id: 7, evolucaoId: 50, status: 'SALVO' }] });
    const r = await cascataDaFinalizacao(tx, 50, { porUsuarioId: 9 });

    expect(r.grupos).toEqual([7]);
    const itens = tx.eventos.find(([t]) => t === 'itens');
    expect(itens[2]).toEqual({ status: 'ATIVA' });
    const grupo = tx.eventos.find(([t]) => t === 'grupo');
    expect(grupo[2]).toMatchObject({ status: 'FINALIZADO', finalizadoPorId: 9 });
  });

  test('vacina SALVA vira FINALIZADA — e só ela', async () => {
    const tx = txFalso();
    await cascataDaFinalizacao(tx, 50, { porUsuarioId: 9 });
    const sql = tx.eventos.find(([t, s]) => t === 'sql' && s.includes('tb_vacinas_clinicas'));
    expect(sql).toBeDefined();
    // Idempotência: só toca o que está SALVA e ativo — rodar duas vezes não promove
    // o que já passou adiante nem ressuscita o cancelado.
    expect(sql[1]).toContain("status = 'SALVA'");
    expect(sql[1]).toContain('ativo = true');
  });

  test('agendamento só sai de EM_ANDAMENTO (CONCLUIDO manual não é tocado)', async () => {
    const tx = txFalso({ agendamento: { id: 3, status: 'EM_ANDAMENTO' } });
    const r = await cascataDaFinalizacao(tx, 50, { agendamentoId: 3, porUsuarioId: 9 });
    expect(r.agendamento).toBe(true);
    const ag = tx.eventos.find(([t]) => t === 'agendamento');
    expect(ag[1]).toMatchObject({ id: 3, status: 'EM_ANDAMENTO' });
    expect(ag[2]).toEqual({ status: 'FINALIZADO' });
  });

  test('evolução avulsa (sem agendamento) não tenta mexer em agenda nenhuma', async () => {
    const tx = txFalso();
    const r = await cascataDaFinalizacao(tx, 50, { agendamentoId: null, porUsuarioId: 9 });
    expect(r.agendamento).toBe(false);
    expect(tx.eventos.some(([t]) => t === 'agendamento')).toBe(false);
  });

  test('sem prescrição SALVA, nada é promovido (idempotente)', async () => {
    const tx = txFalso({ grupos: [{ id: 7, evolucaoId: 50, status: 'FINALIZADO' }] });
    const r = await cascataDaFinalizacao(tx, 50, { porUsuarioId: 9 });
    expect(r.grupos).toEqual([]);
    expect(tx.eventos.some(([t]) => t === 'grupo')).toBe(false);
  });

  test('a prescrição promovida tem a VERSÃO invalidada (tela aberta leva 409)', async () => {
    const tx = txFalso({ grupos: [{ id: 7, evolucaoId: 50, status: 'SALVO' }] });
    await cascataDaFinalizacao(tx, 50, { porUsuarioId: 9 });
    const bump = tx.eventos.find(([t, s]) => t === 'sql' && s.includes('tb_prescricao_grupos'));
    expect(bump).toBeDefined();
    expect(bump[1]).toContain('"versao" = "versao" + 1');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('GATE — a inativação fecha o atendimento pelo MESMO caminho', () => {
  const ANIMAL = path.join(__dirname, '..', 'controllers', 'AnimalController.js');

  /**
   * ⚠️ A varredura IGNORA COMENTÁRIOS. Sem isto ela acusa o PRÓPRIO comentário que
   * explica a regra ("`veterinarioId` NÃO MUDA") como se fosse a violação — e um gate
   * que reprova a documentação da regra é um gate que se aprende a ignorar. Mesma
   * lição do gate de e-mail (CLAUDE.md, §12).
   */
  function semComentarios(txt) {
    return txt.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  }

  function corpoDoInativar() {
    const src = fs.readFileSync(ANIMAL, 'utf8');
    const i = src.indexOf('async inativar(');
    expect(i).toBeGreaterThan(-1);
    return semComentarios(src.slice(i, src.indexOf('async ativar(', i)));
  }

  test('finaliza as evoluções EM_ANDAMENTO do paciente', () => {
    const corpo = corpoDoInativar();
    expect(corpo).toContain("status: 'EM_ANDAMENTO'");
    expect(corpo).toContain("status:  'FINALIZADA'");
  });

  test('🔴 reusa a cascata — não reimplementa as transições', () => {
    // O modo de quebrar isto é escrever "só o updateMany da evolução" num ajuste
    // futuro: o atendimento fecha, mas a prescrição fica presa em SALVO e nunca
    // chega ao plantão. Nada na tela acusa.
    expect(corpoDoInativar()).toContain('cascataDaFinalizacao');
  });

  test('🔴 NÃO rouba a autoria: `veterinarioId` não é reescrito', () => {
    // No Finalizar normal quem finaliza vira o responsável, porque ESCOLHEU fechar o
    // atendimento e responde pelo que ele declara. Aqui ninguém conduziu nada — é
    // consequência administrativa. Carimbar quem inativou como autor do prontuário
    // alheio seria falsear a autoria clínica.
    const corpo = corpoDoInativar();
    const update = corpo.slice(corpo.indexOf('tx.evolucaoClinica.update'), corpo.indexOf('cascataDaFinalizacao'));
    expect(update).not.toContain('veterinarioId');
    expect(update).toContain('modificadoPorId');
  });

  test('a evolução fechada tem a versão invalidada', () => {
    expect(corpoDoInativar()).toContain('invalidarVersoes');
  });

  test('os exames vão para a fatura DEPOIS do commit (fora da transaction)', () => {
    // Fatura de destino PAGA faz o helper lançar; dentro da transaction isso
    // REVERTERIA a inativação e prenderia o paciente num estado pela metade.
    const corpo = corpoDoInativar();
    const tx = corpo.slice(corpo.indexOf('prisma.$transaction'), corpo.indexOf('res.json'));
    expect(tx).not.toContain('lancarExamesDaEvolucao');
    expect(corpo).toContain('lancarExamesDaEvolucao');
  });
});
