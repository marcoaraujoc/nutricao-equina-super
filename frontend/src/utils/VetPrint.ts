// ─── VetPrint.ts ──────────────────────────────────────────────────────────────
// Utilitário de impressão compartilhado — prescrições, evoluções, etc.
// Segue o mesmo padrão visual do Dietaprint.ts (S2Vet, verde, A4).
// ─────────────────────────────────────────────────────────────────────────────

import { PRINT_SHELL_CSS, renderCabecalho, renderRodapeSimples } from './print/PrintShell';
import { imprimirHtml } from './print/imprimirHtml';

export interface VetPrintAnimal {
  nome:            string;
  photoUrl?:       string | null;
  raca?:           { nome: string } | null;
  dataNascimento?: string | Date | null;
  user?:           { fullName: string; email?: string } | null;
}

export interface VetPrintVet {
  fullName: string;
  crmv?:    string | null;
  clinica?: string | null;
}

export interface VetPrintPrescricaoItem {
  tipo:        'MEDICAMENTO' | 'PROCEDIMENTO';
  medicamento: string;
  dosagem?:    string | null;
  unidade?:    string | null;
  via?:        string | null;
  frequencia:  string;
  duracaoDias: number;
  dataInicio?: string | null;
  observacao?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const POSOLOGIAS: Record<string, string> = {
  '1xDia':       'Uma vez ao dia',
  '12em12h':     '12 em 12H',
  '8em8h':       '8 em 8H',
  '6em6h':       '6 em 6H',
  '4em4h':       '4 em 4H',
  '1em1h':       '1 em 1H',
  'continuo':    'Contínuo',
  'agora':       'Agora (dose única)',
  'seNecessario':'Se necessário',
  'SOS':         'SOS',
  '1x2dias':     '1x a cada 2 dias',
  '1x3dias':     '1x a cada 3 dias',
  '1xSemana':    '1x por semana',
  '1x21dias':    '1x a cada 21 dias',
  '1x30dias':    '1x a cada 30 dias',
  '1x90dias':    '1x a cada 90 dias',
};

function labelFreq(v: string): string {
  return POSOLOGIAS[v] ?? v;
}

function formatDataBR(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const str = d instanceof Date ? d.toISOString() : String(d);
  const parts = str.split('T')[0].split('-').map(Number);
  if (parts.length < 3 || isNaN(parts[0])) return '—';
  const [y, m, day] = parts;
  return `${String(day).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`;
}

// ── CSS compartilhado ─────────────────────────────────────────────────────────

const BASE_CSS = `
  ${PRINT_SHELL_CSS}
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; color: #111; padding: 5mm 5mm 17mm; }

  .sec-title {
    font-size: 8pt; font-weight: 700; color: #059669;
    text-transform: uppercase; letter-spacing: 1pt;
    margin-bottom: 8pt; margin-top: 16pt;
  }

  .animal-card {
    display: flex; gap: 14pt; align-items: stretch;
    background: #f9fafb; border: 0.5pt solid #e5e7eb;
    border-radius: 8pt; padding: 10pt; margin-bottom: 14pt;
  }
  .animal-photo {
    width: 72pt; height: 72pt; border-radius: 6pt;
    object-fit: cover; flex-shrink: 0; border: 0.5pt solid #e5e7eb;
  }
  .animal-info { flex: 1; display: flex; flex-direction: column; justify-content: space-between; }
  .animal-top  { display: grid; grid-template-columns: repeat(3,1fr); gap: 8pt; }
  .animal-bot  { display: grid; grid-template-columns: repeat(3,1fr); gap: 8pt; margin-top: 8pt; padding-top: 8pt; border-top: 0.5pt solid #e5e7eb; }
  .f-label { font-size: 8pt;  color: #6b7280; margin-bottom: 2pt; }
  .f-val   { font-size: 10pt; font-weight: 600; color: #111; }
  .f-val-s { font-size: 9.5pt; font-weight: 500; color: #374151; }

  .rx-header {
    display: flex; justify-content: space-between; align-items: center;
    background: #059669; color: #fff; border-radius: 6pt 6pt 0 0;
    padding: 7pt 12pt; margin-top: 14pt;
  }
  .rx-title  { font-size: 12pt; font-weight: 700; }
  .rx-num    { font-size: 9pt; opacity: .85; }

  .rx-table  { width: 100%; border-collapse: collapse; border: 0.5pt solid #d1fae5; }
  .rx-table th {
    background: #f0fdf4; padding: 5pt 8pt; font-size: 8pt; font-weight: 700;
    color: #059669; text-transform: uppercase; letter-spacing: .8pt; text-align: left;
    border-bottom: 0.8pt solid #d1fae5;
  }
  .rx-table td {
    padding: 6pt 8pt; font-size: 9.5pt; color: #111;
    border-bottom: 0.3pt solid #f3f4f6; vertical-align: top;
  }
  .rx-table tbody tr:last-child td { border-bottom: none; }
  .rx-table td.tipo-med  { color: #1d4ed8; font-weight: 600; font-size: 8pt; }
  .rx-table td.tipo-proc { color: #059669; font-weight: 600; font-size: 8pt; }
  .rx-table td.obs-cell  { font-size: 8.5pt; color: #6b7280; font-style: italic; }

  .signature-block {
    margin-top: 32pt; padding-top: 10pt;
    border-top: 0.5pt solid #e5e7eb;
    display: flex; justify-content: center;
  }
  .sig-box { width: 260pt; }
  .sig-line {
    border-top: 1pt solid #111; margin-top: 28pt; margin-bottom: 4pt;
  }
  .sig-label { font-size: 9pt; color: #374151; text-align: center; }
  .sig-sub   { font-size: 8pt; color: #9ca3af; text-align: center; margin-top: 2pt; }
`;

// ── Prescrição ─────────────────────────────────────────────────────────────────

export function imprimirPrescricaoVet(
  animal:          VetPrintAnimal | null,
  vet:             VetPrintVet,
  numero:          string,
  itens:           VetPrintPrescricaoItem[],
  dataEmissaoISO?: string,
): void {
  const dataEmissao  = new Date().toLocaleDateString('pt-BR');
  const fotoUrl      = animal?.photoUrl ?? '';
  const dataDoc      = dataEmissaoISO ? formatDataBR(dataEmissaoISO) : dataEmissao;

  const meds  = itens.filter(i => i.tipo === 'MEDICAMENTO');
  const procs = itens.filter(i => i.tipo === 'PROCEDIMENTO');

  const buildRows = (lista: VetPrintPrescricaoItem[]) => lista.map(item => `
    <tr>
      <td class="${item.tipo === 'MEDICAMENTO' ? 'tipo-med' : 'tipo-proc'}">
        ${item.tipo === 'MEDICAMENTO' ? 'Medicamento' : 'Procedimento'}
      </td>
      <td><strong>${item.medicamento}</strong>${item.observacao ? `<br><span class="obs-cell">${item.observacao}</span>` : ''}</td>
      <td>${item.tipo === 'MEDICAMENTO' && item.dosagem
        ? `${item.dosagem}${item.unidade ? '&nbsp;' + item.unidade : ''}` : '—'}</td>
      <td>${item.tipo === 'MEDICAMENTO' ? (item.via ?? '—') : '—'}</td>
      <td>${labelFreq(item.frequencia)}</td>
      <td>${item.duracaoDias ? item.duracaoDias + ' dia(s)' : '—'}</td>
      <td>${formatDataBR(item.dataInicio)}</td>
    </tr>`).join('');

  const tabelaHTML = `
    <div class="rx-header">
      <span class="rx-title">Prescrição Médica Veterinária</span>
      <span class="rx-num">Nº ${numero} &nbsp;·&nbsp; ${dataDoc}</span>
    </div>
    <table class="rx-table">
      <thead><tr>
        <th>Tipo</th><th>Item</th><th>Dosagem</th><th>Via</th>
        <th>Frequência</th><th>Duração</th><th>Início</th>
      </tr></thead>
      <tbody>
        ${meds.length  > 0 ? buildRows(meds)  : ''}
        ${procs.length > 0 ? buildRows(procs) : ''}
      </tbody>
    </table>`;

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Prescrição Nº ${numero}</title>
  <style>${BASE_CSS}</style>
</head>
<body>

  ${renderCabecalho(null)}

  ${animal ? `
  <div class="sec-title">Dados do Paciente</div>
  <div class="animal-card">
    ${fotoUrl ? `<img class="animal-photo" src="${fotoUrl}" alt="${animal.nome}">` : ''}
    <div class="animal-info">
      <div class="animal-top">
        <div>
          <div class="f-label">Nome do Animal</div>
          <div class="f-val">${animal.nome}</div>
        </div>
        <div>
          <div class="f-label">Raça</div>
          <div class="f-val-s">${animal.raca?.nome ?? 'Não informada'}</div>
        </div>
        <div>
          <div class="f-label">Nascimento</div>
          <div class="f-val-s">${formatDataBR(animal.dataNascimento)}</div>
        </div>
      </div>
      ${animal.user ? `
      <div class="animal-bot">
        <div>
          <div class="f-label">Proprietário</div>
          <div class="f-val-s">${animal.user.fullName}</div>
        </div>
      </div>` : ''}
    </div>
  </div>` : ''}

  ${tabelaHTML}

  <div class="signature-block">
    <div class="sig-box">
      <div class="sig-line"></div>
      <div class="sig-label">${vet.fullName}</div>
      ${vet.crmv    ? `<div class="sig-sub">CRMV: ${vet.crmv}</div>`  : ''}
      ${vet.clinica ? `<div class="sig-sub">${vet.clinica}</div>`       : ''}
    </div>
  </div>

  ${renderRodapeSimples(`${itens.length} item${itens.length !== 1 ? 'ns' : ''}`)}

</body>
</html>`;

  imprimirHtml(html);
}