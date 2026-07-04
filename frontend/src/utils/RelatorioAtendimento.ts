// frontend/src/utils/RelatorioAtendimento.ts
//
// Relatório comparativo de atendimento — usado ao imprimir uma evolução clínica.
// Busca no backend (`GET /clinica/evolucoes/:id/relatorio-atendimento`) os dados
// da sessão atual + da evolução imediatamente anterior do animal (independente da
// especialidade — a tag da coluna anterior informa qual foi), já com o body-map
// pintado (`pintarLaudoEquino`, camada backend) e os scores clínicos extraídos por
// IA (`resumoClinico`), e monta o HTML impresso seguindo o layout de referência.
//
// Diferente dos demais utilitários de impressão (`EvolucaoPrint.ts`, etc.), este
// é ASSÍNCRONO: a primeira impressão de uma evolução roda a extração por IA no
// servidor (pode levar alguns segundos); chamadas seguintes usam o cache
// (`EvolucaoClinica.resumoIaData`) e respondem quase instantaneamente.
//
// Exporta as peças (cabeçalho/rodapé/mecanismo de impressão) separadamente para
// que Prescrição/Vacina/Exame possam reaproveitá-las no futuro — só a impressão
// de Evolução foi religada a este fluxo nesta primeira etapa.
import api from '../services/api';
import { resolverUrlAbsoluta } from './printUrl';

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
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function num(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
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
        <div class="vals"><span class="now" style="font-size:20px">${atualStr}</span></div>
        <div class="delta warn">era: ${esc(String(anteriorVal))}</div>`;
    }
  } else {
    deltaHtml = `<div class="vals"><span class="now" style="font-size:20px">${atualStr}${sufixo}</span></div>`;
  }

  return `<div class="score"><div class="lbl">${esc(label)}</div>${deltaHtml}</div>`;
}

const TREINO_LED: Record<TreinoItem['status'], string> = { liberado: 'g', restrito: 'y', suspenso: 'r' };

// ─── Peças reutilizáveis (para futura adoção por Prescrição/Vacina/Exame) ────

export function renderCabecalhoAtendimento(dados: RelatorioAtendimentoDados): string {
  const { animal, atual, logoUrl } = dados;
  const logo = resolverUrlAbsoluta(logoUrl);
  const linhas = [
    animal.especie?.nome || animal.raca?.nome
      ? [animal.especie?.nome, animal.raca?.nome].filter(Boolean).join(' · ')
      : null,
    animal.idadeAnos != null ? `${animal.idadeAnos} anos` : null,
    animal.sexo,
  ].filter(Boolean).join(' · ');

  return `
  <div class="card header">
    <div class="eyebrow">Relatório de evolução · ${esc(atual.especialidade)}</div>
    <h1>${esc(animal.nome)}</h1>
    <div class="meta">
      <div><span>Paciente</span><b>${esc(linhas) || '—'}</b></div>
      <div><span>Proprietário</span><b>${esc(animal.user?.fullName) || '—'}</b></div>
      ${animal.tipoExercicio ? `<div><span>Modalidade</span><b>${esc(animal.tipoExercicio)}</b></div>` : ''}
      <div><span>Veterinário</span><b>${esc(atual.veterinario.fullName)}</b></div>
    </div>
    <div class="badge">${esc(atual.atendimentoNumero) || 'Evolução'} · ${fmtData(atual.dataInicio)}</div>
    ${logo ? `<img class="brand-logo" src="${logo}" alt="Logo">` : ''}
  </div>`;
}

export function renderRodapeAtendimento(dados: RelatorioAtendimentoDados): string {
  const { atual } = dados;
  const avisos = atual.avisos ?? [];
  return `
  ${avisos.length > 0 ? `
  <div class="card avisos">
    <div class="section-title">Pontos para revisão manual</div>
    <ul>${avisos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
  </div>` : ''}
  <div class="footer">
    <div class="sig">${esc(atual.veterinario.fullName)}</div>
    <div class="brand">Gerado com S2Vet</div>
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

  const scoresCard = scoresHtml ? `
  <div>
    <div class="eyebrow" style="margin:6px 4px 8px">Evolução desde a última sessão</div>
    <div class="scores">${scoresHtml}</div>
  </div>` : '';

  // ── Mapa da coluna (body-map) ──
  const mapaCard = `
  <div class="card">
    <h2>Mapa corporal</h2>
    <p class="sub">Achados, avaliações e terapias aplicadas — preenchimento = terapia; contorno tracejado âmbar = achado de exame; contorno tracejado índigo = avaliação funcional.</p>
    <div class="maps ${anterior ? '' : 'unica'}">
      ${anterior ? `
      <div class="map-col">
        <span class="tag before">Sessão anterior${anterior.especialidade && anterior.especialidade !== atual.especialidade ? ` · ${esc(anterior.especialidade)}` : ''} · ${fmtData(anterior.dataInicio)}</span>
        ${anterior.svgColuna ?? '<p class="obs">Sem mapa disponível.</p>'}
      </div>` : ''}
      <div class="map-col">
        <span class="tag after">${anterior ? 'Sessão atual' : 'Primeira avaliação registrada'} · ${fmtData(atual.dataInicio)}</span>
        ${atual.svgColuna ?? '<p class="obs">Sem mapa disponível.</p>'}
      </div>
    </div>
  </div>`;

  // ── Tensão muscular por região ──
  const tensaoCard = rcAtual?.tensaoMuscular?.length ? `
  <div class="card">
    <h2>Tensão muscular por região</h2>
    <p class="sub">Escala de tônus 0–3 · barra clara = sessão anterior, barra colorida = hoje.</p>
    <div style="margin-top:12px">
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
    </div>
    <p class="scale-note">0 = tônus normal · 1 = leve · 2 = moderada · 3 = severa (contratura)</p>
  </div>` : '';

  // ── ROM ──
  const romCard = rcAtual?.rom?.length ? `
  <div class="card">
    <h2>Amplitude de movimento</h2>
    <div class="rom">
      ${rcAtual.rom.map((r) => {
        const anteriorItem = rcAnterior?.rom?.find((a) => a.teste === r.teste);
        return `
        <div class="rom-item">
          <div class="t">${esc(r.teste)}</div>
          <div class="v">${anteriorItem ? `<s>${esc(anteriorItem.resultado)}</s><br>→ ` : ''}<b>${esc(r.resultado)}</b></div>
        </div>`;
      }).join('')}
    </div>
  </div>` : '';

  // ── Orientações de treino ──
  const treinoCard = rcAtual?.treino?.length ? `
  <div class="card">
    <h2>Orientações para o treino</h2>
    <div style="margin-top:8px">
      ${rcAtual.treino.map((t) => `
      <div class="light">
        <div class="led ${TREINO_LED[t.status]}"></div>
        <div class="tx"><b>${esc(t.titulo)}</b><span>${esc(t.detalhe)}</span></div>
      </div>`).join('')}
    </div>
    ${rcAtual.observacaoFechamento ? `<div class="quote">"${esc(rcAtual.observacaoFechamento)}"</div>` : ''}
  </div>` : (rcAtual?.observacaoFechamento ? `<div class="card"><div class="quote">"${esc(rcAtual.observacaoFechamento)}"</div></div>` : '');

  // ── Texto integral da evolução (sempre presente — é o registro clínico em si) ──
  const textoCard = `
  <div class="card">
    <h2>${esc(atual.titulo) || 'Registro da evolução'}</h2>
    <p class="texto-evolucao">${esc(atual.texto)}</p>
  </div>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Relatório de Evolução — ${esc(dados.animal.nome)}</title>
<style>
  :root{
    --ink:#0b3d2e; --ink-soft:#41635a; --emerald:#0e9f6e; --emerald-deep:#065f46;
    --mist:#eef7f2; --card:#ffffff; --line:#dcece4; --amber:#e8a13c; --red:#e05252;
    --green:#22a06b; --radius:16px;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{ font-family:'Manrope',Arial,sans-serif; background:#f4faf7; color:var(--ink); font-size:12px; padding:14px; }
  .card{ background:var(--card); border:1px solid var(--line); border-radius:var(--radius); padding:16px; margin-bottom:12px; page-break-inside:avoid; position:relative; }
  .eyebrow{ font-size:10px; font-weight:800; letter-spacing:.1em; text-transform:uppercase; color:var(--emerald); }
  h1{ font-family:Georgia,serif; font-weight:600; font-size:22px; line-height:1.15; }
  h2{ font-family:Georgia,serif; font-weight:600; font-size:15px; margin-bottom:2px; }
  .sub{ font-size:11px; color:var(--ink-soft); line-height:1.5; }
  .header{ background:linear-gradient(135deg,var(--emerald-deep) 0%,#0b7a58 100%); color:#fff; border:none; }
  .header .eyebrow{ color:#a7e3c9; }
  .header h1{ color:#fff; margin:5px 0 8px; }
  .header .meta{ display:grid; grid-template-columns:repeat(4,1fr); gap:6px 12px; font-size:10.5px; }
  .header .meta span{ display:block; color:#bfe8d6; font-size:9px; text-transform:uppercase; letter-spacing:.06em; font-weight:700; }
  .header .meta b{ font-size:11px; }
  .badge{ display:inline-block; background:rgba(255,255,255,.16); border:1px solid rgba(255,255,255,.28); border-radius:999px; padding:3px 10px; font-size:10px; font-weight:700; margin-top:10px; }
  .brand-logo{ position:absolute; top:16px; right:16px; max-height:28px; max-width:140px; object-fit:contain; background:#fff; border-radius:6px; padding:3px 6px; }
  .scores{ display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }
  .score{ background:var(--card); border:1px solid var(--line); border-radius:14px; padding:10px 10px 8px; }
  .score .lbl{ font-size:9px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; color:var(--ink-soft); min-height:22px; }
  .score .vals{ display:flex; align-items:baseline; gap:6px; margin-top:4px; }
  .score .was{ font-size:13px; font-weight:600; color:#9db8ae; text-decoration:line-through; }
  .score .now{ font-family:Georgia,serif; font-size:20px; font-weight:600; }
  .score .arrow{ font-size:12px; color:var(--green); font-weight:800; }
  .score .delta{ margin-top:2px; font-size:9.5px; font-weight:700; color:var(--green); }
  .score .delta.warn{ color:var(--amber); }
  .maps{ display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:10px; }
  .maps.unica{ grid-template-columns:1fr; }
  .map-col{ text-align:center; }
  .map-col .tag{ display:inline-block; font-size:9.5px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; border-radius:999px; padding:2px 9px; margin-bottom:6px; }
  .tag.before{ background:#fdeeee; color:var(--red); }
  .tag.after{ background:#e5f6ee; color:var(--green); }
  .map-col svg{ width:100%; height:auto; border:1px solid var(--line); border-radius:10px; }
  .row{ display:grid; grid-template-columns:120px 1fr 34px; align-items:center; gap:8px; padding:6px 0; border-bottom:1px dashed var(--line); }
  .row:last-child{ border-bottom:none; }
  .row .name{ font-size:11px; font-weight:700; }
  .track{ position:relative; height:16px; background:var(--mist); border-radius:999px; overflow:hidden; }
  .bar{ position:absolute; top:0; left:0; height:100%; border-radius:999px; }
  .bar.s1{ background:#f3c6c6; }
  .bar.s4{ background:linear-gradient(90deg,var(--emerald),#34c98e); }
  .bar.s4.mid{ background:linear-gradient(90deg,var(--amber),#f0b45f); }
  .row .val{ font-size:11px; font-weight:800; text-align:right; color:var(--emerald-deep); }
  .scale-note{ font-size:9.5px; color:var(--ink-soft); margin-top:8px; }
  .rom{ display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:10px; }
  .rom-item{ background:var(--mist); border-radius:10px; padding:9px 11px; }
  .rom-item .t{ font-size:9.5px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-soft); }
  .rom-item .v{ font-size:11.5px; font-weight:700; margin-top:3px; line-height:1.4; }
  .rom-item .v s{ color:#9db8ae; font-weight:600; }
  .rom-item .v b{ color:var(--emerald-deep); }
  .light{ display:flex; gap:10px; align-items:flex-start; padding:8px 0; border-bottom:1px dashed var(--line); }
  .light:last-child{ border-bottom:none; }
  .light .led{ flex:none; width:12px; height:12px; border-radius:50%; margin-top:2px; }
  .led.g{ background:var(--green); } .led.y{ background:var(--amber); } .led.r{ background:var(--red); }
  .light .tx b{ font-size:11.5px; display:block; }
  .light .tx span{ font-size:10.5px; color:var(--ink-soft); line-height:1.4; display:block; margin-top:1px; }
  .quote{ background:var(--mist); border-left:3px solid var(--emerald); border-radius:0 10px 10px 0; padding:10px 12px; font-size:11.5px; line-height:1.5; color:var(--ink-soft); margin-top:8px; }
  .texto-evolucao{ white-space:pre-wrap; font-size:11.5px; line-height:1.7; }
  .avisos{ background:#fffbeb; border-color:#fde68a; }
  .avisos ul{ margin:6px 0 0 16px; font-size:10.5px; color:#92400e; }
  .footer{ text-align:center; padding:6px 4px 0; }
  .footer .sig{ font-family:Georgia,serif; font-size:14px; color:var(--emerald-deep); }
  .footer .brand{ margin-top:6px; font-size:9px; font-weight:800; letter-spacing:.14em; text-transform:uppercase; color:#8fb5a6; }
  @page { size: A4; margin: 14mm 16mm; }
  @media print { body{ -webkit-print-color-adjust:exact; print-color-adjust:exact; background:#fff; } }
</style>
</head>
<body>
${renderCabecalhoAtendimento(dados)}
${scoresCard}
${mapaCard}
${tensaoCard}
${romCard}
${treinoCard}
${textoCard}
${renderRodapeAtendimento(dados)}
</body>
</html>`;
}

// ─── Função principal (busca + imprime) ──────────────────────────────────────

export async function imprimirRelatorioAtendimento(evolucaoId: number): Promise<void> {
  const dados = await buscarRelatorioAtendimento(evolucaoId);
  imprimirHtml(gerarHtmlRelatorioAtendimento(dados));
}
