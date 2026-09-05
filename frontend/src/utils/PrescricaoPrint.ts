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

import {
  PRINT_SHELL_CSS, renderCabecalho, renderRodapeSimples, renderAssinaturas,
  srcImpressao, prepararImagensImpressao,
} from './print/PrintShell';
import { carregarAssinaturaProfissional, type AssinaturaProfissional } from './print/assinaturaProfissional';
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
}

export interface PrintGrupoPrescricao {
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
  const especieRaca = [animal.especie?.nome, animal.raca?.nome].filter(Boolean).join(' · ');
  // `srcImpressao`: `data:` quando já pré-resolvida (PDF do servidor), URL absoluta
  // na impressão do navegador. Ver print/PrintShell.ts.
  const fotoAnimal  = srcImpressao(animal.photoUrl);

  const medicamentos = g.itens.filter(i => i.tipo === 'MEDICAMENTO');
  const procedimentos = g.itens.filter(i => i.tipo === 'PROCEDIMENTO');

  // 🔴 A imagem da assinatura entra SÓ na linha do VETERINÁRIO que prescreveu.
  // A linha do executor sai em branco de propósito — ele assina à mão ao aplicar,
  // e carimbar ali a assinatura escaneada do vet produziria documento falso
  // (mesma regra do bloco `assinatura` da Central de Documentos).
  // O nome preferido é o do VÍNCULO com a empresa (§36-f); sem vínculo resolvido,
  // cai no nome que veio na prescrição.
  const assinaturasHtml = renderAssinaturas([
    {
      nome:          g.assinatura?.nome || g.veterinario.fullName,
      cargo:         'Médico Veterinário Responsável',
      assinaturaUrl: g.assinatura?.assinaturaUrl ?? null,
      crmv:          g.assinatura?.crmv ?? null,
    },
    {
      nome:  g.executadoPor?.fullName ?? null,
      cargo: 'Executor da Prescrição',
    },
  ]);

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

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Prescrição #${g.numeroFormatado} — S2Vet</title>
  <style>
    ${PRINT_SHELL_CSS}
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 14.3px; color: #111; background: #fff; padding: 5mm 5mm 17mm; }

    .numero { font-size: 28.6px; font-weight: 800; color: #059669; font-family: monospace; }

    .badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 700;
      color: ${statusColor};
      background: ${statusBg};
    }

    .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; margin-bottom: 12px; }
    .card-title { font-size: 13px; font-weight: 700; color: #374151; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 10px; border-bottom: 1px solid #f3f4f6; padding-bottom: 6px; }
    .card-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 16px; }
    .lbl { display: block; font-size: 11.7px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 2px; }
    .val { font-size: 14.3px; font-weight: 600; color: #111; }

    .animal-row { display: flex; align-items: center; gap: 14px; }
    .animal-photo { width: 60px; height: 60px; object-fit: cover; border-radius: 8px; border: 1px solid #e5e7eb; flex-shrink: 0; }

    .section-title { font-size: 13px; font-weight: 700; color: #374151; text-transform: uppercase; letter-spacing: 0.05em; margin: 14px 0 8px; }

    .tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
    .tbl th { background: #f9fafb; border: 1px solid #e5e7eb; padding: 5px 8px; text-align: left; font-size: 11.7px; font-weight: 700; color: #6b7280; text-transform: uppercase; }
    .tbl td { border: 1px solid #e5e7eb; padding: 5px 8px; vertical-align: top; color: #374151; }
    .tbl tr:nth-child(even) td { background: #fafafa; }

    .doc-numero-row { display: flex; justify-content: flex-end; margin-bottom: 12px; }

    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>

  ${renderCabecalho(animal.logoUrl)}

  <div class="doc-numero-row">
    <div style="text-align:right">
      <p style="font-size:13px;color:#9ca3af;margin-bottom:2px">PRESCRIÇÃO</p>
      <p class="numero">#${esc(g.numeroFormatado)}</p>
      <span class="badge">${statusLabel}</span>
    </div>
  </div>

  <div class="card">
    <div class="card-title">Animal</div>
    <div class="animal-row">
      ${fotoAnimal ? `<img src="${fotoAnimal}" alt="${esc(animal.nome)}" class="animal-photo" />` : ''}
      <div class="card-grid" style="flex:1">
        <div><span class="lbl">Nome</span><span class="val">${esc(animal.nome)}</span></div>
        <div><span class="lbl">Espécie · Raça</span><span class="val">${esc(especieRaca) || '—'}</span></div>
        <div><span class="lbl">Peso</span><span class="val">${animal.peso ? `${animal.peso} kg` : '—'}</span></div>
        ${animal.baia ? `<div><span class="lbl">Baia / Cocheira</span><span class="val">${esc(animal.baia)}</span></div>` : ''}
      </div>
    </div>
  </div>

  ${medicamentos.length > 0 ? `
  <div class="section-title">Medicamentos (${medicamentos.length})</div>
  ${renderItens(medicamentos)}
  ` : ''}

  ${procedimentos.length > 0 ? `
  <div class="section-title">Procedimentos (${procedimentos.length})</div>
  ${renderItens(procedimentos)}
  ` : ''}

  ${assinaturasHtml}

  ${renderRodapeSimples(`Prescrição #${esc(g.numeroFormatado)}`)}

</body>
</html>`;
}

// ─── Função principal ─────────────────────────────────────────────────────────

/**
 * Resolve o que a folha precisa e que só existe de forma ASSÍNCRONA — a
 * assinatura do veterinário que prescreveu e as imagens em `data:` URI — e
 * devolve o grupo pronto para `gerarHtmlPrescricao`, que é síncrono.
 *
 * Use isto ANTES de compartilhar por PDF (o `gerarHtml` de compartilharPdf.ts é
 * síncrono e o Puppeteer só aceita `data:` — ver print/PrintShell.ts).
 * Nunca lança: sem assinatura, a folha sai com a linha em branco para assinar à
 * mão, o que é o correto e não um defeito.
 */
export async function prepararPrescricao(g: PrintGrupoPrescricao): Promise<PrintGrupoPrescricao> {
  const assinatura = g.assinatura !== undefined
    ? g.assinatura
    : await carregarAssinaturaProfissional(g.veterinario.id);
  await prepararImagensImpressao([g.animal.logoUrl, g.animal.photoUrl, assinatura?.assinaturaUrl]);
  return { ...g, assinatura };
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