// backend/src/__tests__/antecipacaoDataFutura.test.js
//
// 🔴 ANTECIPAR PRESCRIÇÃO / VACINA DE DATA FUTURA (2026-10-05).
//
// Regra: o plantão pode executar HOJE o que foi prescrito para um dia FUTURO, desde
// que NÃO exista, para o mesmo paciente, outra prescrição ANTERIOR da MESMA medicação
// ainda pendente de execução.
//
//   hoje 05/10 · vacina X para 06/10 · nada antes pendente          → antecipa
//   hoje 05/10 · vacina X para 05/10 (ou antes) pendente + X 06/10  → NÃO antecipa
//
// A primeira metade EXECUTA a regra real (lib/antecipacaoExecucao). A segunda é gate
// estrutural nos elos que somem sem erro: a trava no `executar` (prescrição e vacina),
// que ela não pode ser liberada pela flag da pergunta, e a anotação que a tela usa.
const fs   = require('fs');
const path = require('path');

const A = require('../lib/antecipacaoExecucao');

const FUSO = 'America/Sao_Paulo';
const HOJE = '2026-10-05';

/** Vacina FINALIZADA (pendente no plantão). `dia` = data pura da aplicação. */
const vacina = (id, dia, extra = {}) => ({
  id, animalId: 1, nome: 'Influenza Equina', vacinaId: 10, medicamentoCatId: 77,
  dataAplicacao: `${dia}T00:00:00.000Z`, status: 'FINALIZADA', ativo: true,
  aplicadaPeloProprietario: false, numero: id, ...extra,
});

/** Item de prescrição 1x/dia por 1 dia, sem hora (sem âncora) — o caso da dose única
 *  agendada para um dia. */
const itemDia = (id, dia, extra = {}) => ({
  id, animalId: 1, tipo: 'MEDICAMENTO', medicamento: 'Flunixin', medicamentoCatId: 5,
  frequencia: '1xDia', duracaoDias: 1, horaInicio: null, dataInicio: `${dia}T00:00:00.000Z`,
  dosesExecutadas: 0, proximaDoseEm: null, executadoEm: null, status: 'ATIVA', ativo: true,
  aplicadaPeloProprietario: false, grupo: { id: 900 + id, numero: id }, ...extra,
});

describe('identificação da medicação', () => {
  it('o catálogo manda quando os dois lados o têm', () => {
    expect(A.mesmaMedicacao({ tipo: 'X', medicamentoCatId: 5, nome: 'A' }, { tipo: 'X', medicamentoCatId: 5, nome: 'B' })).toBe(true);
    expect(A.mesmaMedicacao({ tipo: 'X', medicamentoCatId: 5, nome: 'A' }, { tipo: 'X', medicamentoCatId: 6, nome: 'A' })).toBe(false);
  });

  it('sem catálogo dos dois lados, o nome sem acento/caixa/espaço extra', () => {
    expect(A.mesmaMedicacao({ tipo: 'X', medicamento: 'Vacína  Raiva' }, { tipo: 'X', medicamentoCatId: 3, medicamento: 'vacina raiva' })).toBe(true);
  });

  it('tipos de registro diferentes nunca se misturam', () => {
    expect(A.mesmaMedicacao({ tipo: 'MEDICAMENTO', nome: 'A' }, { tipo: 'PROCEDIMENTO', nome: 'A' })).toBe(false);
  });
});

describe('vacina — os exemplos do pedido', () => {
  it('PERMITIDO: 06/10 sem nada anterior pendente', () => {
    const alvo = vacina(2, '2026-10-06');
    expect(A.vacinaPendenteAnterior(alvo, [alvo])).toBeNull();
  });

  it('NÃO PERMITIDO: a de 05/10 (hoje) ainda pendente trava a de 06/10', () => {
    const anterior = vacina(1, '2026-10-05');
    const alvo     = vacina(2, '2026-10-06');
    const bloqueio = A.vacinaPendenteAnterior(alvo, [anterior, alvo]);
    expect(bloqueio).toMatchObject({ id: 1, dia: '2026-10-05' });
    expect(A.mensagemBloqueio(bloqueio, 'vacina')).toContain('05/10');
  });

  it('NÃO PERMITIDO: uma anterior VENCIDA (04/10) também trava', () => {
    expect(A.vacinaPendenteAnterior(vacina(2, '2026-10-06'), [vacina(1, '2026-10-04')])).not.toBeNull();
  });

  it('a anterior já EXECUTADA, cancelada ou aplicada pelo proprietário não trava', () => {
    const alvo = vacina(2, '2026-10-06');
    for (const extra of [{ status: 'EXECUTADA' }, { ativo: false }, { aplicadaPeloProprietario: true }]) {
      expect(A.vacinaPendenteAnterior(alvo, [vacina(1, '2026-10-05', extra), alvo])).toBeNull();
    }
  });

  it('outra medicação, outro paciente ou o MESMO dia não travam', () => {
    const alvo = vacina(2, '2026-10-06');
    expect(A.vacinaPendenteAnterior(alvo, [vacina(1, '2026-10-05', { medicamentoCatId: 78, vacinaId: 11, nome: 'Tétano' })])).toBeNull();
    expect(A.vacinaPendenteAnterior(alvo, [vacina(1, '2026-10-05', { animalId: 2 })])).toBeNull();
    expect(A.vacinaPendenteAnterior(alvo, [vacina(1, '2026-10-06')])).toBeNull();
  });

  it('com mais de uma anterior, aponta a MAIS ANTIGA — é ela que sai primeiro', () => {
    const r = A.vacinaPendenteAnterior(vacina(3, '2026-10-07'), [vacina(2, '2026-10-05'), vacina(1, '2026-10-03')]);
    expect(r.dia).toBe('2026-10-03');
  });
});

describe('prescrição — dia da próxima dose pendente', () => {
  it('sem âncora e curso no futuro → o 1º dia do curso', () => {
    expect(A.diaDaProximaDose(itemDia(1, '2026-10-06'), HOJE, FUSO)).toBe('2026-10-06');
  });

  it('sem âncora e curso correndo → hoje', () => {
    expect(A.diaDaProximaDose(itemDia(1, '2026-10-04', { duracaoDias: 3 }), HOJE, FUSO)).toBe(HOJE);
  });

  it('com âncora → o dia do rolling schedule (`proximaDoseEm`), inclusive vencido', () => {
    const base = { frequencia: '12em12h', duracaoDias: 2, dosesExecutadas: 1 };
    expect(A.diaDaProximaDose(itemDia(1, '2026-10-04', { ...base, proximaDoseEm: new Date('2026-10-06T15:00:00Z') }), HOJE, FUSO)).toBe('2026-10-06');
    expect(A.diaDaProximaDose(itemDia(1, '2026-10-03', { ...base, proximaDoseEm: new Date('2026-10-04T15:00:00Z') }), HOJE, FUSO)).toBe('2026-10-04');
  });

  it('curso concluído, cancelado, do proprietário ou SOS → nada pendente', () => {
    expect(A.diaDaProximaDose(itemDia(1, '2026-10-06', { dosesExecutadas: 1 }), HOJE, FUSO)).toBeNull();
    expect(A.diaDaProximaDose(itemDia(1, '2026-10-06', { status: 'CANCELADA' }), HOJE, FUSO)).toBeNull();
    expect(A.diaDaProximaDose(itemDia(1, '2026-10-06', { aplicadaPeloProprietario: true }), HOJE, FUSO)).toBeNull();
    expect(A.diaDaProximaDose(itemDia(1, '2026-10-06', { frequencia: 'SOS' }), HOJE, FUSO)).toBeNull();
  });
});

describe('prescrição — os exemplos do pedido', () => {
  it('PERMITIDO: prescrita para 06/10, nada anterior pendente', () => {
    const alvo = itemDia(2, '2026-10-06');
    expect(A.prescricaoPendenteAnterior(alvo, '2026-10-06', [alvo], HOJE, FUSO)).toBeNull();
  });

  it('NÃO PERMITIDO: a de 05/10 ainda pendente trava a de 06/10', () => {
    const alvo = itemDia(2, '2026-10-06');
    const r = A.prescricaoPendenteAnterior(alvo, '2026-10-06', [itemDia(1, HOJE), alvo], HOJE, FUSO);
    expect(r).toMatchObject({ id: 1, dia: HOJE, numero: '001' });
  });

  it('a de 05/10 já executada não trava mais', () => {
    const alvo = itemDia(2, '2026-10-06');
    const feita = itemDia(1, HOJE, { dosesExecutadas: 1 });
    expect(A.prescricaoPendenteAnterior(alvo, '2026-10-06', [feita, alvo], HOJE, FUSO)).toBeNull();
  });
});

// ─── Gate estrutural ─────────────────────────────────────────────────────────

function semComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
function trecho(texto, de, ate) {
  const i = texto.indexOf(de);
  if (i < 0) return null;
  const f = texto.indexOf(ate, i + de.length);
  return f < 0 ? texto.slice(i) : texto.slice(i, f);
}
const ler = (rel) => semComentarios(fs.readFileSync(path.join(__dirname, rel), 'utf8'));

describe('gate estrutural — backend', () => {
  const PRESC = ler('../controllers/PrescricaoGrupoController.js');
  const VAC   = ler('../controllers/VacinaClinicaController.js');

  it('🔴 a prescrição recusa a antecipação com pendência anterior ANTES de perguntar', () => {
    const executar = trecho(PRESC, 'const executar = async (req, res)', 'const atualizarHoraInicioPosExecucao');
    expect(executar).toBeTruthy();
    const iTrava    = executar.indexOf("'ANTECIPACAO_BLOQUEADA'");
    const iPergunta = executar.indexOf("if (classificacao === 'ANTECIPADA')");
    expect(iTrava).toBeGreaterThan(-1);
    expect(iTrava).toBeLessThan(iPergunta);
    // A trava não pode ser liberada pela flag da pergunta.
    const bloco = trecho(executar, 'const diaFuturoDoItem', 'const previsto = horarioPrevistoDoItem(item);');
    expect(bloco).toContain('prescricaoPendenteAnterior');
    expect(bloco).not.toContain('confirmarAntecipacao');
  });

  it('a prescrição de dia futuro SEM hora também cai na pergunta', () => {
    const ramo = trecho(PRESC, 'if (!previsto) {', 'const classificacao = classificarExecucao(agora, previsto);');
    expect(ramo).toContain('diaFuturoDoItem.get(item.id)');
    expect(ramo).toContain("'EXECUCAO_FUTURA'");
    expect(ramo).toContain('semHorario');
  });

  it('🔴 a vacina tem a MESMA trava, antes da pergunta, e a pergunta vem depois', () => {
    const executar = trecho(VAC, 'async function executar(req, res)', 'async function executarNaFinalizacao');
    expect(executar).toBeTruthy();
    const iTrava    = executar.indexOf("'ANTECIPACAO_BLOQUEADA'");
    const iPergunta = executar.indexOf("'EXECUCAO_FUTURA'");
    expect(iTrava).toBeGreaterThan(-1);
    expect(iPergunta).toBeGreaterThan(iTrava);
    expect(executar).toContain('vacinaPendenteAnterior');
    expect(executar).toMatch(/confirmarAntecipacao\s*=\s*req\.body\?\.confirmarAntecipacao\s*===\s*true/);
  });

  it('as duas filas do plantão anotam o bloqueio com a MESMA lib', () => {
    expect(trecho(PRESC, 'const listarParaExecucao', 'module.exports')).toContain('antecipacaoBloqueadaPor');
    const filaVac = trecho(VAC, 'async function listarParaExecucao', 'function hojeLocalStrVacina');
    expect(filaVac).toContain('antecipacao.vacinaPendenteAnterior');
    // A tenancy da fila e a da busca do `executar` são a MESMA função.
    expect(filaVac).toContain('whereVacinaDaEmpresa(req.empresaId)');
    expect(trecho(VAC, 'async function vacinasPendentesDoPaciente', '}\n')).toBeTruthy();
  });
});

describe('gate estrutural — tela do plantão', () => {
  const FRONT = semComentarios(fs.readFileSync(
    path.join(__dirname, '../../../frontend/src/pages/ExecucaoPrescricao.tsx'), 'utf8'));

  it('dia futuro só abre em execução o que pode ser antecipado', () => {
    expect(FRONT).toMatch(/soVisualizacao=\{\(!isHoje && !tipoAntecipavelEm\(g, tipo, dataSel\)\)/);
    expect(FRONT).toContain('isHoje || vacinaAntecipavel(v)');
  });

  it('o Executar do item bloqueado fica cinza com o motivo (não some, não falha no clique)', () => {
    const modal = trecho(FRONT, 'const bloqueioExecucao = ', 'const [prestadores');
    expect(modal).toContain('antecipacaoBloqueadaPor');
    expect(FRONT).toContain('disabled={salvando || !!bloqueio}');
  });

  it('o "Executar Todos" não entra no lote o item bloqueado nem existe no dia futuro', () => {
    const handler = trecho(FRONT, 'const handleExecutarTodos = async', 'const handleCancelarItem');
    expect(handler).toContain('!x.item.antecipacaoBloqueadaPor');
    expect(FRONT).toContain('{!dataFutura && (');
  });

  it('a vacina pergunta antes de antecipar e reenvia com a flag própria', () => {
    expect(FRONT).toContain("e.response.data?.erro === 'EXECUCAO_FUTURA'");
    expect(FRONT).toContain('confirmarAntecipacao ? { confirmarAntecipacao: true } : {}');
    expect(FRONT).not.toMatch(/onClick=\{handleExecutar\}/);
  });
});
