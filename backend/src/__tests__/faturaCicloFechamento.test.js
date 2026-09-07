'use strict';

/**
 * CICLO DE VIDA DA FATURA (2026-09-06, a pedido).
 *
 * Duas regras, e as duas quebram EM SILÊNCIO — é por isso que este arquivo existe:
 *
 *   1. FECHAR ABRE A SEGUINTE, já com os itens padrão (Assistência Veterinária
 *      Mensal). Se o elo se perder, nada dá erro: o cliente simplesmente fica sem
 *      fatura corrente até alguém abrir a tela dele, e o MENSALISTA que não teve
 *      atendimento no mês deixa de ser cobrado. Ninguém percebe no dia; percebe-se
 *      no fim do mês, com o faturamento a menos.
 *
 *   2. REABRIR GRAVA REABERTA, NUNCA ABERTA. Se voltar a gravar ABERTA, a fatura de
 *      agosto destravada para corrigir uma linha volta a ser a fatura CORRENTE — e o
 *      lançamento clínico de setembro cai dentro de um documento que o cliente já
 *      recebeu. Também sem erro nenhum.
 *
 * O contrapeso da regra 1 é a IDEMPOTÊNCIA: nunca DUAS faturas correntes para o
 * mesmo cliente na mesma empresa. Duas correntes partem o mês em duas —
 * getOrCreateFatura pega a primeira que achar e metade dos lançamentos some da
 * vista. Por isso o "já existe uma em aberto?" é testado nos dois estados.
 */

const fs   = require('fs');
const path = require('path');

// O controller arrasta storage (TS), Puppeteer e os provedores de mensagem — nada
// disso participa da regra testada aqui.
jest.mock('../lib/prisma', () => ({ default: {} }));
jest.mock('../storage', () => ({ storage: { upload: jest.fn() }, chaveDaUrl: () => null }));
jest.mock('../services/documentoWhatsappService', () => ({ htmlParaPdf: jest.fn() }));
jest.mock('../services/whatsappService', () => ({}));
jest.mock('../services/emailService', () => ({}));
jest.mock('../lib/notificationDispatch', () => ({ enfileirarEnvioFatura: jest.fn() }));
jest.mock('../lib/faturaLinkPublico', () => ({ criarLink: jest.fn(), revogar: jest.fn() }));

const {
  proximoMesReferencia,
  statusAoReabrir,
  getOrCreateFatura,
  STATUS_FATURA_ABERTOS,
} = require('../lib/faturaUtils');
const { abrirProximaFatura } = require('../controllers/FaturaController');

// ─── banco falso ─────────────────────────────────────────────────────────────
// Guarda faturas, itens e o perfil do proprietário em memória; implementa só o que
// os helpers usam de verdade.
function bancoFalso({ faturas = [], assistencia = null } = {}) {
  const estado = { faturas: faturas.map(f => ({ ...f })), itens: [], seq: 900 };
  const casa = (linha, where) => Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && 'in'  in v) return v.in.includes(linha[k]);
    if (v && typeof v === 'object' && 'not' in v) return linha[k] !== v.not;
    return (linha[k] ?? null) === (v ?? null);
  });
  return {
    estado,
    fatura: {
      findFirst:  async ({ where }) => estado.faturas.find(f => casa(f, where)) ?? null,
      findUnique: async ({ where }) => estado.faturas.find(f => f.id === where.id) ?? null,
      create:     async ({ data })  => {
        const nova = { id: ++estado.seq, total: 0, mesReferencia: null, ...data };
        estado.faturas.push(nova);
        return nova;
      },
      update: async ({ where, data }) => {
        const alvo = estado.faturas.find(f => f.id === where.id);
        Object.assign(alvo, data);
        return alvo;
      },
    },
    faturaItem: {
      findFirst: async ({ where }) => estado.itens.find(i => casa(i, where)) ?? null,
      findMany:  async ({ where }) => estado.itens.filter(i => casa(i, where)),
      create:    async ({ data })  => {
        const novo = { id: ++estado.seq, descontoTipo: null, descontoValor: 0, ...data };
        estado.itens.push(novo);
        return novo;
      },
    },
    proprietarioPerfil: {
      findUnique: async () => (assistencia == null ? null : { valorAssistencia: assistencia }),
      findMany:   async () => (assistencia == null ? [] : [{ empresaId: 1, valorAssistencia: assistencia }]),
    },
    user: { findUnique: async () => ({ valorAssistencia: null }) },
  };
}

const fechada = (extra = {}) => ({
  id: 10, proprietarioId: 7, empresaId: 42, mesReferencia: '2026-09', status: 'FECHADA', ...extra,
});

// ─── o mês da fatura que nasce ───────────────────────────────────────────────

describe('proximoMesReferencia — a fatura nova é do ciclo SEGUINTE', () => {
  it('avança um mês', () => {
    expect(proximoMesReferencia('2026-09')).toBe('2026-10');
  });

  it('vira o ano em dezembro', () => {
    expect(proximoMesReferencia('2026-12')).toBe('2027-01');
  });

  it('cai no mês atual quando não há referência utilizável', () => {
    const atual = new Date().toISOString().slice(0, 7);
    expect(proximoMesReferencia(null)).toBe(atual);
    expect(proximoMesReferencia('')).toBe(atual);
    expect(proximoMesReferencia('setembro')).toBe(atual);
    // Mês fora de 1-12 não pode virar 2026-14: seria rótulo inexistente na tela.
    expect(proximoMesReferencia('2026-13')).toBe(atual);
  });
});

// ─── reabrir ─────────────────────────────────────────────────────────────────

describe('statusAoReabrir — reabrir não devolve a fatura a ABERTA', () => {
  it.each(['FECHADA', 'ATRASADA', 'PAGA'])('%s + pedido ABERTA vira REABERTA', (atual) => {
    expect(statusAoReabrir(atual, 'ABERTA')).toBe('REABERTA');
  });

  it('fatura que já está ABERTA continua ABERTA (não é reabertura)', () => {
    expect(statusAoReabrir('ABERTA', 'ABERTA')).toBe('ABERTA');
  });

  it('reabrir de novo uma REABERTA não muda nada', () => {
    expect(statusAoReabrir('REABERTA', 'ABERTA')).toBe('REABERTA');
  });

  it('qualquer outro destino passa intacto — a conversão é só do "voltar a abrir"', () => {
    expect(statusAoReabrir('PAGA', 'CANCELADA')).toBe('CANCELADA');
    expect(statusAoReabrir('ABERTA', 'FECHADA')).toBe('FECHADA');
  });
});

describe('a fatura REABERTA não é a fatura corrente', () => {
  it('getOrCreateFatura ignora a REABERTA e abre uma nova ABERTA', async () => {
    const db = bancoFalso({ faturas: [fechada({ id: 5, status: 'REABERTA' })] });
    const f = await getOrCreateFatura(db, 7, 42);
    // Achou a reaberta e reaproveitou? O lançamento de hoje cairia num documento que
    // o cliente já recebeu uma vez.
    expect(f.id).not.toBe(5);
    expect(f.status).toBe('ABERTA');
  });

  it('mas continua contando como "em aberto" para não duplicar o ciclo', () => {
    expect(STATUS_FATURA_ABERTOS).toEqual(expect.arrayContaining(['ABERTA', 'REABERTA']));
  });
});

// ─── fechar abre a seguinte ──────────────────────────────────────────────────

describe('abrirProximaFatura — fechar uma abre a seguinte, com os itens padrão', () => {
  it('cria a fatura do mês seguinte, ABERTA, na mesma empresa e cliente', async () => {
    const db = bancoFalso();
    const nova = await abrirProximaFatura(fechada(), { db });

    expect(nova).not.toBeNull();
    expect(nova.status).toBe('ABERTA');
    expect(nova.mesReferencia).toBe('2026-10');
    expect(nova.proprietarioId).toBe(7);
    expect(nova.empresaId).toBe(42);
  });

  it('a Assistência Veterinária Mensal já nasce dentro dela', async () => {
    const db = bancoFalso({ assistencia: 350 });
    const nova = await abrirProximaFatura(fechada(), { db });

    const assist = db.estado.itens.filter(i => i.faturaId === nova.id && i.tipo === 'ASSISTENCIA');
    expect(assist).toHaveLength(1);
    expect(assist[0].valor).toBe(350);
    // O total tem de vir recalculado: devolver a fatura de antes faria a tela anunciar
    // uma fatura nova zerada com um item de R$ 350 dentro.
    expect(nova.total).toBe(350);
  });

  it('cliente que não é mensalista abre a fatura vazia, sem inventar cobrança', async () => {
    const db = bancoFalso({ assistencia: null });
    const nova = await abrirProximaFatura(fechada(), { db });
    expect(db.estado.itens.filter(i => i.faturaId === nova.id)).toHaveLength(0);
  });

  it.each(['ABERTA', 'REABERTA'])(
    'NÃO cria uma segunda quando o cliente já tem fatura %s nesta empresa', async (status) => {
      const db = bancoFalso({
        faturas: [fechada({ id: 99, status, mesReferencia: '2026-10' })],
        assistencia: 350,
      });
      const nova = await abrirProximaFatura(fechada(), { db });

      expect(nova).toBeNull();
      expect(db.estado.faturas).toHaveLength(1); // nada foi criado
    });

  it('a fatura em aberto de OUTRA empresa não impede — o ciclo é por clínica', async () => {
    const db = bancoFalso({ faturas: [fechada({ id: 99, status: 'ABERTA', empresaId: 58 })] });
    const nova = await abrirProximaFatura(fechada(), { db });
    expect(nova).not.toBeNull();
    expect(nova.empresaId).toBe(42);
  });

  it('chamar duas vezes para o mesmo fechamento não duplica (idempotente)', async () => {
    const db = bancoFalso({ assistencia: 350 });
    const um   = await abrirProximaFatura(fechada(), { db });
    const dois = await abrirProximaFatura(fechada(), { db });

    expect(um).not.toBeNull();
    expect(dois).toBeNull();
    expect(db.estado.faturas.filter(f => f.status === 'ABERTA')).toHaveLength(1);
  });

  it('fatura LEGADA por animal (sem proprietário) não tem ciclo mensal a abrir', async () => {
    const db = bancoFalso();
    expect(await abrirProximaFatura(fechada({ proprietarioId: null }), { db })).toBeNull();
    expect(db.estado.faturas).toHaveLength(0);
  });

  it('sem empresa não se cria fatura — ela nasceria sem tenant', async () => {
    const db = bancoFalso();
    expect(await abrirProximaFatura(fechada({ empresaId: null }), { db })).toBeNull();
    expect(db.estado.faturas).toHaveLength(0);
  });
});

// ─── gate estrutural ─────────────────────────────────────────────────────────
// O elo "fechou → abriu a seguinte" some sem produzir erro nenhum. O que o protege
// não é asserção de comportamento (cada caminho tem o seu próprio banco), é a
// garantia de que TODO caminho de fechamento continua chamando o helper.
//
// ⚠️ A varredura IGNORA COMENTÁRIOS: sem isso ela passaria só porque o comentário
// que EXPLICA a regra cita as mesmas palavras, e um gate satisfeito pela própria
// documentação é um gate que se aprende a ignorar.

const semComentarios = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');

const leia = (rel) => semComentarios(
  fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'),
);

// Recorta o corpo de um handler pelo nome, até o fim do método no objeto.
const corpoDoHandler = (src, nome) => {
  const ini = src.indexOf(nome + ': async (req, res)');
  expect(ini).toBeGreaterThan(-1);
  const resto = src.slice(ini);
  const fim = resto.indexOf('\n  },\n');
  return resto.slice(0, fim === -1 ? resto.length : fim);
};

describe('todo caminho de fechamento abre a fatura seguinte', () => {
  const controller = leia('controllers/FaturaController.js');
  const server     = leia('server.ts');

  it('fecharFatura — o botão "Fechar Fatura" da tela', () => {
    expect(corpoDoHandler(controller, 'fecharFatura')).toMatch(/abrirProximaFatura/);
  });

  it('fecharFaturasLote — o fechamento em lote', () => {
    expect(corpoDoHandler(controller, 'fecharFaturasLote')).toMatch(/abrirProximaFatura/);
  });

  it('atualizarStatus — a outra porta para FECHADA', () => {
    expect(corpoDoHandler(controller, 'atualizarStatus')).toMatch(/abrirProximaFatura/);
  });

  it('o cron de fechamento — é onde mais importa, porque ninguém está na tela', () => {
    const ini = server.indexOf('async function fecharFaturasDoMes');
    expect(ini).toBeGreaterThan(-1);
    const corpo = server.slice(ini, server.indexOf('registrarJob(', ini));
    // `tx`, não o prisma global: fora dele o RLS recusa a criação em silêncio.
    expect(corpo.includes('abrirProximaFatura(fatura, { db: tx })')).toBe(true);
  });
});

describe('reabrir passa por statusAoReabrir — a conversão é do backend', () => {
  const controller = leia('controllers/FaturaController.js');
  const corpo = corpoDoHandler(controller, 'atualizarStatus');

  it('atualizarStatus grava o status CONVERTIDO, nunca o cru do corpo da requisição', () => {
    expect(corpo.includes('statusAoReabrir(alvo.status, status)')).toBe(true);
    // `data: { status }` cru voltaria a gravar ABERTA na reabertura.
    expect(corpo.includes('{ status: statusFinal }')).toBe(true);
  });

  it('REABERTA é status aceito pela rota — senão a tela não conseguiria pedi-lo', () => {
    expect(controller.includes("'REABERTA'")).toBe(true);
  });
});
