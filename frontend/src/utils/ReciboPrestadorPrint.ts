// frontend/src/utils/ReciboPrestadorPrint.ts
//
// RECIBO DE PAGAMENTO AO PRESTADOR — a folha. Mesmo padrão dos demais utilitários de
// impressão (iframe oculto por `imprimirHtml`, sem aba nova e sem popup blocker).
//
// 🔴 É UM RECIBO, NÃO UMA FATURA. A fatura é uma cobrança que a clínica MANDA ao
// cliente; o recibo é a declaração de que o PRESTADOR recebeu. Por isso a folha traz,
// de propósito:
//   • a frase de quitação ("recebi da … a importância de …"), que é o que dá ao papel
//     a função de comprovante;
//   • a assinatura DE QUEM RECEBE, não de quem paga;
//   • o discriminativo do serviço prestado — NOME DO ANIMAL, PROCEDIMENTO EXECUTADO,
//     VALOR e DATA DA EXECUÇÃO, que foi o que o pedido especificou.
//
// ⚠️ Os valores NÃO são recalculados aqui: chegam do backend congelados no instante
// da execução (`tb_execucoes_procedimento_prestador`). Recalcular no papel faria o
// recibo de março sair com o percentual renegociado em setembro.

import { imprimirHtml } from './print/imprimirHtml';
import { PRINT_SHELL_CSS, renderCabecalho, renderRodapeSimples } from './print/PrintShell';

export interface ReciboItem {
  id:           number;
  animal:       string;
  procedimento: string;
  quantidade:   number;
  valorCliente: number;
  valor:        number;
  explicacao:   string | null;
  executadoEm:  string;
}

export interface ReciboEmitente {
  nome?:        string | null;
  razaoSocial?: string | null;
  documento?:   string | null;
  cnpj?:        string | null;
  endereco?:    string | null;
  numero?:      string | null;
  bairro?:      string | null;
  cidade?:      string | null;
  estado?:      string | null;
  cep?:         string | null;
  telefone?:    string | null;
}

export interface ReciboPrestador {
  prestadorId:    number;
  prestadorNome:  string;
  documento:      string | null;
  tipoServico:    string | null;
  telefone:       string | null;
  email:          string | null;
  tipoPagamento:  string | null;
  formaPagamento: string | null;
  valorPagamento: number | null;
  itens:          ReciboItem[];
  totalCliente:   number;
  totalAPagar:    number;
  pendentes:      number;
}

export interface ReciboPeriodo {
  granularidade: string;
  inicio:        string;
  fim:           string;
}

const brl = (v: number): string =>
  (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const dia = (iso: string): string =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

const esc = (v: string | null | undefined): string =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * O valor por extenso. É o que distingue um recibo de um extrato: sem ele, um
 * algarismo alterado à mão não deixa contradição no papel.
 *
 * ⚠️ Escrito à mão em vez de usar biblioteca: a folha é impressa por um `iframe` com
 * HTML puro, e trazer dependência nova para uma função de 40 linhas não se paga.
 */
const UNIDADES = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove',
  'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS  = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos',
  'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

function trioPorExtenso(n: number): string {
  if (n === 0)   return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100);
  const r = n % 100;
  const partes: string[] = [];
  if (c > 0) partes.push(CENTENAS[c]);
  if (r > 0) {
    if (r < 20) partes.push(UNIDADES[r]);
    else {
      const d = Math.floor(r / 10);
      const u = r % 10;
      partes.push(u > 0 ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d]);
    }
  }
  return partes.join(' e ');
}

export function valorPorExtenso(valor: number): string {
  const total    = Math.round((Number(valor) || 0) * 100);
  const reais    = Math.floor(total / 100);
  const centavos = total % 100;

  const grupos: string[] = [];
  const milhoes = Math.floor(reais / 1_000_000);
  const milhares = Math.floor((reais % 1_000_000) / 1000);
  const resto = reais % 1000;
  if (milhoes > 0)  grupos.push(`${trioPorExtenso(milhoes)} ${milhoes === 1 ? 'milhão' : 'milhões'}`);
  if (milhares > 0) grupos.push(milhares === 1 ? 'mil' : `${trioPorExtenso(milhares)} mil`);
  if (resto > 0)    grupos.push(trioPorExtenso(resto));

  const parteReais = reais === 0
    ? 'zero real'
    : `${grupos.join(' e ')} ${reais === 1 ? 'real' : 'reais'}`;
  if (centavos === 0) return parteReais;
  const parteCent = `${trioPorExtenso(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`;
  return `${parteReais} e ${parteCent}`;
}

function linhaEmitente(e: ReciboEmitente | null): string {
  if (!e) return '';
  const nome = e.razaoSocial || e.nome || '';
  const doc  = e.documento || e.cnpj || '';
  // Cada linha some sozinha em branco — nada de "CNPJ: —" num comprovante de
  // pagamento (mesma regra do timbre do documento emitido).
  const partes = [
    e.endereco ? [e.endereco, e.numero].filter(Boolean).join(', ') : '',
    e.bairro || '',
    [e.cidade, e.estado].filter(Boolean).join('/'),
    e.cep ? `CEP ${e.cep}` : '',
  ].filter(Boolean).join(' — ');
  return `
    <div class="rc-emit">
      ${nome ? `<div class="rc-emit-nome">${esc(nome)}</div>` : ''}
      ${doc ? `<div>${doc.length === 14 ? 'CNPJ' : 'CPF'}: ${esc(doc)}</div>` : ''}
      ${partes ? `<div>${esc(partes)}</div>` : ''}
      ${e.telefone ? `<div>Telefone: ${esc(e.telefone)}</div>` : ''}
    </div>`;
}

// `PRINT_SHELL_CSS` traz o @page e os blocos de cabeçalho/rodapé, mas NÃO estiliza o
// corpo — cada gerador define a sua tipografia (é o padrão dos demais utilitários de
// impressão). Fonte em 9pt: a folha tem 5 colunas de tabela e precisa caber em A4
// retrato sem virar "A5 deitado" (ver a nota de margens em PrintShell).
const CSS_RECIBO = `
  body { font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
         font-size: 9pt; color: #111; margin: 0; }
  /* Uma folha por prestador — recibo é documento individual, e dois numa página só
     produziriam um comprovante que nenhum dos dois pode levar. */
  .rc-folha { position: relative; }
  .rc-titulo { text-align:center; font-size:13pt; font-weight:700; letter-spacing:.5px; margin:14px 0 2px; }
  .rc-sub    { text-align:center; font-size:8.5pt; color:#555; margin-bottom:12px; }
  .rc-emit   { font-size:8pt; color:#444; line-height:1.45; margin-bottom:10px; }
  .rc-emit-nome { font-weight:700; font-size:9pt; color:#111; }
  .rc-quitacao { border:1px solid #ddd; border-radius:6px; padding:10px 12px; font-size:9.5pt;
                 line-height:1.6; margin:10px 0 14px; }
  .rc-quitacao strong { font-weight:700; }
  .rc-dados  { display:flex; gap:24px; font-size:8.5pt; color:#333; margin-bottom:10px; flex-wrap:wrap; }
  .rc-dados div span { color:#777; }
  .rc-tab    { width:100%; border-collapse:collapse; font-size:8.5pt; }
  .rc-tab th { text-align:left; border-bottom:1px solid #333; padding:5px 6px; font-size:7.5pt;
               text-transform:uppercase; letter-spacing:.4px; color:#444; }
  .rc-tab td { border-bottom:1px solid #eee; padding:5px 6px; vertical-align:top; }
  .rc-tab .num { text-align:right; white-space:nowrap; }
  .rc-tab tfoot td { border-top:1px solid #333; border-bottom:none; font-weight:700; padding-top:7px; }
  .rc-exp    { font-size:7pt; color:#888; display:block; }
  .rc-aviso  { margin-top:10px; font-size:8pt; color:#8a5b00; background:#fff8e6;
               border:1px solid #f0dca8; border-radius:6px; padding:7px 9px; }
  .rc-assin  { margin-top:34px; text-align:center; font-size:8.5pt; }
  .rc-assin-linha { border-top:1px solid #333; width:62%; margin:0 auto 4px; }
`;

/**
 * Uma folha por PRESTADOR. Vários prestadores viram várias páginas no mesmo trabalho
 * de impressão — é um recibo por pessoa, e juntar dois no mesmo papel produziria um
 * comprovante que nenhum dos dois pode levar.
 */
export function gerarHtmlRecibos(
  recibos: ReciboPrestador[],
  periodo: ReciboPeriodo | null,
  emitente: ReciboEmitente | null,
  logoUrl?: string | null,
): string {
  const janela = periodo
    ? `Período de ${dia(periodo.inicio)} a ${dia(periodo.fim)}`
    : '';

  const folhas = recibos.map((r, idx) => `
    <div class="rc-folha" style="${idx > 0 ? 'page-break-before:always;' : ''}">
      ${renderCabecalho(logoUrl)}
      ${linhaEmitente(emitente)}
      <div class="rc-titulo">RECIBO DE PAGAMENTO A PRESTADOR DE SERVIÇO</div>
      <div class="rc-sub">${esc(janela)}</div>

      <div class="rc-quitacao">
        Recebi de <strong>${esc(emitente?.razaoSocial || emitente?.nome || 'a clínica')}</strong>
        a importância de <strong>${brl(r.totalAPagar)}</strong>
        (${esc(valorPorExtenso(r.totalAPagar))}),
        referente aos serviços veterinários discriminados abaixo, prestados no período de
        ${esc(periodo ? `${dia(periodo.inicio)} a ${dia(periodo.fim)}` : 'referência')},
        dando plena e geral quitação pelo valor recebido.
      </div>

      <div class="rc-dados">
        <div><span>Prestador:</span> <strong>${esc(r.prestadorNome)}</strong></div>
        ${r.documento ? `<div><span>${r.documento.length === 14 ? 'CNPJ' : 'CPF'}:</span> ${esc(r.documento)}</div>` : ''}
        ${r.tipoServico ? `<div><span>Serviço:</span> ${esc(r.tipoServico)}</div>` : ''}
        ${r.telefone ? `<div><span>Telefone:</span> ${esc(r.telefone)}</div>` : ''}
      </div>

      <table class="rc-tab">
        <thead>
          <tr>
            <th>Animal</th>
            <th>Procedimento executado</th>
            <th class="num">Data da execução</th>
            <th class="num">Valor cobrado do cliente</th>
            <th class="num">Valor a pagar</th>
          </tr>
        </thead>
        <tbody>
          ${r.itens.map(i => `
          <tr>
            <td>${esc(i.animal)}</td>
            <td>
              ${esc(i.procedimento)}${i.quantidade > 1 ? ` (${i.quantidade}×)` : ''}
              ${i.explicacao ? `<span class="rc-exp">${esc(i.explicacao)}</span>` : ''}
            </td>
            <td class="num">${dia(i.executadoEm)}</td>
            <td class="num">${brl(i.valorCliente)}</td>
            <td class="num">${brl(i.valor)}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3">Total — ${r.itens.length} procedimento${r.itens.length !== 1 ? 's' : ''}</td>
            <td class="num">${brl(r.totalCliente)}</td>
            <td class="num">${brl(r.totalAPagar)}</td>
          </tr>
        </tfoot>
      </table>

      ${r.pendentes > 0 ? `
      <div class="rc-aviso">
        ${r.pendentes} procedimento${r.pendentes !== 1 ? 's' : ''} sem valor apurado —
        o prestador está sem forma de pagamento cadastrada. O serviço consta no recibo, mas o
        valor não pôde ser calculado.
      </div>` : ''}

      <div class="rc-assin">
        <div class="rc-assin-linha"></div>
        ${esc(r.prestadorNome)}<br>
        ${r.documento ? `${r.documento.length === 14 ? 'CNPJ' : 'CPF'} ${esc(r.documento)}` : 'Prestador de serviço'}
      </div>

      ${renderRodapeSimples('Recibo de pagamento a prestador')}
    </div>`).join('');

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
    <title>Recibo de Prestador</title>
    <style>${PRINT_SHELL_CSS}${CSS_RECIBO}</style>
  </head><body>${folhas}</body></html>`;
}

export function imprimirRecibos(
  recibos: ReciboPrestador[],
  periodo: ReciboPeriodo | null,
  emitente: ReciboEmitente | null,
  logoUrl?: string | null,
): void {
  imprimirHtml(gerarHtmlRecibos(recibos, periodo, emitente, logoUrl));
}
