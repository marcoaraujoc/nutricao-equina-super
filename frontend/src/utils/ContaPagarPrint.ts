// frontend/src/utils/ContaPagarPrint.ts
//
// A FOLHA DA CONTA A PAGAR — o demonstrativo do que a clínica deve a um credor
// (fornecedor ou prestador) no mês. Pedido em 2026-09-18, junto das ações de
// Imprimir/Editar/WhatsApp da tela de Pagamentos.
//
// ⚠️ NÃO É UM RECIBO. O recibo (`ReciboPrestadorPrint`) é o comprovante de QUITAÇÃO,
// assinado por quem RECEBE — ele afirma que o pagamento aconteceu. Esta folha é o
// oposto: lista o que ainda se deve, para conferência ANTES de pagar. Por isso não
// tem frase de quitação nem linha de assinatura do credor; imprimir uma dívida em
// papel de recibo faria a clínica entregar ao fornecedor um documento dizendo que
// pagou o que não pagou.
//
// ⚠️ Sem dados bancários/PIX da clínica, pela mesma razão do recibo do prestador:
// aqueles campos existem para o CLIENTE pagar a clínica, e imprimi-los num papel que
// vai ao fornecedor publicaria os dados de recebimento dela para terceiros.
import { imprimirHtml } from './print/imprimirHtml';
import { PRINT_SHELL_CSS, renderCabecalho, renderRodapeSimples } from './print/PrintShell';

export interface ContaPagarItemPrint {
  animalNome:      string;
  descricao:       string;
  solicitanteNome: string;
  ocorridoEm:      string;
  quantidade:      number;
  valor:           number;
}

export interface ContaPagarPrint {
  credorNome:    string;
  tipo:          'FORNECEDOR' | 'PRESTADOR';
  mesReferencia: string | null;
  status:        string;
  total:         number;
  itens:         ContaPagarItemPrint[];
}

const esc = (t: string | null | undefined) =>
  String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

const brl = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const dataHora = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

const CSS = `
  .cp-titulo   { text-align:center; font-size:13pt; font-weight:700; margin:10px 0 2px; }
  .cp-sub      { text-align:center; font-size:9pt; color:#555; margin-bottom:12px; }
  .cp-tab      { width:100%; border-collapse:collapse; font-size:9pt; }
  .cp-tab th   { text-align:left; border-bottom:1px solid #333; padding:5px 4px; font-size:8.5pt; text-transform:uppercase; letter-spacing:.04em; }
  .cp-tab td   { border-bottom:1px solid #e5e5e5; padding:5px 4px; vertical-align:top; }
  .cp-num      { text-align:right; white-space:nowrap; }
  .cp-total    { margin-top:10px; text-align:right; font-size:11pt; font-weight:700; }
  /* O item sem valor é a PENDÊNCIA que o lançamento zerado veio tornar visível —
     no papel ele precisa gritar tanto quanto na tela, senão o total sai "certo"
     escondendo o que ninguém precificou. */
  .cp-pendente { color:#b45309; font-weight:600; }
`;

/** Uma folha por CONTA — cada credor recebe o demonstrativo só do que é dele. */
export function gerarHtmlContasPagar(contas: ContaPagarPrint[], logoUrl?: string | null): string {
  const folhas = contas.map((c, idx) => {
    const semValor = c.itens.filter(i => !i.valor || i.valor <= 0).length;
    const linhas = c.itens.map(i => `
      <tr>
        <td>${esc(i.animalNome) || '—'}</td>
        <td>${esc(i.descricao)}</td>
        <td>${esc(i.solicitanteNome) || '—'}</td>
        <td class="cp-num">${dataHora(i.ocorridoEm)}</td>
        <td class="cp-num">${i.quantidade ?? 1}</td>
        <td class="cp-num ${!i.valor || i.valor <= 0 ? 'cp-pendente' : ''}">
          ${!i.valor || i.valor <= 0 ? 'a definir' : brl(i.valor * (i.quantidade ?? 1))}
        </td>
      </tr>`).join('');

    return `
      <div style="${idx > 0 ? 'page-break-before:always;' : ''}">
        ${renderCabecalho(logoUrl)}
        <div class="cp-titulo">DEMONSTRATIVO DE VALORES A PAGAR</div>
        <div class="cp-sub">
          ${c.tipo === 'PRESTADOR' ? 'Prestador' : 'Fornecedor'}:
          <strong>${esc(c.credorNome)}</strong>
          ${c.mesReferencia ? ` &middot; Referência ${esc(c.mesReferencia)}` : ''}
          &middot; ${esc(c.status)}
        </div>
        <table class="cp-tab">
          <thead>
            <tr>
              <th>Paciente</th><th>Item</th><th>Solicitante</th>
              <th class="cp-num">Data</th><th class="cp-num">Qtd.</th><th class="cp-num">Valor</th>
            </tr>
          </thead>
          <tbody>${linhas || '<tr><td colspan="6">Nenhum lançamento.</td></tr>'}</tbody>
        </table>
        <div class="cp-total">Total: ${brl(c.total)}</div>
        ${semValor > 0 ? `<div class="cp-sub cp-pendente" style="margin-top:6px;">
          ${semValor} item(ns) ainda sem valor definido — não somam ao total.
        </div>` : ''}
        ${renderRodapeSimples(`Emitido em ${new Date().toLocaleDateString('pt-BR')}`)}
      </div>`;
  }).join('');

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
    <title>Valores a pagar</title><style>${PRINT_SHELL_CSS}${CSS}</style>
    </head><body>${folhas}</body></html>`;
}

export function imprimirContasPagar(contas: ContaPagarPrint[], logoUrl?: string | null): void {
  imprimirHtml(gerarHtmlContasPagar(contas, logoUrl));
}
