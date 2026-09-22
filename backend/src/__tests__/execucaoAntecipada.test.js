// backend/src/__tests__/execucaoAntecipada.test.js
//
// 🔴 ANTECIPAR DOSE É CONFIRMAR, NÃO JUSTIFICAR (2026-09-18).
//
// Até aqui a dose FUTURA era BLOQUEADA: só saía com uma justificativa escrita
// (mín. 3 caracteres). Na prática isso não impedia nada — quem decidia antecipar
// digitava qualquer coisa e seguia — e ainda custava um formulário no meio do
// plantão. A regra passou a ser a MESMA da dose atrasada: a tela diz PARA QUANDO a
// dose estava prevista, pergunta, e o "sim" executa pelo caminho normal.
//
// O que este arquivo trava (tudo quebra em SILÊNCIO — sem erro em tela nenhuma):
//
//   1. O gate ANTECIPADA é liberado por `confirmarAntecipacao`, NUNCA por
//      `confirmarHorario`. Essa distinção não é estilo: o "Executar Todos" manda
//      `confirmarHorario: true` FIXO, então reaproveitar aquela flag faria um
//      clique antecipar o curso INTEIRO sem ninguém ser perguntado — é exatamente
//      o furo corrigido em 2026-08-23, por outro caminho.
//   2. A justificativa deixou de ser exigida (e a recusa continua carregando o
//      `previsto`, que é o que a tela precisa para dizer "prevista para 24/08 às
//      07:44").
//   3. As doses SEGUINTES são recalculadas a partir do horário REAL da execução —
//      é o que o rolling schedule sempre fez, e é o que dá sentido a antecipar.
//      Trocar `agora` por `previsto` ali devolveria a grade fixa e a dose seguinte
//      nasceria fora de hora, sem nada acusar.
const fs   = require('fs');
const path = require('path');

const { classificarExecucao, calcularProximaDose } = require('../lib/agendaDoses');

const BACK  = fs.readFileSync(
  path.join(__dirname, '../controllers/PrescricaoGrupoController.js'), 'utf8');
const FRONT = fs.readFileSync(
  path.join(__dirname, '../../../frontend/src/pages/ExecucaoPrescricao.tsx'), 'utf8');

// A varredura IGNORA COMENTÁRIOS: sem isso ela passaria (ou reprovaria) por causa
// da própria documentação da regra, que cita as mesmas palavras. Gate que se
// satisfaz com o texto que o explica é gate que se aprende a ignorar.
function semComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Recorta do marcador até o próximo fechamento indicado. */
function trecho(texto, de, ate) {
  const i = texto.indexOf(de);
  if (i < 0) return null;
  const f = texto.indexOf(ate, i + de.length);
  return f < 0 ? texto.slice(i) : texto.slice(i, f);
}

const BACK_LIMPO  = semComentarios(BACK);
const FRONT_LIMPO = semComentarios(FRONT);

describe('classificação — o que conta como antecipada não mudou', () => {
  const previsto = new Date(2026, 7, 23, 20, 0);

  it('antes do horário = ANTECIPADA (dose futura: a tela pergunta antes de executar)', () => {
    expect(classificarExecucao(new Date(2026, 7, 23, 18, 0), previsto)).toBe('ANTECIPADA');
  });

  it('depois do horário = ATRASADA (aviso simples, nunca bloqueia)', () => {
    expect(classificarExecucao(new Date(2026, 7, 23, 22, 0), previsto)).toBe('ATRASADA');
  });

  it('a tolerância de 2min segue valendo — clique no horário não vira pergunta', () => {
    expect(classificarExecucao(new Date(2026, 7, 23, 19, 59), previsto)).toBe('NO_HORARIO');
  });
});

describe('recálculo das doses seguintes — o efeito de antecipar', () => {
  // Antecipar a dose das 20:00 para as 14:00 num curso de 12/12h: a PRÓXIMA passa
  // a ser 02:00, não 08:00. Quem garante isso é `calcularProximaDose(agora, …)`.
  it('a próxima dose parte do horário REAL da execução, não do previsto', () => {
    const previsto = new Date(2026, 7, 23, 20, 0);
    const agora    = new Date(2026, 7, 23, 14, 0);   // 6h antes

    const apartirDoReal     = calcularProximaDose(agora, '12em12h');
    const apartirDoPrevisto = calcularProximaDose(previsto, '12em12h');

    expect(apartirDoReal.getTime()).toBe(new Date(2026, 7, 24, 2, 0).getTime());
    // Se alguém trocar `agora` por `previsto` no controller, o curso inteiro volta
    // à grade original e a antecipação não desloca nada.
    expect(apartirDoReal.getTime()).not.toBe(apartirDoPrevisto.getTime());
  });

  it('o deslocamento é exatamente o da frequência — nada de "recuperar" a antecipação', () => {
    const agora = new Date(2026, 7, 23, 14, 0);
    const diff  = calcularProximaDose(agora, '12em12h').getTime() - agora.getTime();
    expect(diff).toBe(12 * 60 * 60 * 1000);
  });
});

describe('gate estrutural — backend', () => {
  const executar = trecho(BACK_LIMPO, 'const executar = async (req, res)', 'const atualizarHoraInicioPosExecucao');

  it('o handler existe e lê a flag PRÓPRIA de antecipação', () => {
    expect(executar).toBeTruthy();
    expect(executar).toMatch(/confirmarAntecipacao\s*=\s*req\.body\?\.confirmarAntecipacao\s*===\s*true/);
  });

  it('🔴 o ramo ANTECIPADA é liberado por `confirmarAntecipacao`, nunca por `confirmarHorario`', () => {
    const ramo = trecho(executar, "if (classificacao === 'ANTECIPADA')", 'if (!confirmarHorario)');
    expect(ramo).toBeTruthy();
    expect(ramo).toContain('if (!confirmarAntecipacao)');
    // `confirmarHorario` dentro do ramo da antecipada = o furo de volta: o
    // "Executar Todos" a manda fixa em true e anteciparia o curso inteiro.
    expect(ramo).not.toContain('confirmarHorario');
  });

  it('🔴 NÃO exige justificativa para antecipar', () => {
    expect(executar).not.toMatch(/justificativa\.length\s*<\s*MIN_JUSTIFICATIVA/);
    expect(BACK_LIMPO).not.toContain('MIN_JUSTIFICATIVA');
  });

  it('a recusa carrega o horário previsto — é com ele que a tela monta a pergunta', () => {
    const ramo = trecho(executar, "erro:        'EXECUCAO_FUTURA'", 'classificacao,');
    expect(ramo).toBeTruthy();
    expect(ramo).toContain('previsto');
    expect(ramo).toContain('numeroDose');
    expect(ramo).toContain('totalDoses');
  });

  it('🔴 o rolling schedule parte de `agora` (as doses seguintes acompanham a antecipação)', () => {
    expect(executar).toMatch(/proximaDoseEm:\s*calcularProximaDose\(agora,\s*item\.frequencia\)/);
  });

  it('a justificativa continua ACEITA (opcional) e vai só para o motivo da auditoria', () => {
    expect(executar).toMatch(/motivo:\s*classificacao === 'ANTECIPADA' && justificativa/);
  });
});

describe('gate estrutural — tela do plantão', () => {
  it('o item a item reenvia com `confirmarAntecipacao`, não com justificativa', () => {
    const handler = trecho(FRONT_LIMPO, 'const handleExecutarItem = async', 'const fecharAposAjusteHorario');
    expect(handler).toBeTruthy();
    expect(handler).toContain('confirmarAntecipacao: true');
    expect(handler).not.toContain('justificativa');
  });

  it('🔴 o "Executar Todos" NÃO manda a flag de antecipação fixa — ela vem da pergunta', () => {
    const handler = trecho(FRONT_LIMPO, 'const handleExecutarTodos = async', 'const handleCancelarItem');
    expect(handler).toBeTruthy();
    expect(handler).toContain('confirmarHorario: true');
    // A flag só entra quando o parâmetro da confirmação vier true.
    expect(handler).toMatch(/confirmarAntecipacao \? \{ confirmarAntecipacao: true \} : \{\}/);
    expect(handler).not.toContain('confirmarAntecipacao: true,');
  });

  it('🔴 o botão "Executar Todos" chama o handler por ARROW, nunca por referência', () => {
    // `onClick={handleExecutarTodos}` entregaria o MouseEvent como 1º parâmetro —
    // que agora é `confirmarAntecipacao`. Evento é truthy: TODO clique passaria a
    // antecipar o curso inteiro em silêncio, sem a pergunta. Mesmo bypass que já
    // mordeu o `handleSalvar` de ModalNovoFornecedor.
    expect(FRONT_LIMPO).toContain('onClick={() => handleExecutarTodos()}');
    expect(FRONT_LIMPO).not.toMatch(/onClick=\{handleExecutarTodos\}/);
  });

  it('a dose futura vira PERGUNTA (ConfirmModal), não formulário de justificativa', () => {
    const modal = trecho(FRONT_LIMPO, 'open={!!execFutura}', 'onCancelar={() => { if (!salvando) setExecFutura(null); }}');
    expect(modal).toBeTruthy();
    // Diz PARA QUANDO estava prevista — com dia e hora, que é o pedido.
    expect(modal).toContain('formatDiaMesHora(execFutura.previsto)');
    expect(modal).toContain('Deseja continuar?');
    expect(modal).toContain('handleExecutarItem');
    expect(modal).toContain('handleExecutarTodos(true)');
  });

  // 🔴 OS TRÊS GATES QUE ESCONDIAM O BOTÃO (relatado em 2026-09-18 na prescrição
  // #006 da Empresa de Gestorvet: Glicol Turbo 4/4h, dose dada às 21:07, próxima
  // 01:07 do dia seguinte). O backend já perguntaria — mas nada chamava o endpoint,
  // porque a TELA não oferecia por onde clicar. Os três quebram em silêncio: a
  // prescrição some do alcance sem nenhum erro.
  it('🔴 a dose da vez tem botão mesmo quando vence em outro dia (`temAtual`)', () => {
    const modal = trecho(FRONT_LIMPO, 'const semAncora = item.dosesTotaisEsperadas', 'const linhasVisiveis');
    expect(modal).toBeTruthy();
    expect(modal).toContain('const temAtual = idxAtual < resumo.length && !activeDone;');
    // `proximaDoseRealHoje` aqui volta a esconder o Executar da dose de amanhã.
    expect(modal).not.toMatch(/const temAtual[^;]*proximaDoseRealHoje/);
  });

  it('🔴 o modal só entra em leitura com o CURSO terminado, não com o DIA cumprido', () => {
    const chamada = trecho(FRONT_LIMPO, '<ModalExecucao', '/>');
    expect(chamada).toBeTruthy();
    expect(chamada).toMatch(/tipoTemDosePorVir\(modal, modalTipo\)/);
    // `tipoConcluidoEm` responde "o dia está cumprido?" — correto para mandar o card
    // ao Histórico, errado para travar a execução do curso que segue em aberto.
    expect(chamada).not.toContain('tipoConcluidoEm');
  });

  it('🔴 a linha do Histórico mantém o Executar enquanto houver dose por vir', () => {
    const hist = trecho(FRONT_LIMPO, 'const renderGrupoHistorico', 'const renderVacinaHistorico');
    expect(hist).toBeTruthy();
    expect(hist).toMatch(/podeAntecipar = isHoje && podeExecutarAcao && tipoTemDosePorVir\(g, tipo\)/);
    expect(hist).toContain('podeExecutarAcao={podeAntecipar}');
    expect(hist).toContain('soVisualizacao={!podeAntecipar}');
    // Abre em modo EXECUÇÃO (não no olho), senão o modal viria em leitura.
    expect(hist).toContain('setModalVer(false)');
  });

  it('🔴 o ícone da linha não depende mais de `executada` (o dia cumprido)', () => {
    const acao = trecho(FRONT_LIMPO, '<AcaoRegistro tom="executar"', '/>');
    expect(acao).toBeTruthy();
    expect(acao).toContain('podeExecutarAcao && !soVisualizacao && !g.animalInativo');
    expect(acao).not.toContain('!executada');
  });

  it('⚠️ item LEGADO (dose única/SOS) não ganha "dose por vir" — evita botão que falha', () => {
    const pred = trecho(FRONT_LIMPO, 'const itemTemDosePorVir', 'const tipoTemDosePorVir');
    expect(pred).toBeTruthy();
    // Com rastreio por dose: sobra dose no curso. Sem rastreio: vale o que falta HOJE
    // (o backend recusa executar item legado já executado no dia).
    expect(pred).toMatch(/dosesTotaisEsperadas != null/);
    expect(pred).toContain('itemAindaPrecisaAcaoHoje(i)');
  });

  it('nenhum ModalJustificativa sobrou amarrado à execução antecipada', () => {
    // O ModalJustificativa segue existindo na tela, mas só para CANCELAR item —
    // o estado `execFutura` não pode mais abrir um.
    const trechoFuturo = trecho(FRONT_LIMPO, '{execFutura && (', ')}');
    expect(trechoFuturo === null || !trechoFuturo.includes('ModalJustificativa')).toBe(true);
  });
});
