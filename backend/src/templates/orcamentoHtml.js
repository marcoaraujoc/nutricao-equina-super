// backend/src/templates/orcamentoHtml.js
// Documento do CLIENTE: orçamento resumido (sem rateio por animal), agrupado por
// tipo. Gerado no servidor porque o PDF é renderizado aqui — aceitar HTML vindo do
// cliente e abri-lo no Puppeteer permitiria SSRF (o navegador buscaria URLs internas).
//
// A impressão DETALHADA por animal continua no frontend (utils/OrcamentoPrint.ts):
// são documentos diferentes — um é operacional interno, este é o do cliente.
'use strict';

const ORDEM_TIPO  = ['PROCEDIMENTO', 'COMBO', 'MEDICAMENTO', 'VACINA', 'OUTROS'];
const TIPO_TITULO = {
  PROCEDIMENTO: 'Procedimentos',
  COMBO:        'Combos',
  MEDICAMENTO:  'Medicamentos',
  VACINA:       'Vacinas',
  OUTROS:       'Outros',
};

// Rótulos de posologia/dose no documento do cliente
const FREQUENCIA_LABEL = {
  '1xDia':    '1x ao dia',   '12em12h': '12/12h',       '8em8h':    '8/8h',
  '6em6h':    '6/6h',        '4em4h':   '4/4h',         '1em1h':    '1/1h',
  '1x2dias':  '1x a cada 2 dias',  '1x3dias':  '1x a cada 3 dias',
  '1xSemana': '1x por semana',     '1x21dias': '1x a cada 21 dias',
  '1x30dias': '1x a cada 30 dias', '1x90dias': '1x a cada 90 dias',
  continuo:   'contínuo',    agora: 'dose única', seNecessario: 'se necessário', SOS: 'SOS',
};

// Linha de detalhe abaixo da descrição: medicamento mostra dias + frequência,
// vacina mostra o nº de doses. Vazio para os demais tipos.
function detalheDoItem(i) {
  const partes = [];
  if (['MEDICAMENTO', 'PROCEDIMENTO', 'COMBO'].includes(i.tipo)) {
    if (i.dias)       partes.push(`${i.dias} dia${i.dias > 1 ? 's' : ''}`);
    if (i.frequencia) partes.push(FREQUENCIA_LABEL[i.frequencia] ?? i.frequencia);
  }
  if (i.tipo === 'VACINA') {
    const doses = Number(i.quantidade ?? 0);
    if (doses > 0) partes.push(`${doses} dose${doses > 1 ? 's' : ''}`);
  }
  if (i.descontoValor > 0) {
    partes.push(`desconto ${i.descontoTipo === 'PERCENTUAL' ? `${i.descontoValor}%` : brl(i.descontoValor)}`);
  }
  return partes.join(' · ');
}

const brl = (v) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const data = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('pt-BR');
};

// Escapa conteúdo vindo do banco (descrição/observação são texto livre do usuário)
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * Consolida as linhas: o mesmo item lançado para vários animais vira UMA linha
 * com a quantidade somada — no documento do cliente o rateio não interessa.
 */
function consolidarPorTipo(itens) {
  const porTipo = new Map();
  for (const i of itens) {
    if (!porTipo.has(i.tipo)) porTipo.set(i.tipo, new Map());
    const linhas = porTipo.get(i.tipo);
    // dias/frequência entram na chave: mesmo medicamento com posologias distintas
    // são linhas distintas (senão o detalhe exibido seria o da primeira ocorrência).
    const chave  = `${String(i.descricao).trim().toLowerCase()}|${i.valorUnitario}|${i.unidade ?? ''}|${i.dias ?? ''}|${i.frequencia ?? ''}`;
    const atual  = linhas.get(chave);
    if (atual) {
      atual.quantidade += Number(i.quantidade ?? 0);
      atual.valorTotal += Number(i.valorTotal ?? 0);
    } else {
      linhas.set(chave, { ...i, quantidade: Number(i.quantidade ?? 0), valorTotal: Number(i.valorTotal ?? 0) });
    }
  }
  const ordem = (t) => { const n = ORDEM_TIPO.indexOf(t); return n === -1 ? 99 : n; };
  return [...porTipo.keys()]
    .sort((a, b) => ordem(a) - ordem(b) || a.localeCompare(b, 'pt-BR'))
    .map(tipo => {
      const linhas = [...porTipo.get(tipo).values()]
        .sort((a, b) => String(a.descricao).localeCompare(String(b.descricao), 'pt-BR'));
      return { tipo, linhas, subtotal: linhas.reduce((s, i) => s + i.valorTotal, 0) };
    });
}

/**
 * @param {object} orc  — orçamento com { numeroFormatado, createdAt, observacao,
 *                        proprietario:{fullName}, itens[], valorTotal }
 * @param {{empresaNome?:string, logoDataUri?:string}} [empresa]
 *   logoDataUri — SOMENTE data URI. O renderizador de PDF bloqueia qualquer
 *   requisição de rede (ver htmlParaPdf), então uma URL http não carregaria; aceitar
 *   uma aqui só criaria a ilusão de que funciona — e um vetor de SSRF se o bloqueio
 *   for afrouxado no futuro. Para usar o logotipo, leia o arquivo e converta em base64.
 * @returns {string} HTML completo, pronto para o Puppeteer
 */
function gerarHtmlOrcamentoCliente(orc, empresa = {}) {
  // Defesa em profundidade: descarta qualquer coisa que não seja data URI
  const logo = typeof empresa.logoDataUri === 'string' && empresa.logoDataUri.startsWith('data:image/')
    ? empresa.logoDataUri
    : null;
  const secoes = consolidarPorTipo(orc.itens ?? []);

  const corpo = secoes.map(sec => `
    <tr class="grupo">
      <td colspan="3">${TIPO_TITULO[sec.tipo] ?? esc(sec.tipo)}</td>
      <td class="r">${brl(sec.subtotal)}</td>
    </tr>
    ${sec.linhas.map(i => `
    <tr>
      <td>
        <!-- A especialidade é obrigatória no cadastro do item, mas NÃO é exibida
             no documento enviado ao cliente (impressão/WhatsApp) — ela serve ao
             uso interno e é trazida de volta na importação para a prescrição. -->
        <span class="desc">${esc(i.descricao)}</span>
        ${detalheDoItem(i) ? `<span class="meta">${esc(detalheDoItem(i))}</span>` : ''}
      </td>
      <td class="c">${i.quantidade}${i.unidade ? ` ${esc(i.unidade)}` : ''}</td>
      <td class="r">${brl(i.valorUnitario)}</td>
      <td class="r b">${brl(i.valorTotal)}</td>
    </tr>`).join('')}
  `).join('');

  const total = orc.valorTotal ?? (orc.itens ?? []).reduce((s, i) => s + Number(i.valorTotal ?? 0), 0);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Orçamento ${esc(orc.numeroFormatado)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
         color: #111827; margin: 0; font-size: 12px; }
  h1 { font-size: 20px; margin: 0 0 2px; color: #047857; }
  .sub { color: #6b7280; font-size: 11px; margin: 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start;
          border-bottom: 2px solid #047857; padding-bottom: 10px; margin-bottom: 14px; }
  .logo { max-height: 54px; max-width: 190px; object-fit: contain; }
  .num { font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
         font-size: 16px; font-weight: 700; color: #047857; }
  .info { margin-bottom: 14px; font-size: 11px; }
  .info b { color: #6b7280; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f3f4f6; color: #6b7280; font-size: 10px; text-transform: uppercase;
       letter-spacing: .04em; text-align: left; padding: 7px 8px; border-bottom: 1px solid #e5e7eb; }
  td { padding: 7px 8px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  .c { text-align: center; white-space: nowrap; }
  .r { text-align: right; white-space: nowrap; }
  .b { font-weight: 700; }
  .desc { display: block; font-weight: 600; }
  .meta { display: block; color: #9ca3af; font-size: 10px; margin-top: 1px; }
  tr.grupo td { background: #ecfdf5; color: #047857; font-weight: 700; font-size: 11px;
                text-transform: uppercase; letter-spacing: .05em;
                border-top: 1px solid #a7f3d0; border-bottom: 1px solid #a7f3d0; }
  tr.grupo, tr { break-inside: avoid; page-break-inside: avoid; }
  .totais { margin-top: 16px; display: flex; justify-content: flex-end; }
  .totais table { width: auto; min-width: 240px; }
  .totais td { border: none; padding: 4px 8px; }
  .totais .lbl { color: #6b7280; }
  .totais .big { font-size: 16px; font-weight: 700; color: #047857; }
  .obs { margin-top: 16px; padding: 10px 12px; background: #f9fafb;
         border-left: 3px solid #d1d5db; font-size: 11px; white-space: pre-wrap; }
  .rodape { margin-top: 22px; border-top: 1px solid #e5e7eb; padding-top: 8px;
            color: #9ca3af; font-size: 10px; text-align: center; }
</style>
</head>
<body>
  <div class="head">
    <div>
      ${logo
        ? `<img class="logo" src="${esc(logo)}" alt="" />`
        : `<h1>${esc(empresa.empresaNome || 'Orçamento')}</h1>`}
      <p class="sub">Orçamento de serviços</p>
    </div>
    <div style="text-align:right">
      <div class="num">#${esc(orc.numeroFormatado)}</div>
      <p class="sub">${data(orc.createdAt)}</p>
    </div>
  </div>

  <div class="info"><b>Cliente:</b> ${esc(orc.proprietario?.fullName)}</div>

  <table>
    <thead>
      <tr>
        <th>Item</th>
        <th class="c">Qtd.</th>
        <th class="r">Valor unit.</th>
        <th class="r">Valor total</th>
      </tr>
    </thead>
    <tbody>${corpo}</tbody>
  </table>

  <div class="totais">
    <table>
      <tr><td class="lbl">Total do orçamento</td><td class="r big">${brl(total)}</td></tr>
    </table>
  </div>

  ${orc.observacao ? `<div class="obs"><b>Observação:</b>\n${esc(orc.observacao)}</div>` : ''}

  <div class="rodape">Documento gerado em ${new Date().toLocaleString('pt-BR')}</div>
</body>
</html>`;
}

module.exports = { gerarHtmlOrcamentoCliente, consolidarPorTipo };
