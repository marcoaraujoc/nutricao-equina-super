// frontend/src/utils/RelatorioAtendimento.ts
//
// Relatório comparativo de atendimento — usado ao imprimir uma evolução clínica.
// Busca no backend (`GET /clinica/evolucoes/:id/relatorio-atendimento`) os dados
// da sessão atual + da evolução imediatamente anterior do animal (independente da
// especialidade — a tag da coluna anterior informa qual foi), já com o body-map
// pintado (`pintarLaudoEquino`, camada backend) e os scores clínicos extraídos por
// IA (`resumoClinico`), e monta o HTML impresso com o COMPONENTE DE IMPRESSÃO
// PADRÃO do sistema (PRINT_CSS + renderSysHeader + renderAnimalCard de
// AtendimentoPrint.ts — mesmo padrão visual de Dietaprint.ts).
//
// Diferente dos demais utilitários de impressão (`EvolucaoPrint.ts`, etc.), este
// é ASSÍNCRONO: a primeira impressão de uma evolução roda a extração por IA no
// servidor (pode levar alguns segundos); chamadas seguintes usam o cache
// (`EvolucaoClinica.resumoIaData`) e respondem quase instantaneamente.
import api from '../services/api';
import { resolverUrlAbsoluta } from './printUrl';
import {
  PRINT_CSS,
  renderAnimalCard,
  type PrintAnimal,
} from './AtendimentoPrint';

// ─── Tipos (espelham o payload de EvolucaoController.relatorioAtendimento) ───

export interface ClaudicacaoInfo { grauAAEP: number; observacao?: string }
export interface DorInfo { valor: number }
export interface TensaoMuscularItem { regiao: string; valor: number }
export interface RomItem { teste: string; resultado: string }
export interface TreinoItem { status: 'liberado' | 'restrito' | 'suspenso'; titulo: string; detalhe: string }

export interface ResumoClinico {
  claudicacao?: ClaudicacaoInfo;
  dor?: DorInfo;
  tensaoMuscular?: TensaoMuscularItem[];
  simetria?: string;
  rom?: RomItem[];
  treino?: TreinoItem[];
  observacaoFechamento?: string;
}

export interface SessaoRelatorio {
  id: number;
  titulo?: string | null;
  texto?: string;
  dataInicio: string;
  atendimentoNumero?: string;
  resumoClinico: ResumoClinico | null;
  svgColuna: string | null;
  avisos?: string[];
  completo?: boolean;
}

export interface AnimalRelatorio {
  id: number;
  nome: string;
  photoUrl?: string | null;
  idadeAnos?: number | null;
  peso?: number | null;
  sexo?: string | null;
  tipoExercicio?: string | null;
  especie?: { nome: string } | null;
  raca?: { nome: string } | null;
  user?: { fullName: string } | null;
}

export interface RelatorioAtendimentoDados {
  animal: AnimalRelatorio;
  logoUrl: string | null;
  atual: SessaoRelatorio & { especialidade: string; veterinario: { fullName: string } };
  anterior: (SessaoRelatorio & { especialidade?: string }) | null;
}

// ─── Busca no backend ────────────────────────────────────────────────────────

export async function buscarRelatorioAtendimento(evolucaoId: number): Promise<RelatorioAtendimentoDados> {
  const res = await api.get(`/clinica/evolucoes/${evolucaoId}/relatorio-atendimento`);
  if (!res.data?.dados) throw new Error('Relatório indisponível.');
  return res.data.dados as RelatorioAtendimentoDados;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtData(data: string | null | undefined): string {
  if (!data) return '—';
  const d = new Date(data);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function num(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
}

/**
 * Junta linhas quebradas no meio da frase (ditado/textarea salvam '\n' onde a
 * frase ainda não terminou), preservando parágrafos (linha em branco).
 */
function textoCorrido(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').replace(/[ \t]{2,}/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
}

/** Card de score comparativo (era X → agora Y), com seta e delta quando há sessão anterior. */
function scorePill(
  label: string,
  atualVal: number | string | null | undefined,
  anteriorVal: number | string | null | undefined,
  opts: { menorMelhor?: boolean; sufixo?: string } = {}
): string {
  if (atualVal == null) return '';
  const { menorMelhor = true, sufixo = '' } = opts;
  const atualStr = typeof atualVal === 'number' ? num(atualVal) : esc(atualVal);

  let deltaHtml = '';
  if (anteriorVal != null && typeof anteriorVal === typeof atualVal) {
    if (typeof atualVal === 'number' && typeof anteriorVal === 'number') {
      const diff = anteriorVal - atualVal;
      const melhorou = menorMelhor ? diff > 0 : diff < 0;
      const pctTxt = anteriorVal !== 0 ? Math.round((Math.abs(diff) / Math.abs(anteriorVal)) * 100) : null;
      deltaHtml = `
        <div class="vals"><span class="was">${num(anteriorVal)}${sufixo}</span><span class="arrow">→</span><span class="now">${atualStr}${sufixo}</span></div>
        <div class="delta${melhorou ? '' : ' warn'}">${melhorou ? '▼' : '▲'} ${pctTxt != null ? `${pctTxt}% ` : ''}${melhorou ? 'melhora' : 'atenção'}</div>`;
    } else {
      deltaHtml = `
        <div class="vals"><span class="now">${atualStr}</span></div>
        <div class="delta warn">era: ${esc(String(anteriorVal))}</div>`;
    }
  } else {
    deltaHtml = `<div class="vals"><span class="now">${atualStr}${sufixo}</span></div>`;
  }

  return `<div class="score"><div class="lbl">${esc(label)}</div>${deltaHtml}</div>`;
}

const TREINO_LED: Record<TreinoItem['status'], string> = { liberado: 'g', restrito: 'y', suspenso: 'r' };

// ─── Peças reutilizáveis (para futura adoção por Prescrição/Vacina/Exame) ────

export function renderCabecalhoAtendimento(dados: RelatorioAtendimentoDados): string {
  const { animal, atual, logoUrl } = dados;
  const logo  = resolverUrlAbsoluta(logoUrl);
  const agora = new Date();
  const printAnimal: PrintAnimal = {
    nome:      animal.nome,
    photoUrl:  animal.photoUrl,
    raca:      animal.raca,
    user:      animal.user,
    idadeAnos: animal.idadeAnos,
  };

  return `
  <div class="cab">
    <div>${logo ? `<img src="${logo}" alt="Logo">` : `<div class="cab-marca">S2Vet</div>`}</div>
    <div class="cab-emissao">Emitido em ${agora.toLocaleDateString('pt-BR')}<br>às ${agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
  </div>

  <div class="sec-title">Dados do Animal</div>
  ${renderAnimalCard(printAnimal)}

  <div class="plan-row">
    <span class="plan-name">${esc(atual.atendimentoNumero) || 'Evolução'}</span>
    <span class="plan-meta">${[esc(atual.especialidade), fmtData(atual.dataInicio)].filter(Boolean).join(' · ')}</span>
    <span class="plan-vet">Vet.: ${esc(atual.veterinario.fullName)}</span>
  </div>`;
}

export function renderRodapeAtendimento(dados: RelatorioAtendimentoDados): string {
  const { atual } = dados;
  const avisos = atual.avisos ?? [];
  return `
  ${avisos.length > 0 ? `
  <div class="avisos-card">
    <div class="avisos-title">Pontos para revisão manual</div>
    <ul>${avisos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
  </div>` : ''}
  <div class="assinatura">${esc(atual.veterinario.fullName)}</div>
  <div class="footer">
    <span>S2Vet · Sistema Hospitalar Veterinário</span>
    <span>Relatório de Evolução${atual.atendimentoNumero ? ` · ${esc(atual.atendimentoNumero)}` : ''}</span>
  </div>`;
}

/** Mecanismo de impressão compartilhado (offscreen iframe) — idêntico aos demais utils de print. */
export function imprimirHtml(html: string): void {
  const iframe = document.createElement('iframe');
  Object.assign(iframe.style, {
    position: 'fixed', top: '-9999px', left: '-9999px',
    width: '0', height: '0', border: 'none',
  });
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
  if (!doc) { document.body.removeChild(iframe); return; }

  doc.open();
  doc.write(html);
  doc.close();

  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => {
      if (document.body.contains(iframe)) document.body.removeChild(iframe);
    }, 500);
  }, 250);
}

// ─── CSS específico do relatório (complementa o PRINT_CSS padrão) ────────────

const RELATORIO_CSS = `
  /* Aproveita a folha A4 inteira: margens de página justas e sem padding duplo */
  @page { size: A4; margin: 10mm 12mm; }
  body { padding: 10px 12px; }

  /* Cabeçalho: logo da equipe à esquerda, emissão à direita */
  .cab{ display:flex; justify-content:space-between; align-items:flex-start; padding-bottom:8pt; margin-bottom:10pt; }
  .cab img{ max-height:36pt; max-width:220pt; object-fit:contain; }
  .cab-marca{ font-size:20pt; font-weight:700; color:#059669; }
  .cab-emissao{ font-size:8.5pt; color:#0e9f6e; text-align:right; line-height:1.7; }

  .rep-card{ background:#fff; border:0.5pt solid #e5e7eb; border-radius:10pt; padding:9pt 11pt; margin-bottom:9pt; page-break-inside:avoid; }
  .rep-sub{ font-size:8.5pt; color:#6b7280; line-height:1.5; margin-bottom:6pt; }

  /* Cartões de seção com título serifado (Amplitude / Treino / Tensão) */
  .sec-card{ background:#fff; border:0.5pt solid #e5e7eb; border-radius:12pt; padding:12pt 14pt; margin-bottom:9pt; page-break-inside:avoid; }
  .sec-card h2{ font-family:Georgia,'Times New Roman',serif; font-size:14pt; font-weight:700; color:#1f2937; margin-bottom:1pt; }
  .sec-card .sub{ font-size:9pt; color:#0e9f6e; margin-bottom:8pt; }

  .scores{ display:grid; grid-template-columns:repeat(4,1fr); gap:8pt; margin-bottom:9pt; }
  .score{ background:#f3f4f6; border-radius:10pt; padding:8pt 10pt; }
  .score .lbl{ font-size:7pt; font-weight:800; letter-spacing:0.5pt; text-transform:uppercase; color:#9ca3af; min-height:16pt; }
  .score .vals{ display:flex; align-items:baseline; gap:5pt; margin-top:3pt; }
  .score .was{ font-size:10pt; font-weight:600; color:#9ca3af; text-decoration:line-through; }
  .score .now{ font-size:15pt; font-weight:800; color:#065f46; }
  .score .arrow{ font-size:9pt; color:#059669; font-weight:700; }
  .score .delta{ margin-top:2pt; font-size:7.5pt; font-weight:700; color:#059669; }
  .score .delta.warn{ color:#d97706; }

  /* Mapa corporal: faixa larga de sessão em cima de cada coluna */
  .maps{ display:grid; grid-template-columns:1fr 1fr; gap:8pt; }
  .maps.unica{ grid-template-columns:1fr; }
  .map-col{ text-align:center; }
  .map-col .tag{ display:block; width:100%; box-sizing:border-box; text-align:center; font-size:8pt; font-weight:800; letter-spacing:0.6pt; text-transform:uppercase; border-radius:8pt; padding:4pt 6pt; margin-bottom:5pt; }
  .tag.before{ background:#fee2e2; color:#dc2626; }
  .tag.after{ background:#d1fae5; color:#065f46; }
  .map-col svg{ width:100%; height:auto; border:0.5pt solid #e5e7eb; border-radius:8pt; }

  /* Tensão muscular (barras) */
  .row{ display:grid; grid-template-columns:110pt 1fr 26pt; align-items:center; gap:6pt; padding:4pt 0; border-bottom:0.8pt dashed #d1d5db; }
  .row:last-child{ border-bottom:none; }
  .row .name{ font-size:8.5pt; font-weight:700; }
  .track{ position:relative; height:10pt; background:#f3f4f6; border-radius:20pt; overflow:hidden; }
  .bar{ position:absolute; top:0; left:0; height:100%; border-radius:20pt; }
  .bar.s1{ background:#fecaca; }
  .bar.s4{ background:#059669; }
  .bar.s4.mid{ background:#d97706; }
  .row .val{ font-size:8.5pt; font-weight:700; text-align:right; color:#065f46; }
  .scale-note{ font-size:7.5pt; color:#9ca3af; margin-top:6pt; }

  /* Amplitude de movimento: tiles 2 colunas — anterior riscado → atual em negrito */
  .rom{ display:grid; grid-template-columns:1fr 1fr; gap:8pt; }
  .rom-item{ background:#f3f4f6; border-radius:10pt; padding:9pt 11pt; }
  .rom-item .t{ font-size:7.5pt; font-weight:800; text-transform:uppercase; letter-spacing:0.8pt; color:#9ca3af; margin-bottom:3pt; }
  .rom-item .antes{ font-size:9.5pt; color:#9ca3af; text-decoration:line-through; font-weight:600; }
  .rom-item .agora{ font-size:10pt; font-weight:800; color:#111827; margin-top:1pt; }

  /* Orientações para o treino: LED colorido + separador tracejado */
  .light{ display:flex; gap:9pt; align-items:flex-start; padding:7pt 0; border-bottom:0.8pt dashed #d1d5db; }
  .light:last-child{ border-bottom:none; padding-bottom:2pt; }
  .light .led{ flex:none; width:10pt; height:10pt; border-radius:50%; margin-top:2pt; }
  .led.g{ background:#059669; } .led.y{ background:#d97706; } .led.r{ background:#dc2626; }
  .light .tx b{ font-size:10.5pt; display:block; color:#111827; }
  .light .tx span{ font-size:9pt; color:#4b5563; line-height:1.5; display:block; margin-top:1pt; }

  /* Citação de fechamento */
  .quote-card{ background:#ecfdf5; border-left:3pt solid #059669; border-radius:0 10pt 10pt 0; padding:10pt 12pt; margin-bottom:9pt; font-family:Georgia,'Times New Roman',serif; font-style:italic; font-size:10pt; color:#065f46; line-height:1.6; page-break-inside:avoid; }

  .avisos-card{ background:#fffbeb; border:0.5pt solid #fde68a; border-radius:10pt; padding:10pt 12pt; margin-bottom:9pt; page-break-inside:avoid; }
  .avisos-title{ font-size:8pt; font-weight:700; color:#92400e; text-transform:uppercase; letter-spacing:1pt; }
  .avisos-card ul{ margin:4pt 0 0 14pt; font-size:8.5pt; color:#92400e; line-height:1.6; }
  .assinatura{ text-align:center; font-size:11pt; color:#065f46; margin-top:14pt; font-family:Georgia,serif; }

  /* Overrides deste relatório comparativo (vencem o PRINT_CSS por virem depois):
     dados do animal sem negrito e ID do atendimento (EV/AG/VC) menor. */
  .f-val{ font-weight:400; }
  .plan-name{ font-size:10pt; }
  /* Especialidade · data à esquerda; veterinário alinhado à direita — texto simples, sem "frame" */
  .plan-meta{ font-size:9pt; color:#4b5563; }
  .plan-vet{ margin-left:auto; font-size:9pt; color:#4b5563; }
  /* Remove a Raça do card do animal (2ª coluna) e reequilibra em 3 colunas */
  .animal-info{ grid-template-columns: repeat(3, 1fr); }
  .animal-info > div:nth-child(2){ display:none; }
`;

// ─── Blocos do relatório ──────────────────────────────────────────────────────

/**
 * Bloco textual de uma sessão (o que foi encontrado) — usa o componente padrão
 * de registro do print (registro-wrapper/header/body de AtendimentoPrint).
 */
function renderRegistroSessao(
  rotulo: string,
  sessao: SessaoRelatorio & { especialidade?: string },
  cor: string,
): string {
  const cabecalho = [rotulo, sessao.titulo || sessao.especialidade, fmtData(sessao.dataInicio)]
    .filter(Boolean).join(' · ');
  return `
  <div class="registro-wrapper">
    <div class="registro-header" style="background:${cor}">
      <span>${esc(cabecalho)}</span>
      <span class="badge-tag">${esc(sessao.atendimentoNumero) || 'Evolução'}</span>
    </div>
    <div class="registro-body">
      <p class="registro-texto">${esc(textoCorrido(sessao.texto)) || '—'}</p>
    </div>
  </div>`;
}

// ─── Gerador de HTML ──────────────────────────────────────────────────────────

export function gerarHtmlRelatorioAtendimento(dados: RelatorioAtendimentoDados): string {
  const { atual, anterior } = dados;
  const rcAtual = atual.resumoClinico;
  const rcAnterior = anterior?.resumoClinico ?? null;
  const temResumo = !!rcAtual && Object.keys(rcAtual).length > 0;

  // ── Scores ──
  const tensaoMedia = (rc: ResumoClinico | null | undefined): number | null =>
    rc?.tensaoMuscular?.length ? rc.tensaoMuscular.reduce((s, t) => s + t.valor, 0) / rc.tensaoMuscular.length : null;

  const scoresHtml = temResumo ? [
    rcAtual?.claudicacao ? scorePill('Claudicação (AAEP 0–5)', rcAtual.claudicacao.grauAAEP, rcAnterior?.claudicacao?.grauAAEP) : '',
    rcAtual?.dor ? scorePill('Dor à palpação (0–10)', rcAtual.dor.valor, rcAnterior?.dor?.valor) : '',
    rcAtual?.tensaoMuscular?.length ? scorePill('Tensão muscular média (0–3)', tensaoMedia(rcAtual), tensaoMedia(rcAnterior)) : '',
    rcAtual?.simetria ? scorePill('Simetria', rcAtual.simetria, rcAnterior?.simetria, { menorMelhor: false }) : '',
  ].filter(Boolean).join('') : '';

  const scoresSection = scoresHtml ? `
  <div class="sec-title">Evolução desde a última sessão</div>
  <div class="scores">${scoresHtml}</div>` : '';

  // ── Mapa corporal (body-map) ──
  const mapaSection = `
  <div class="sec-title">Mapa Corporal</div>
  <div class="rep-card">
    <div class="maps ${anterior ? '' : 'unica'}">
      ${anterior ? `
      <div class="map-col">
        <span class="tag before">Anterior · ${fmtData(anterior.dataInicio)}</span>
        ${anterior.svgColuna ?? '<p class="rep-sub">Sem mapa disponível.</p>'}
      </div>` : ''}
      <div class="map-col">
        <span class="tag after">${anterior ? 'Atual' : 'Primeira avaliação registrada'} · ${fmtData(atual.dataInicio)}</span>
        ${atual.svgColuna ?? '<p class="rep-sub">Sem mapa disponível.</p>'}
      </div>
    </div>
  </div>`;

  // ── Tensão muscular por região ──
  const tensaoSection = rcAtual?.tensaoMuscular?.length ? `
  <div class="sec-card">
    <h2>Tensão muscular por região</h2>
    <p class="sub">Escala de tônus 0–3 · barra clara = sessão anterior, barra colorida = hoje.</p>
    ${rcAtual.tensaoMuscular.map((t) => {
      const anteriorItem = rcAnterior?.tensaoMuscular?.find((a) => a.regiao === t.regiao);
      const pctAtual = Math.min(100, (t.valor / 3) * 100);
      const pctAnterior = anteriorItem ? Math.min(100, (anteriorItem.valor / 3) * 100) : pctAtual;
      const cor = t.valor >= 2 ? 'mid' : '';
      return `
      <div class="row">
        <div class="name">${esc(t.regiao)}</div>
        <div class="track">
          ${anteriorItem ? `<div class="bar s1" style="width:${pctAnterior}%"></div>` : ''}
          <div class="bar s4 ${cor}" style="width:${pctAtual}%"></div>
        </div>
        <div class="val">${num(t.valor)}</div>
      </div>`;
    }).join('')}
    <p class="scale-note">0 = tônus normal · 1 = leve · 2 = moderada · 3 = severa (contratura)</p>
  </div>` : '';

  // ── Amplitude de movimento — anterior riscado → atual em negrito ──
  const romSection = rcAtual?.rom?.length ? `
  <div class="sec-card">
    <h2>Amplitude de movimento</h2>
    <div class="rom">
      ${rcAtual.rom.map((r) => {
        const anteriorItem = rcAnterior?.rom?.find((a) => a.teste === r.teste);
        return `
        <div class="rom-item">
          <div class="t">${esc(r.teste)}</div>
          ${anteriorItem ? `<div class="antes">${esc(anteriorItem.resultado)}</div>` : ''}
          <div class="agora">→ ${esc(r.resultado)}</div>
        </div>`;
      }).join('')}
    </div>
  </div>` : '';

  // ── Orientações para o treino — LED colorido por status ──
  const treinoSection = rcAtual?.treino?.length ? `
  <div class="sec-card">
    <h2>Orientações para o treino</h2>
    <p class="sub">Válidas até a próxima sessão.</p>
    <div>
      ${rcAtual.treino.map((t) => `
      <div class="light">
        <div class="led ${TREINO_LED[t.status]}"></div>
        <div class="tx"><b>${esc(t.titulo)}</b><span>${esc(t.detalhe)}</span></div>
      </div>`).join('')}
    </div>
  </div>` : '';

  // ── Observação de fechamento — citação em destaque ──
  const quoteSection = rcAtual?.observacaoFechamento ? `
  <div class="quote-card">“${esc(rcAtual.observacaoFechamento)}”</div>` : '';

  // ── Registro textual das sessões (o que foi encontrado em cada uma) ──
  const textosSection = `
  <div class="sec-title">Registro das Sessões</div>
  ${anterior?.texto ? renderRegistroSessao('Anterior', anterior, '#6b7280') : ''}
  ${renderRegistroSessao(anterior ? 'Atual' : 'Primeira avaliação registrada', atual, '#059669')}`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Relatório de Evolução — ${esc(dados.animal.nome)} — S2Vet</title>
<style>${PRINT_CSS}${RELATORIO_CSS}</style>
</head>
<body>
${renderCabecalhoAtendimento(dados)}
${scoresSection}
${mapaSection}
${textosSection}
${tensaoSection}
${romSection}
${treinoSection}
${quoteSection}
${renderRodapeAtendimento(dados)}
</body>
</html>`;
}

// ─── Função principal (busca + imprime) ──────────────────────────────────────

export async function imprimirRelatorioAtendimento(evolucaoId: number): Promise<void> {
  const dados = await buscarRelatorioAtendimento(evolucaoId);
  imprimirHtml(gerarHtmlRelatorioAtendimento(dados));
}
