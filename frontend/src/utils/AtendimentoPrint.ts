// frontend/src/utils/AtendimentoPrint.ts
// Impressão de um atendimento completo (AG-XXXX/EV-XXXX) — evolução + todos os
// registros vinculados (prescrição, exame, vacina, encaminhamento) em uma única página.
// Segue o mesmo padrão visual de Dietaprint.ts (referência de layout do sistema).

// Desde 2026-09-29 o papel é a FOLHA CLÍNICA (`print/FolhaClinica.ts`); aqui mora só
// o CORPO — o resumo e os blocos de cada registro.
import { gerarHtmlFolhaClinica, prepararFolhaClinica, type AnimalFolha } from './print/FolhaClinica';
import { imprimirHtml } from './print/imprimirHtml';
import { DOSES_POR_DIA } from './posologia';

export interface PrintAnimal {
  nome:      string;
  photoUrl?: string | null;
  raca?:     { nome: string } | null;
  especie?:  { nome: string } | null;
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
  /** Quem conduziu — habilita CRMV e assinatura na folha. */
  responsavelId?:    number | null;
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

// ─── CSS do CORPO — cabeçalho, paciente, data e assinatura são da FOLHA CLÍNICA ─
// Exportado para reuso pelo relatório de evolução (RelatorioAtendimento.ts).

export const CSS_REGISTROS = `
  .sec-title {
    font-size: 8pt; font-weight: 700; color: #059669;
    text-transform: uppercase; letter-spacing: 1pt;
    margin-bottom: 8pt; margin-top: 16pt;
  }

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

`;

/** Paciente no formato da folha clínica — reusado pelo relatório de evolução. */
export function animalParaFolha(animal: PrintAnimal | null): AnimalFolha | null {
  if (!animal) return null;
  return {
    nome:         animal.nome,
    photoUrl:     animal.photoUrl ?? null,
    especie:      animal.especie?.nome ?? null,
    raca:         animal.raca?.nome ?? null,
    idade:        animal.idadeAnos != null ? `${animal.idadeAnos} anos` : null,
    proprietario: animal.user?.fullName ?? null,
  };
}

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
          ${item.prescricaoItens.map(m => {
            // "1x a cada N dias" (inclui "1x por semana"): mesma regra do ItemRow da
            // tela de Prescrição — `duracaoDias` vem em DIAS (vezes × intervalo), mas
            // aqui se exibe em VEZES.
            const dosesPorDiaItem = DOSES_POR_DIA[m.frequencia] ?? 1;
            const intervaloDiasItem = dosesPorDiaItem < 1 ? Math.round(1 / dosesPorDiaItem) : null;
            const duracaoTxt = intervaloDiasItem
              ? `${Math.max(1, Math.round(m.duracaoDias / intervaloDiasItem))}x`
              : m.duracaoDias ? `${m.duracaoDias} dia${m.duracaoDias > 1 ? 's' : ''}` : '—';
            return `
            <tr>
              <td>
                <div class="med-nome">${escaparHtml(m.medicamento)}</div>
                ${m.observacao ? `<div class="med-obs">${escaparHtml(m.observacao)}</div>` : ''}
              </td>
              <td>${m.dosagem ? escaparHtml(`${m.dosagem}${m.unidade ? ' ' + m.unidade : ''}`) : '—'}</td>
              <td>${escaparHtml(m.via ?? '—')}</td>
              <td>${escaparHtml(POSOLOGIA_LABEL[m.frequencia] ?? m.frequencia ?? '—')}</td>
              <td>${duracaoTxt}</td>
            </tr>
          `;
          }).join('')}
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

  const corpo = `
  <div class="sec-title">Resumo do Atendimento</div>
  <div class="resumo-box"><p class="resumo-text">${escaparHtml(resumo)}</p></div>

  <div class="sec-title">Registros do Atendimento</div>
  ${at.itens.map(buildRegistroHtml).join('')}`;

  return gerarHtmlFolhaClinica({
    documento:    `Atendimento ${at.atendimentoNumero}${animal ? ` — ${animal.nome}` : ''}`,
    logoUrl:      animal?.logoUrl,
    profissional: { id: at.responsavelId ?? null, nome: primeiro?.responsavel ?? null },
    animal:       animalParaFolha(animal),
    paginas: [{
      titulo:    'Resumo de Atendimento',
      subtitulo: `${escaparHtml(at.atendimentoNumero)} · ${fmtData(primeiro?.data)}`,
      corpoHtml: corpo,
    }],
    cssModulo: CSS_REGISTROS,
    rodape:    `Atendimento ${at.atendimentoNumero}`,
  });
}

// ─── Função principal — imprimir ──────────────────────────────────────────────

/** Resolve CRMV/assinatura, endereço da clínica e imagens — obrigatório antes de gerar PDF. */
export async function prepararAtendimento(
  at:     PrintAtendimento,
  animal: PrintAnimal | null,
): Promise<void> {
  await prepararFolhaClinica({
    profissionalId: at.responsavelId ?? null,
    logoUrl:        animal?.logoUrl,
    imagens:        [animal?.photoUrl],
  });
}

export async function imprimirAtendimento(
  at:     PrintAtendimento,
  animal: PrintAnimal | null,
): Promise<void> {
  await prepararAtendimento(at, animal);
  imprimirHtml(gerarHtmlAtendimento(at, animal));
}
