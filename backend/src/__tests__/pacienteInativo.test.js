// backend/src/__tests__/pacienteInativo.test.js
//
// PACIENTE INATIVO = PRONTUÁRIO CONGELADO (decisão de produto, 2026-09-02).
//
// Inativar o paciente NÃO o esconde: evolução, prescrição, exame, encaminhamento,
// vacina, agendamento, dieta, histórico e os cancelamentos continuam todos visíveis.
// O que muda é que, a partir da data e hora da inativação, nada mais pode ser criado,
// alterado, finalizado, executado, cancelado ou excluído — até o gestor reativar.
//
// 🔴 POR QUE ESTE ARQUIVO É UM GATE ESTRUTURAL, e não só um teste de unidade: o modo
// de quebrar esta regra é ESQUECER o guard num caminho de escrita novo, e o sintoma é
// silencioso — o prontuário "congelado" muda depois de congelado e nada acusa. O teste
// varre o CÓDIGO dos controllers e reprova o handler de escrita que não chame o guard.
// Handler de escrita novo: acrescente-o à lista abaixo E ponha o guard nele.
'use strict';

const fs   = require('fs');
const path = require('path');

// `lib/prisma` é ESM transpilado pelo ts-node em produção; aqui vale um stub, porque
// nenhum teste deste arquivo toca o banco (o guard recebe um client falso).
jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });

const { bloquearSeAnimalInativo, MSG_PACIENTE_INATIVO } = require('../lib/animalInativo');

const DIR = path.join(__dirname, '..', 'controllers');

/** Recorta o corpo de um handler pelo nome, em qualquer um dos estilos do projeto. */
function corpoDoHandler(fonte, nome) {
  const inicio = [
    new RegExp(`^\\s{2}${nome}:\\s*async`, 'm'),      // objeto:  nome: async (req,res)
    new RegExp(`^\\s{2}async\\s+${nome}\\s*\\(`, 'm'), // classe:  async nome(req,res)
    new RegExp(`^const\\s+${nome}\\s*=\\s*async`, 'm'),// const:   const nome = async
    new RegExp(`^async\\s+function\\s+${nome}\\s*\\(`, 'm'),
  ].map(re => fonte.search(re)).filter(i => i >= 0);

  if (inicio.length === 0) return null;
  const de = Math.min(...inicio);

  // Fim = início do próximo handler de mesmo nível (ou do module.exports).
  const resto = fonte.slice(de + 1);
  const prox = resto.search(
    /^(\s{2}[a-zA-Z_]\w*:\s*async|\s{2}async\s+[a-zA-Z_]\w*\s*\(|const\s+\w+\s*=\s*async|async\s+function\s+\w+\s*\(|module\.exports)/m,
  );
  return prox < 0 ? fonte.slice(de) : fonte.slice(de, de + 1 + prox);
}

/**
 * Todo handler que ESCREVE algo pendurado no paciente.
 *
 * ⚠️ Deliberadamente FORA desta lista:
 *   • `AnimalController.inativar`/`ativar` — são a própria troca de estado; bloqueá-las
 *     trancaria o paciente inativo para sempre.
 *   • as rotas de LEITURA (listar/obter/`documentos.campos`) — o prontuário congelado
 *     é para ver, e bloquear a leitura é o oposto da regra.
 *   • FINANCEIRO (fatura/orçamento) — é dinheiro já lançado, não prontuário. Travar o
 *     fechamento de uma fatura porque o paciente foi inativado prenderia a cobrança da
 *     clínica sem nenhum ganho clínico.
 */
const ESCRITAS = {
  'EvolucaoController.js': [
    'criar', 'atualizar', 'excluir', 'cancelar', 'assumir', 'aprovar',
    'salvarTitulo', 'salvarResumoIa', 'adicionarMidia', 'removerMidia',
  ],
  'PrescricaoGrupoController.js': [
    'criar', 'adicionarItem', 'atualizarItem', 'removerItem', 'finalizar',
    'cancelar', 'cancelarNaExecucao', 'reabrirParaEdicao', 'executar',
    'atualizarHoraInicioPosExecucao',
  ],
  'VacinaClinicaController.js': ['registrar', 'atualizar', 'finalizar', 'executar', 'excluir'],
  'ExameClinicoController.js': [
    'criar', 'criarNaoPedido', 'atualizar', 'salvarResultado', 'finalizar',
    'excluir', 'excluirImagem',
  ],
  'EncaminhamentoController.js': ['criar', 'atualizar', 'atualizarStatus', 'finalizar', 'excluir'],
  'AgendamentoController.js': ['criar', 'atualizar', 'atualizarStatus', 'excluir', 'assumir'],
  'DietaController.js': [
    'criar', 'atualizar', 'toggleAtivo', 'excluir',
    'criarItem', 'atualizarItem', 'excluirItem',
  ],
  'DocumentoEmitidoController.js': ['emitir'],
};

describe('paciente inativo — o prontuário congela em TODO caminho de escrita', () => {
  for (const [arquivo, handlers] of Object.entries(ESCRITAS)) {
    const fonte = fs.readFileSync(path.join(DIR, arquivo), 'utf8');

    describe(arquivo, () => {
      for (const nome of handlers) {
        it(`${nome} recusa o paciente inativo`, () => {
          const corpo = corpoDoHandler(fonte, nome);
          expect(corpo).not.toBeNull();          // handler renomeado/removido: reveja a lista
          // `bloquearSeAnimalInativo` é o guard novo; `animalEstaInativo` é a forma
          // anterior, ainda usada nos `criar` que já a tinham. As duas valem.
          expect(corpo).toMatch(/bloquearSeAnimalInativo|animalEstaInativo/);
        });
      }
    });
  }
});

// ─── Fatura paga ─────────────────────────────────────────────────────────────
//
// 🔴 Item de fatura paga já era recusado (`FATURA_PAGA`), mas o STATUS podia voltar
// para ABERTA por `atualizarStatus` — e daí tudo voltava a ser editável. Era a porta
// dos fundos do bloqueio inteiro. Reabrir continua possível, só que é ato de GESTOR e
// vai para a auditoria.
describe('fatura paga é somente leitura', () => {
  const fonte = fs.readFileSync(path.join(DIR, 'FaturaController.js'), 'utf8');

  it('atualizarStatus recusa quem não é gestor ao SAIR de PAGA', () => {
    const corpo = corpoDoHandler(fonte, 'atualizarStatus');
    expect(corpo).not.toBeNull();
    expect(corpo).toMatch(/saindoDePaga/);
    expect(corpo).toMatch(/ehGestorNoContexto/);
    expect(corpo).toMatch(/FATURA_PAGA/);
  });

  it('a reabertura de uma fatura paga é AUDITADA', () => {
    // Sem o registro, ninguém responde "quem destravou a cobrança já quitada".
    const corpo = corpoDoHandler(fonte, 'atualizarStatus');
    expect(corpo).toMatch(/registrarAuditoria/);
  });

  it('incluir, alterar e remover item continuam recusados na fatura paga', () => {
    // 🔴 Desde 2026-09-23 a recusa mora numa guarda ÚNICA (`bloqueioDeEscritaNaFatura`),
    // que responde FATURA_PAGA na paga e FATURA_NAO_EDITAVEL na fechada/atrasada. O
    // gate passou a exigir as duas metades: os três handlers CHAMANDO a guarda, e a
    // guarda devolvendo o código. Conferir só o texto em cada handler deixaria de
    // detectar justamente o caso que a extração criou — um handler que esquece de
    // chamá-la.
    for (const nome of ['adicionarItem', 'atualizarItem', 'removerItem']) {
      expect(corpoDoHandler(fonte, nome)).toMatch(/bloqueioDeEscritaNaFatura/);
    }
    expect(fonte).toMatch(/function bloqueioDeEscritaNaFatura[\s\S]*?code:\s*'FATURA_PAGA'/);
    expect(fonte).toMatch(/function bloqueioDeEscritaNaFatura[\s\S]*?faturaEditavel\(fatura\.status\)/);
  });

  // 🔴 FECHADA TAMBÉM É SOMENTE LEITURA (2026-09-23, a pedido: "se ela for fechada
  // nada pode ser editada no item do paciente"). Até aqui só a tela escondia os botões
  // (`canEdit = ABERTA || REABERTA`) e o `PUT /itens/:id` passava numa fatura fechada.
  it('a fatura FECHADA/ATRASADA também recusa escrita de item', () => {
    expect(fonte).toMatch(/code:\s*'FATURA_NAO_EDITAVEL'/);
  });

  // 🔴 O BLOCO DO PACIENTE SEGUE A MESMA REGRA DA FATURA: fechado/pago = somente
  // leitura. Sem isto, fechar o bloco tirava o valor do total e a linha continuava
  // editável — mudar o valor dali reescreveria uma cobrança já apartada.
  it('item de bloco de paciente FECHADO ou PAGO recusa alteração e remoção', () => {
    for (const nome of ['atualizarItem', 'removerItem']) {
      expect(corpoDoHandler(fonte, nome)).toMatch(/bloqueioDoBlocoDoPaciente/);
    }
    expect(fonte).toMatch(/function bloqueioDoBlocoDoPaciente[\s\S]*?BLOCO_PACIENTE_PAGO/);
    expect(fonte).toMatch(/function bloqueioDoBlocoDoPaciente[\s\S]*?BLOCO_PACIENTE_FECHADO/);
  });
});

describe('bloquearSeAnimalInativo', () => {
  const resFalso = () => {
    const r = { status: jest.fn(() => r), json: jest.fn(() => r) };
    return r;
  };
  const clienteCom = (inativo) => ({
    $queryRawUnsafe: async () => [{
      inativo, inativoEm: inativo ? new Date('2026-09-02T10:00:00Z') : null,
      inativoMotivo: inativo ? 'Óbito' : null, inativoPorId: inativo ? 7 : null,
    }],
  });

  it('deixa passar o paciente ATIVO, sem tocar na resposta', async () => {
    const res = resFalso();
    await expect(bloquearSeAnimalInativo(res, 1, { client: clienteCom(false) })).resolves.toBe(false);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('bloqueia o paciente INATIVO com 400 e código próprio', async () => {
    const res = resFalso();
    await expect(bloquearSeAnimalInativo(res, 1, { client: clienteCom(true) })).resolves.toBe(true);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'PACIENTE_INATIVO', error: MSG_PACIENTE_INATIVO }),
    );
  });

  it('respeita o formato `{ sucesso, mensagem }` de quem o usa', async () => {
    // Devolver `{ error }` para um controller que lê `mensagem` faz a tela mostrar
    // "undefined" — o bloqueio funcionaria e ninguém saberia por quê.
    const res = resFalso();
    await bloquearSeAnimalInativo(res, 1, { client: clienteCom(true), sucessoMensagem: true });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ sucesso: false, mensagem: MSG_PACIENTE_INATIVO }),
    );
  });

  it('sem animalId não bloqueia nada', async () => {
    const res = resFalso();
    await expect(bloquearSeAnimalInativo(res, null)).resolves.toBe(false);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('a mensagem diz o ESTADO e a SAÍDA', async () => {
    // Mensagem que só diz "não pode" manda a pessoa abrir chamado. A regra é que ela
    // explique que o prontuário está em leitura E que reativar é com o gestor.
    expect(MSG_PACIENTE_INATIVO).toMatch(/SOMENTE LEITURA/);
    expect(MSG_PACIENTE_INATIVO).toMatch(/[Rr]eative/);
  });
});
