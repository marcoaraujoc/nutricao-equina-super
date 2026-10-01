// frontend/src/utils/PrescricaoPrint.ts

export interface PrintItemPrescricao {
  id:               number;
  tipo:             'MEDICAMENTO' | 'PROCEDIMENTO';
  medicamento:      string;
  dosagem:          string | null;
  unidade:          string | null;
  via:              string;
  frequencia:       string;
  horaInicio:       string | null;
  horariosGerados:  string[] | null;
  duracaoDias:      number;
  observacao:       string | null;
  dataInicio:       string;
}

import { type AssinaturaProfissional } from './print/assinaturaProfissional';
import { gerarHtmlFolhaClinica, prepararFolhaClinica } from './print/FolhaClinica';
import { imprimirHtml } from './print/imprimirHtml';
import { DOSES_POR_DIA } from './posologia';

export interface PrintAnimalPrescricao {
  nome:     string;
  photoUrl: string | null;
  peso:     number | null;
  baia:     string | null;
  especie:  { nome: string } | null;
  raca:     { nome: string } | null;
  logoUrl?: string | null;
  proprietario?: string | null;
}

export interface PrintGrupoPrescricao {
  /** Título da folha. A VACINA reaproveita este gerador e passa 'Vacina'. */
  titulo?:         string;
  numero:          number;
  numeroFormatado: string;
  status:          string;
  finalizadoEm:    string | null;
  finalizadoPor:   { fullName: string } | null;
  executadoPor:    { fullName: string } | null;
  /** `id` habilita a busca da assinatura escaneada DESTE veterinário. */
  veterinario:     { id?: number | null; fullName: string };
  animal:          PrintAnimalPrescricao;
  itens:           PrintItemPrescricao[];
  /**
   * Identidade de quem assina (nome do vínculo, CRMV e imagem da assinatura).
   * Resolvida por `imprimirPrescricao`/`prepararPrescricao` a partir de
   * `veterinario.id`; passe pronta quando o HTML for gerado de forma SÍNCRONA
   * (é o caso do `gerarHtml` do compartilhamento por PDF).
   */
  assinatura?:     AssinaturaProfissional | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const POSOLOGIAS: Record<string, string> = {
  '1xDia': '1x/dia',        '12em12h': '12 em 12h',   '8em8h': '8 em 8h',
  '6em6h': '6 em 6h',      '4em4h': '4 em 4h',        '1em1h': '1 em 1h',
  'continuo': 'Contínuo',  'agora': 'Dose única',      'seNecessario': 'Se necessário',
  'SOS': 'SOS',            '1x2dias': '1x/2 dias',    '1x3dias': '1x/3 dias',
  '1xSemana': '1x/semana', '1x21dias': '1x/21 dias',  '1x30dias': '1x/30 dias',
  '1x90dias': '1x/90 dias',
};

const STATUS_LABEL: Record<string, string> = {
  RASCUNHO:    'Rascunho',
  ATIVA:       'Ativa',
  FINALIZADA:  'Finalizada',
  CANCELADA:   'Cancelada',
};

const STATUS_COLOR: Record<string, string> = {
  RASCUNHO:   '#d97706',
  ATIVA:      '#059669',
  FINALIZADA: '#1d4ed8',
  CANCELADA:  '#dc2626',
};

const STATUS_BG: Record<string, string> = {
  RASCUNHO:   '#fef3c7',
  ATIVA:      '#d1fae5',
  FINALIZADA: '#dbeafe',
  CANCELADA:  '#fee2e2',
};

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(data: string | null | undefined): string {
  if (!data) return '—';
  const s = data.split('T')[0];
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

function calcDataFim(dataInicio: string, dias: number): string {
  const d = new Date(dataInicio.split('T')[0] + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + dias - 1);
  const y  = d.getUTCFullYear();
  const m  = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dy = String(d.getUTCDate()).padStart(2, '0');
  return `${dy}/${m}/${y}`;
}

function labelFrequencia(freq: string, horarios: string[] | null): string {
  const label = POSOLOGIAS[freq] ?? freq;
  if (!horarios || horarios.length === 0) return label;
  return `${label} — ${horarios.join(', ')}`;
}

// ─── Gerador de HTML ──────────────────────────────────────────────────────────

export function gerarHtmlPrescricao(g: PrintGrupoPrescricao): string {
  const { animal } = g;
  const statusLabel = STATUS_LABEL[g.status] ?? g.status;
  const statusColor = STATUS_COLOR[g.status] ?? '#6b7280';
  const statusBg    = STATUS_BG[g.status]    ?? '#f3f4f6';

  const medicamentos = g.itens.filter(i => i.tipo === 'MEDICAMENTO');
  const procedimentos = g.itens.filter(i => i.tipo === 'PROCEDIMENTO');

  function renderItens(itens: PrintItemPrescricao[]): string {
    if (itens.length === 0) return '<p style="color:#9ca3af;font-size:14.3px;">Nenhum item.</p>';
    return `
      <table class="tbl">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Dosagem</th>
            <th>Via</th>
            <th>Frequência / Horários</th>
            <th>Hora Início</th>
            <th>Duração</th>
            <th>Dt Início</th>
            <th>Dt Fim</th>
            <th>Observação</th>
          </tr>
        </thead>
        <tbody>
          ${itens.map(i => {
            // "1x a cada N dias" (inclui "1x por semana"): MESMA regra do ItemRow da
            // tela de Prescrição — `duracaoDias` é guardado em DIAS (vezes × intervalo,
            // para o backend contar as doses certas), mas aqui se exibe em VEZES, e o
            // "Dt Fim" é a data da ÚLTIMA dose (início + (vezes-1)×intervalo), não
            // início+duracaoDias-1 — que sobraria além do curso real.
            const dosesPorDiaItem = DOSES_POR_DIA[i.frequencia] ?? 1;
            const intervaloDiasItem = dosesPorDiaItem < 1 ? Math.round(1 / dosesPorDiaItem) : null;
            const vezesItem = intervaloDiasItem ? Math.max(1, Math.round(i.duracaoDias / intervaloDiasItem)) : null;
            const duracaoTxt = intervaloDiasItem
              ? `${vezesItem}x`
              : `${i.duracaoDias} dia${i.duracaoDias !== 1 ? 's' : ''}`;
            const dtFim = i.dataInicio && i.duracaoDias
              ? calcDataFim(i.dataInicio, intervaloDiasItem && vezesItem ? (vezesItem - 1) * intervaloDiasItem + 1 : i.duracaoDias)
              : '—';
            return `
            <tr>
              <td><strong>${esc(i.medicamento)}</strong></td>
              <td>${i.dosagem ? `${esc(i.dosagem)}${i.unidade ? ' ' + esc(i.unidade) : ''}` : '—'}</td>
              <td>${i.via ? esc(i.via) : '—'}</td>
              <td>${esc(labelFrequencia(i.frequencia, i.horariosGerados))}</td>
              <td>${i.horaInicio ? esc(i.horaInicio) : '—'}</td>
              <td>${duracaoTxt}</td>
              <td>${fmtDate(i.dataInicio)}</td>
              <td>${dtFim}</td>
              <td>${i.observacao ? esc(i.observacao) : '—'}</td>
            </tr>
          `;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  const titulo = g.titulo ?? 'Prescrição';
  const cssModulo = `
    .badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 700;
      color: ${statusColor};
      background: ${statusBg};
    }

    .section-title { font-size: 12px; font-weight: 700; color: #374151; text-transform: uppercase; letter-spacing: 0.05em; margin: 14px 0 8px; }

    .tbl { width: 100%; border-collapse: collapse; font-size: 12px; }
    .tbl th { background: #f9fafb; border: 1px solid #e5e7eb; padding: 5px 8px; text-align: left; font-size: 10.5px; font-weight: 700; color: #6b7280; text-transform: uppercase; }
    .tbl td { border: 1px solid #e5e7eb; padding: 5px 8px; vertical-align: top; color: #374151; }
    .tbl tr:nth-child(even) td { background: #fafafa; }
  `;

  const corpo = `
  ${medicamentos.length > 0 ? `
  <div class="section-title">Medicamentos (${medicamentos.length})</div>
  ${renderItens(medicamentos)}
  ` : ''}

  ${procedimentos.length > 0 ? `
  <div class="section-title">Procedimentos (${procedimentos.length})</div>
  ${renderItens(procedimentos)}
  ` : ''}`;

  return gerarHtmlFolhaClinica({
    documento:    `${titulo} #${g.numeroFormatado} — ${animal.nome}`,
    logoUrl:      animal.logoUrl,
    profissional: { id: g.veterinario.id, nome: g.veterinario.fullName },
    // 🔴 A linha do EXECUTOR sai em branco de propósito — ele assina à mão ao
    // aplicar; carimbar ali a assinatura escaneada do vet produziria documento
    // falso (mesma regra do bloco `assinatura` da Central de Documentos).
    assinaturasExtras: [{ nome: g.executadoPor?.fullName ?? null, cargo: `Executor da ${titulo}` }],
    animal: {
      nome:         animal.nome,
      photoUrl:     animal.photoUrl,
      especie:      animal.especie?.nome ?? null,
      raca:         animal.raca?.nome ?? null,
      peso:         animal.peso,
      baia:         animal.baia,
      proprietario: animal.proprietario ?? null,
    },
    paginas: [{
      titulo,
      subtitulo: `#${esc(g.numeroFormatado)} · <span class="badge">${esc(statusLabel)}</span>`,
      corpoHtml: corpo,
    }],
    cssModulo,
    rodape: `${titulo} #${g.numeroFormatado}`,
  });
}

// ─── Função principal ─────────────────────────────────────────────────────────

/**
 * Resolve o que a folha precisa e que só existe de forma ASSÍNCRONA — CRMV e
 * assinatura de quem prescreveu, endereço da clínica e as imagens em `data:` — e
 * devolve o grupo pronto para `gerarHtmlPrescricao`, que é síncrono.
 *
 * Use isto ANTES de compartilhar por PDF (o `gerarHtml` de compartilharPdf.ts é
 * síncrono e o Puppeteer só aceita `data:` — ver print/FolhaClinica.ts).
 * Nunca lança: sem assinatura, a folha sai com a linha em branco para assinar à
 * mão, o que é o correto e não um defeito.
 */
export async function prepararPrescricao(g: PrintGrupoPrescricao): Promise<PrintGrupoPrescricao> {
  await prepararFolhaClinica({
    profissionalId: g.veterinario.id ?? null,
    logoUrl:        g.animal.logoUrl,
    imagens:        [g.animal.photoUrl],
  });
  return g;
}

/**
 * Imprime a prescrição. É ASSÍNCRONA porque busca a assinatura do veterinário
 * antes de montar a folha — a impressão sai por iframe (`imprimirHtml`), que não
 * depende da janela de "user activation" do navegador, então esperar aqui não
 * custa o clique (ao contrário do `window.open` do WhatsApp).
 */
export async function imprimirPrescricao(g: PrintGrupoPrescricao): Promise<void> {
  imprimirHtml(gerarHtmlPrescricao(await prepararPrescricao(g)));
}