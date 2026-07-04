// frontend/src/utils/AtendimentoPrint.ts
// Impressão de um atendimento completo (AG-XXXX/EV-XXXX) — evolução + todos os
// registros vinculados (prescrição, exame, vacina, encaminhamento) em uma única página.
// Segue o mesmo padrão visual de Dietaprint.ts (referência de layout do sistema).

import { resolverUrlAbsoluta } from './printUrl';

export interface PrintAnimal {
  nome:      string;
  photoUrl?: string | null;
  raca?:     { nome: string } | null;
  user?:     { fullName: string } | null;
  idadeAnos?: number | null;
  logoUrl?:  string | null;
}

export interface PrintPrescricaoItem {
  tipo:        string;
  medicamento: string;
  dosagem:     string | null;
  unidade:     string | null;
  via:         string;
  frequencia:  string;
  duracaoDias: number;
  observacao:  string | null;
}

export interface PrintAtendimentoItem {
  origem:          string;
  badge:           string;
  titulo:          string;
  resumo:          string;
  responsavel:     string | null;
  data:            string;
  prescricaoItens?: PrintPrescricaoItem[]; // detalhe completo — só preenchido para PRESCRICAO
}

export interface PrintAtendimento {
  atendimentoNumero: string;
  itens:             PrintAtendimentoItem[]; // primeiro item = evolução
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ORIGEM_COR: Record<string, string> = {
  EVOLUCAO:        '#059669',
  VACINA:          '#0d9488',
  EXAME:           '#7c3aed',
  EXAME_LAB:       '#2563eb',
  EXAME_IMG:       '#0284c7',
  EXAME_BIO:       '#7c3aed',
  EXAME_COMPRA:    '#d97706',
  PRESCRICAO:      '#4f46e5',
  ENCAMINHAMENTO:  '#ea580c',
};

const ORIGEM_LABEL_RESUMO: Record<string, string> = {
  EVOLUCAO:        'evolução clínica',
  VACINA:          'aplicação de vacina',
  EXAME:           'exame',
  EXAME_LAB:       'exame laboratorial',
  EXAME_IMG:       'exame de imagem',
  EXAME_BIO:       'exame bioquímico',
  EXAME_COMPRA:    'laudo de compra',
  PRESCRICAO:      'prescrição médica',
  ENCAMINHAMENTO:  'encaminhamento',
};

const POSOLOGIA_LABEL: Record<string, string> = {
  '1xDia':        'Uma vez ao dia',
  '12em12h':      '12 em 12h',
  '8em8h':        '8 em 8h',
  '6em6h':        '6 em 6h',
  '4em4h':        '4 em 4h',
  '1em1h':        '1 em 1h',
  'continuo':     'Contínuo',
  'agora':        'Dose única',
  'seNecessario': 'Se necessário',
  'SOS':          'SOS',
  '1x2dias':      '1x a cada 2 dias',
  '1x3dias':      '1x a cada 3 dias',
  '1xSemana':     '1x por semana',
  '1x21dias':     '1x a cada 21 dias',
  '1x30dias':     '1x a cada 30 dias',
  '1x90dias':     '1x a cada 90 dias',
};

function fmtData(data: string | null | undefined): string {
  if (!data) return '—';
  const d = new Date(data);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}


function escaparHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function gerarResumoTexto(numero: string, dataAtendimento: string, itens: PrintAtendimentoItem[]): string {
  const labels = itens.map(i => ORIGEM_LABEL_RESUMO[i.origem] ?? i.badge.toLowerCase());
  const unicos = [...new Set(labels)];
  const responsavel = itens.find(i => i.responsavel)?.responsavel;

  let frase = `Atendimento ${numero}, realizado em ${fmtData(dataAtendimento)}`;
  if (responsavel) frase += `, conduzido por ${responsavel}`;
  frase += `. Durante o atendimento foram realizados: ${unicos.join(', ')}.`;
  return frase;
}

// ─── CSS — mesmo padrão visual de Dietaprint.ts ───────────────────────────────

const PRINT_CSS = `
  @page { size: A4; margin: 18mm 20mm; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Arial, Helvetica, sans-serif; font-size: 11pt; color: #111;
    padding: 18mm 20mm;
  }

  .sys-header {
    display: flex; justify-content: space-between; align-items: flex-start;
    border-bottom: 2pt solid #059669; padding-bottom: 10pt; margin-bottom: 18pt;
  }
  .sys-name { font-size: 22pt; font-weight: 700; color: #059669; line-height: 1; }
  .brand-logo { max-height: 28pt; max-width: 160pt; object-fit: contain; }
  .sys-sub  { font-size: 9pt;  color: #6b7280; margin-top: 4pt; }
  .sys-date { font-size: 9pt;  color: #9ca3af; text-align: right; line-height: 1.7; }

  .sec-title {
    font-size: 8pt; font-weight: 700; color: #059669;
    text-transform: uppercase; letter-spacing: 1pt;
    margin-bottom: 8pt; margin-top: 16pt;
  }

  .animal-card {
    display: flex; gap: 14pt; align-items: stretch;
    background: #f9fafb; border: 0.5pt solid #e5e7eb;
    border-radius: 8pt; padding: 10pt; margin-bottom: 4pt;
  }
  .animal-photo {
    width: 62pt; height: 62pt; border-radius: 6pt;
    object-fit: cover; flex-shrink: 0; border: 0.5pt solid #e5e7eb;
  }
  .animal-photo-empty {
    width: 62pt; height: 62pt; border-radius: 6pt; flex-shrink: 0;
    border: 0.5pt solid #e5e7eb; background: #f3f4f6;
    display: flex; align-items: center; justify-content: center;
    font-size: 20pt;
  }
  .animal-info { flex: 1; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8pt; align-items: center; }
  .f-label { font-size: 8pt;   color: #6b7280; margin-bottom: 3pt; }
  .f-val   { font-size: 10pt;  font-weight: 600; color: #111; }

  .plan-row {
    position: relative; display: flex; justify-content: flex-start; align-items: center; gap: 10pt;
    margin-top: 14pt; margin-bottom: 10pt;
  }
  .plan-name { font-size: 15pt; font-weight: 700; color: #111; text-align: left; font-family: monospace; }
  .badge     { font-size: 9pt; font-weight: 600; padding: 3pt 10pt; border-radius: 20pt; border: 0.8pt solid; color: #065f46; border-color: #059669; background: #d1fae5; }

  .resumo-box {
    background: #f9fafb; border: 0.5pt solid #e5e7eb; border-radius: 8pt;
    padding: 10pt 12pt; margin-bottom: 4pt;
  }
  .resumo-text { font-size: 10pt; line-height: 1.6; color: #374151; }

  /* ── Blocos de registro (mesmo padrão do period-wrapper de Dietaprint) ── */
  .registro-wrapper {
    border: 0.5pt solid #e5e7eb; border-radius: 6pt;
    overflow: hidden; margin-bottom: 12pt;
    page-break-inside: avoid;
  }
  .registro-header {
    color: #fff; font-size: 9.5pt; font-weight: 700;
    padding: 7pt 12pt; display: flex; justify-content: space-between; align-items: baseline;
  }
  .registro-header .badge-tag { font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1pt; opacity: 0.85; }
  .registro-body { padding: 10pt 12pt; }
  .registro-texto { font-size: 10pt; line-height: 1.6; color: #374151; white-space: pre-wrap; }
  .registro-meta { font-size: 8.5pt; color: #9ca3af; margin-top: 8pt; }

  .med-table { width: 100%; border-collapse: collapse; margin-top: 2pt; }
  .med-table th {
    font-size: 7.5pt; font-weight: 700; color: #6b7280; text-transform: uppercase;
    letter-spacing: 0.5pt; text-align: left; padding: 4pt 6pt;
    border-bottom: 0.8pt solid #e5e7eb;
  }
  .med-table td {
    font-size: 9.5pt; color: #111; padding: 5pt 6pt;
    border-bottom: 0.3pt solid #f3f4f6; vertical-align: top;
  }
  .med-table tr:last-child td { border-bottom: none; }
  .med-nome { font-weight: 600; }
  .med-obs  { font-size: 8.5pt; color: #9ca3af; margin-top: 2pt; }

  .footer {
    margin-top: 20pt; padding-top: 8pt;
    border-top: 0.5pt solid #e5e7eb;
    font-size: 8pt; color: #9ca3af;
    display: flex; justify-content: space-between;
  }

  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`;

// ─── Registro individual ──────────────────────────────────────────────────────

function buildRegistroHtml(item: PrintAtendimentoItem): string {
  const cor = ORIGEM_COR[item.origem] ?? '#374151';

  const corpo = item.prescricaoItens && item.prescricaoItens.length > 0
    ? `
      <table class="med-table">
        <thead>
          <tr><th>Medicamento</th><th>Dose</th><th>Via</th><th>Frequência</th><th>Duração</th></tr>
        </thead>
        <tbody>
          ${item.prescricaoItens.map(m => `
            <tr>
              <td>
                <div class="med-nome">${escaparHtml(m.medicamento)}</div>
                ${m.observacao ? `<div class="med-obs">${escaparHtml(m.observacao)}</div>` : ''}
              </td>
              <td>${m.dosagem ? escaparHtml(`${m.dosagem}${m.unidade ? ' ' + m.unidade : ''}`) : '—'}</td>
              <td>${escaparHtml(m.via ?? '—')}</td>
              <td>${escaparHtml(POSOLOGIA_LABEL[m.frequencia] ?? m.frequencia ?? '—')}</td>
              <td>${m.duracaoDias ? `${m.duracaoDias} dia${m.duracaoDias > 1 ? 's' : ''}` : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `
    : `<p class="registro-texto">${escaparHtml(item.resumo || '—')}</p>`;

  return `
    <div class="registro-wrapper">
      <div class="registro-header" style="background:${cor}">
        <span>${escaparHtml(item.titulo)}</span>
        <span class="badge-tag">${escaparHtml(item.badge)}</span>
      </div>
      <div class="registro-body">
        ${corpo}
        <div class="registro-meta">
          ${item.responsavel ? `Responsável: ${escaparHtml(item.responsavel)} · ` : ''}${fmtData(item.data)}
        </div>
      </div>
    </div>
  `;
}

// ─── Gerador de HTML ──────────────────────────────────────────────────────────

export function gerarHtmlAtendimento(
  at:     PrintAtendimento,
  animal: PrintAnimal | null,
): string {
  const primeiro = at.itens[0] ?? null;
  const resumo   = gerarResumoTexto(at.atendimentoNumero, primeiro?.data ?? new Date().toISOString(), at.itens);
  const agora    = new Date();
  const fotoUrl  = resolverUrlAbsoluta(animal?.photoUrl);
  const logoUrl  = resolverUrlAbsoluta(animal?.logoUrl);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Atendimento ${escaparHtml(at.atendimentoNumero)} — S2Vet</title>
  <style>${PRINT_CSS}</style>
</head>
<body>

  <div class="sys-header">
    <div>
      ${logoUrl ? `<img class="brand-logo" src="${logoUrl}" alt="Logo">` : `<div class="sys-name">S2Vet</div>`}
      <div class="sys-sub">Sistema Hospitalar Veterinário · Resumo de Atendimento</div>
    </div>
    <div class="sys-date">
      Emitido em ${agora.toLocaleDateString('pt-BR')}<br>às ${agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
    </div>
  </div>

  <div class="sec-title">Dados do Animal</div>
  <div class="animal-card">
    ${fotoUrl
      ? `<img class="animal-photo" src="${fotoUrl}" alt="${escaparHtml(animal?.nome ?? '')}">`
      : `<div class="animal-photo-empty">🐾</div>`}
    <div class="animal-info">
      <div><div class="f-label">Animal</div><div class="f-val">${escaparHtml(animal?.nome ?? '—')}</div></div>
      <div><div class="f-label">Raça</div><div class="f-val">${escaparHtml(animal?.raca?.nome ?? '—')}</div></div>
      <div><div class="f-label">Idade</div><div class="f-val">${animal?.idadeAnos != null ? `${animal.idadeAnos} anos` : '—'}</div></div>
      <div><div class="f-label">Proprietário</div><div class="f-val">${escaparHtml(animal?.user?.fullName ?? '—')}</div></div>
    </div>
  </div>

  <div class="plan-row">
    <span class="plan-name">${escaparHtml(at.atendimentoNumero)}</span>
    <span class="badge">${fmtData(primeiro?.data)}</span>
  </div>

  <div class="sec-title">Resumo do Atendimento</div>
  <div class="resumo-box"><p class="resumo-text">${escaparHtml(resumo)}</p></div>

  <div class="sec-title">Registros do Atendimento</div>
  ${at.itens.map(buildRegistroHtml).join('')}

  <div class="footer">
    <span>S2Vet · Sistema Hospitalar Veterinário</span>
    <span>Atendimento ${escaparHtml(at.atendimentoNumero)}</span>
  </div>

</body>
</html>`;
}

// ─── Função principal — imprimir ──────────────────────────────────────────────

export function imprimirAtendimento(
  at:     PrintAtendimento,
  animal: PrintAnimal | null,
): void {
  const iframe = document.createElement('iframe');
  Object.assign(iframe.style, {
    position: 'fixed', top: '-9999px', left: '-9999px',
    width: '0', height: '0', border: 'none',
  });
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
  if (!doc) { document.body.removeChild(iframe); return; }

  doc.open();
  doc.write(gerarHtmlAtendimento(at, animal));
  doc.close();

  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => {
      if (document.body.contains(iframe)) document.body.removeChild(iframe);
    }, 500);
  }, 250);
}
