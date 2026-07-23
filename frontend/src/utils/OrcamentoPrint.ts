// frontend/src/utils/OrcamentoPrint.ts
// Utilitário de impressão para Orçamento — segue o padrão de EvolucaoPrint.ts
// (iframe oculto + print, sem abrir aba nova e sem depender de popup blocker).

export interface PrintOrcamentoItem {
  tipo:          string;
  descricao:     string;
  especialidade: string | null;
  quantidade:    number;
  unidade:       string | null;
  /** MEDICAMENTO — posologia orçada (dias + frequência) */
  dias?:         number | null;
  frequencia?:   string | null;
  valorUnitario: number;
  valorTotal:    number;
  statusItem:    'PENDENTE' | 'ACEITO' | 'REJEITADO';
  animal?:       { id: number; nome: string } | null;
}

export interface PrintOrcamento {
  numeroFormatado: string;
  status:          string;
  observacao:      string | null;
  createdAt:       string;
  valorTotal:      number;
  valorAceito:     number;
  proprietario:    { fullName: string };
  criadoPor?:      { fullName: string } | null;
  itens:           PrintOrcamentoItem[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  RASCUNHO:              'Rascunho',
  APROVADO:              'Aprovado',
  APROVADO_PARCIALMENTE: 'Aprovado parcialmente',
  REJEITADO:             'Rejeitado',
};

const ITEM_LABEL: Record<string, string> = {
  PENDENTE:  'Pendente',
  ACEITO:    'Aceito',
  REJEITADO: 'Rejeitado',
};

const ITEM_COR: Record<string, string> = {
  PENDENTE:  '#92400e',
  ACEITO:    '#059669',
  REJEITADO: '#dc2626',
};

const brl = (v: number): string =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const data = (iso: string): string => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
};

// Escapa o conteúdo vindo do banco — descrição/observação são texto livre do usuário.
const esc = (s: string | null | undefined): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const tipoLabel = (t: string): string =>
  t === 'COMBO' ? 'Combo' : t.charAt(0) + t.slice(1).toLowerCase();

// ─── Agrupamento: tipo → animal ──────────────────────────────────────────────

const ORDEM_TIPO = ['PROCEDIMENTO', 'COMBO', 'MEDICAMENTO', 'VACINA', 'OUTROS'];

const TIPO_TITULO: Record<string, string> = {
  PROCEDIMENTO: 'Procedimentos',
  COMBO:        'Combos',
  MEDICAMENTO:  'Medicamentos',
  VACINA:       'Vacinas',
  OUTROS:       'Outros',
};

const FREQUENCIA_LABEL: Record<string, string> = {
  '1xDia': '1x ao dia', '12em12h': '12/12h', '8em8h': '8/8h', '6em6h': '6/6h',
  '4em4h': '4/4h', '1em1h': '1/1h', '1x2dias': '1x a cada 2 dias', '1x3dias': '1x a cada 3 dias',
  '1xSemana': '1x por semana', '1x21dias': '1x a cada 21 dias', '1x30dias': '1x a cada 30 dias',
  '1x90dias': '1x a cada 90 dias', continuo: 'contínuo', agora: 'dose única',
  seNecessario: 'se necessário', SOS: 'SOS',
};

// Detalhe abaixo da descrição: medicamento mostra dias + frequência; vacina, as doses.
function detalheItem(i: PrintOrcamentoItem): string {
  if (i.tipo === 'MEDICAMENTO') {
    return [
      i.dias ? `${i.dias} dia${i.dias > 1 ? 's' : ''}` : null,
      i.frequencia ? (FREQUENCIA_LABEL[i.frequencia] ?? i.frequencia) : null,
    ].filter(Boolean).join(' · ');
  }
  if (i.tipo === 'VACINA') return i.quantidade > 0 ? `${i.quantidade} dose${i.quantidade > 1 ? 's' : ''}` : '';
  return '';
}

// Item sem animal é de nível proprietário (o orçamento pode ter itens gerais).
const SEM_ANIMAL = 'Proprietário';

interface GrupoAnimal { nome: string; itens: PrintOrcamentoItem[]; subtotal: number }
interface SecaoTipo   { tipo: string; grupos: GrupoAnimal[]; subtotal: number }

// Total do orçamento por animal, somando TODOS os tipos (o subtotal de cada seção
// cobre só aquele tipo). Ordem alfabética, com o proprietário por último.
function totaisPorAnimal(itens: PrintOrcamentoItem[]): { nome: string; total: number }[] {
  const porAnimal = new Map<string, number>();
  for (const i of itens) {
    const chave = i.animal?.nome ?? SEM_ANIMAL;
    porAnimal.set(chave, (porAnimal.get(chave) ?? 0) + i.valorTotal);
  }
  return [...porAnimal.entries()]
    .map(([nome, total]) => ({ nome, total }))
    .sort((a, b) => {
      if (a.nome === SEM_ANIMAL) return 1;
      if (b.nome === SEM_ANIMAL) return -1;
      return a.nome.localeCompare(b.nome, 'pt-BR');
    });
}

// Agrupa por tipo (na ordem de ORDEM_TIPO; tipos desconhecidos ao final) e, dentro
// de cada tipo, por animal (alfabético, com o grupo do proprietário por último).
function agruparItens(itens: PrintOrcamentoItem[]): SecaoTipo[] {
  const porTipo = new Map<string, Map<string, PrintOrcamentoItem[]>>();
  for (const i of itens) {
    if (!porTipo.has(i.tipo)) porTipo.set(i.tipo, new Map());
    const porAnimal = porTipo.get(i.tipo)!;
    const chave = i.animal?.nome ?? SEM_ANIMAL;
    if (!porAnimal.has(chave)) porAnimal.set(chave, []);
    porAnimal.get(chave)!.push(i);
  }

  const ordem = (t: string) => { const n = ORDEM_TIPO.indexOf(t); return n === -1 ? 99 : n; };
  const soma  = (lista: PrintOrcamentoItem[]) => lista.reduce((s, i) => s + i.valorTotal, 0);

  return [...porTipo.keys()]
    .sort((a, b) => ordem(a) - ordem(b) || a.localeCompare(b, 'pt-BR'))
    .map(tipo => {
      const porAnimal = porTipo.get(tipo)!;
      const grupos = [...porAnimal.keys()]
        .sort((a, b) => {
          if (a === SEM_ANIMAL) return 1;
          if (b === SEM_ANIMAL) return -1;
          return a.localeCompare(b, 'pt-BR');
        })
        .map(nome => ({ nome, itens: porAnimal.get(nome)!, subtotal: soma(porAnimal.get(nome)!) }));
      return { tipo, grupos, subtotal: grupos.reduce((s, g) => s + g.subtotal, 0) };
    });
}

// Versão RESUMIDA (sem detalhamento por animal): consolida linhas iguais do mesmo
// tipo — o mesmo procedimento lançado para 3 animais vira uma linha com quantidade 3.
// Usada no PDF enviado ao cliente, onde o rateio por animal não interessa.
function consolidarSemAnimal(itens: PrintOrcamentoItem[]): SecaoTipo[] {
  const porTipo = new Map<string, Map<string, PrintOrcamentoItem>>();
  for (const i of itens) {
    if (!porTipo.has(i.tipo)) porTipo.set(i.tipo, new Map());
    const linhas = porTipo.get(i.tipo)!;
    // dias/frequência entram na chave: o mesmo medicamento com posologias diferentes
    // continua em linhas separadas (senão o detalhe exibido seria só o da primeira).
    const chave = `${i.descricao.trim().toLowerCase()}|${i.valorUnitario}|${i.unidade ?? ''}|${i.dias ?? ''}|${i.frequencia ?? ''}`;
    const atual = linhas.get(chave);
    if (atual) {
      atual.quantidade += i.quantidade;
      atual.valorTotal += i.valorTotal;
    } else {
      // cópia: não muta o item original do orçamento
      linhas.set(chave, { ...i, animal: null });
    }
  }
  const ordem = (t: string) => { const n = ORDEM_TIPO.indexOf(t); return n === -1 ? 99 : n; };
  return [...porTipo.keys()]
    .sort((a, b) => ordem(a) - ordem(b) || a.localeCompare(b, 'pt-BR'))
    .map(tipo => {
      const linhas = [...porTipo.get(tipo)!.values()]
        .sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'));
      const subtotal = linhas.reduce((s, i) => s + i.valorTotal, 0);
      // Um único "grupo" sem nome — o render de animal é suprimido no modo resumido
      return { tipo, grupos: [{ nome: SEM_ANIMAL, itens: linhas, subtotal }], subtotal };
    });
}

// ─── HTML ────────────────────────────────────────────────────────────────────

export interface OpcoesImpressao {
  /** false = versão resumida, sem quebra por animal (padrão: true) */
  detalharAnimal?: boolean;
}

export function gerarHtmlOrcamento(orc: PrintOrcamento, opcoes: OpcoesImpressao = {}): string {
  const detalharAnimal = opcoes.detalharAnimal !== false;
  const secoes = detalharAnimal ? agruparItens(orc.itens) : consolidarSemAnimal(orc.itens);

  const linhas = secoes.map(sec => {
    // Sub-cabeçalho de animal só agrega informação quando há mais de um grupo ou
    // quando o grupo é de um animal nomeado — evita repetir "Proprietário" à toa.
    // No modo resumido nunca aparece.
    const mostrarAnimal = detalharAnimal
      && !(sec.grupos.length === 1 && sec.grupos[0].nome === SEM_ANIMAL);

    const corpo = sec.grupos.map(g => {
      const cabecalho = mostrarAnimal
        ? `<tr class="animal"><td colspan="4">${esc(g.nome)}</td><td class="r">${brl(g.subtotal)}</td></tr>`
        : '';
      const itens = g.itens.map(i => `
    <tr>
      <td>
        <span class="desc">${esc(i.descricao)}</span>
        ${detalheItem(i) ? `<span class="meta">${esc(detalheItem(i))}</span>` : ''}
      </td>
      <td class="c">${i.quantidade}${i.unidade ? ` ${esc(i.unidade)}` : ''}</td>
      <td class="r">${brl(i.valorUnitario)}</td>
      <td class="r b">${brl(i.valorTotal)}</td>
      <td class="c" style="color:${ITEM_COR[i.statusItem] ?? '#374151'}">${ITEM_LABEL[i.statusItem] ?? i.statusItem}</td>
    </tr>`).join('');
      return cabecalho + itens;
    }).join('');

    return `
    <tr class="grupo">
      <td colspan="3">${TIPO_TITULO[sec.tipo] ?? tipoLabel(sec.tipo)}</td>
      <td class="r">${brl(sec.subtotal)}</td>
      <td></td>
    </tr>${corpo}`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Orçamento ${esc(orc.numeroFormatado)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
         color: #111827; margin: 0; font-size: 12px; }
  h1 { font-size: 20px; margin: 0 0 2px; color: #047857; }
  .sub { color: #6b7280; font-size: 11px; margin: 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start;
          border-bottom: 2px solid #047857; padding-bottom: 10px; margin-bottom: 14px; }
  .num { font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
         font-size: 16px; font-weight: 700; color: #047857; }
  .info { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px 20px; margin-bottom: 14px; }
  .info div { font-size: 11px; }
  .info b { color: #6b7280; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th { background: #f3f4f6; color: #6b7280; font-size: 10px; text-transform: uppercase;
       letter-spacing: .04em; text-align: left; padding: 7px 8px; border-bottom: 1px solid #e5e7eb; }
  td { padding: 7px 8px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  .c { text-align: center; white-space: nowrap; }
  .r { text-align: right; white-space: nowrap; }
  .b { font-weight: 700; }
  .desc { display: block; font-weight: 600; }
  .meta { display: block; color: #9ca3af; font-size: 10px; margin-top: 1px; }
  /* Seção por tipo (Procedimentos, Medicamentos, Vacinas) */
  tr.grupo td { background: #ecfdf5; color: #047857; font-weight: 700;
                font-size: 11px; text-transform: uppercase; letter-spacing: .05em;
                border-top: 1px solid #a7f3d0; border-bottom: 1px solid #a7f3d0;
                padding-top: 8px; padding-bottom: 8px; }
  /* Sub-seção por animal dentro do tipo */
  tr.animal td { background: #f9fafb; color: #4b5563; font-weight: 600; font-size: 10px;
                 padding-top: 5px; padding-bottom: 5px; border-bottom: 1px solid #f3f4f6; }
  /* Não quebra a página logo após um cabeçalho de seção */
  tr.grupo, tr.animal { break-after: avoid; page-break-after: avoid; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  .totais { margin-top: 14px; display: flex; justify-content: flex-end; }
  .totais table { width: auto; min-width: 240px; }
  .totais td { border: none; padding: 4px 8px; }
  .totais .lbl { color: #6b7280; }
  .totais .big { font-size: 15px; font-weight: 700; color: #047857; }
  .totais .sec { color: #9ca3af; font-size: 9px; text-transform: uppercase;
                 letter-spacing: .06em; font-weight: 700; padding-bottom: 2px; }
  .totais .sep { border-bottom: 1px solid #e5e7eb; height: 6px; }
  .obs { margin-top: 16px; padding: 10px 12px; background: #f9fafb;
         border-left: 3px solid #d1d5db; font-size: 11px; white-space: pre-wrap; }
  .rodape { margin-top: 22px; border-top: 1px solid #e5e7eb; padding-top: 8px;
            color: #9ca3af; font-size: 10px; display: flex; justify-content: space-between; }
</style>
</head>
<body>
  <div class="head">
    <div>
      <h1>Orçamento</h1>
      <p class="sub">${STATUS_LABEL[orc.status] ?? orc.status}</p>
    </div>
    <div style="text-align:right">
      <div class="num">#${esc(orc.numeroFormatado)}</div>
      <p class="sub">${data(orc.createdAt)}</p>
    </div>
  </div>

  <div class="info">
    <div><b>Proprietário:</b> ${esc(orc.proprietario.fullName)}</div>
    <div><b>Emitido por:</b> ${esc(orc.criadoPor?.fullName ?? '—')}</div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Item</th>
        <th class="c">Qtd.</th>
        <th class="r">Valor unit.</th>
        <th class="r">Valor total</th>
        <th class="c">Situação</th>
      </tr>
    </thead>
    <tbody>${linhas}</tbody>
  </table>

  <div class="totais">
    <table>
      ${(() => {
        if (!detalharAnimal) return '';
        const porAnimal = totaisPorAnimal(orc.itens);
        // Com um único grupo o resumo apenas repetiria o total geral
        if (porAnimal.length < 2) return '';
        return `<tr><td class="sec" colspan="2">Total por animal</td></tr>` +
          porAnimal.map(a => `<tr><td class="lbl">${esc(a.nome)}</td><td class="r b">${brl(a.total)}</td></tr>`).join('') +
          `<tr><td class="sep" colspan="2"></td></tr>`;
      })()}
      <tr><td class="lbl">Total do orçamento</td><td class="r big">${brl(orc.valorTotal)}</td></tr>
      ${orc.valorAceito > 0
        ? `<tr><td class="lbl">Total aprovado</td><td class="r b">${brl(orc.valorAceito)}</td></tr>`
        : ''}
    </table>
  </div>

  ${orc.observacao ? `<div class="obs"><b>Observação:</b>\n${esc(orc.observacao)}</div>` : ''}

  <div class="rodape">
    <span>Orçamento #${esc(orc.numeroFormatado)} — ${esc(orc.proprietario.fullName)}</span>
    <span>Impresso em ${new Date().toLocaleString('pt-BR')}</span>
  </div>
</body>
</html>`;
}

// ─── Função principal ─────────────────────────────────────────────────────────

// Gera o PDF da versão RESUMIDA (sem detalhamento por animal) no próprio navegador.
// jsPDF + html2canvas já são dependências do projeto. O HTML é renderizado num
// container fora da viewport com largura fixa de A4 (794px @96dpi) para o layout
// não depender do tamanho da janela.
export async function gerarPdfOrcamento(orc: PrintOrcamento): Promise<Blob> {
  const { jsPDF } = await import('jspdf');

  const host = document.createElement('div');
  Object.assign(host.style, {
    position: 'fixed', left: '-10000px', top: '0',
    width: '794px', background: '#fff',
  });
  // Só o conteúdo do <body> — o wrapper completo traz <html>/<head>, que não
  // podem ser injetados num div.
  const html = gerarHtmlOrcamento(orc, { detalharAnimal: false });
  const corpo = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
  const estilo = html.slice(html.indexOf('<style>'), html.indexOf('</style>') + 8);
  host.innerHTML = estilo + corpo;
  document.body.appendChild(host);

  try {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    await doc.html(host, {
      x: 0, y: 0,
      width: 595,          // largura útil do A4 em pt
      windowWidth: 794,    // largura de referência usada na renderização
      autoPaging: 'text',
    });
    return doc.output('blob');
  } finally {
    document.body.removeChild(host);
  }
}

export const nomeArquivoOrcamento = (orc: PrintOrcamento) =>
  `orcamento-${orc.numeroFormatado}-${orc.proprietario.fullName.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase()}.pdf`;

export function imprimirOrcamento(orc: PrintOrcamento): void {
  const iframe = document.createElement('iframe');
  Object.assign(iframe.style, {
    position: 'fixed', top: '-9999px', left: '-9999px',
    width: '0', height: '0', border: 'none',
  });
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
  if (!doc) { document.body.removeChild(iframe); return; }

  doc.open();
  doc.write(gerarHtmlOrcamento(orc));
  doc.close();

  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => {
      if (document.body.contains(iframe)) document.body.removeChild(iframe);
    }, 500);
  }, 250);
}
