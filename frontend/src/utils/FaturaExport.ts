// frontend/src/utils/FaturaExport.ts
// Utilitários de exportação: PDF (print), CSV e Share para o módulo financeiro

import { resolverUrlAbsoluta } from './printUrl';

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function formatMes(ref?: string | null) {
  if (!ref) return 'Mês atual';
  const [ano, mes] = ref.split('-');
  return `${MESES[Number(mes) - 1]}/${ano}`;
}

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ─── Tipos locais (reutilizados de Faturamento) ───────────────────────────────

interface AnimalMin { id: number; nome: string; especie?: { nome: string } | null }
interface ItemMin   {
  animalId?: number | null; tipo: string; descricao: string; valor: number; quantidade: number;
  descontoTipo?: 'PERCENTUAL' | 'VALOR' | null; descontoValor?: number;
}

// Desconto e total líquido do item — mesma regra do backend (lib/faturaUtils.js)
function descontoItem(i: ItemMin) {
  const bruto = i.valor * i.quantidade;
  const d     = Number(i.descontoValor ?? 0);
  if (!d || d <= 0) return 0;
  const abatimento = i.descontoTipo === 'PERCENTUAL' ? bruto * (Math.min(d, 100) / 100) : d;
  return Math.min(Math.max(abatimento, 0), Math.max(bruto, 0));
}
function totalItem(i: ItemMin) {
  return i.valor * i.quantidade - descontoItem(i);
}

// Texto do desconto exibido nos documentos ("10%" ou "R$ 25,00"); vazio se não houver
function labelDesconto(i: ItemMin) {
  if (descontoItem(i) <= 0) return '';
  return i.descontoTipo === 'PERCENTUAL' ? `${i.descontoValor}%` : brl(Number(i.descontoValor ?? 0));
}
interface FaturaMin {
  id: number; total: number; status: string; mesReferencia?: string | null;
  itens: ItemMin[];
  proprietario?: { fullName: string; email: string; phone?: string | null } | null;
}

// ─── PDF / Impressão ─────────────────────────────────────────────────────────

export function imprimirFatura(fatura: FaturaMin, animais: AnimalMin[], logoUrl?: string | null) {
  const animalMap = new Map(animais.map(a => [a.id, a]));

  // Agrupa itens por animal
  const grupos = new Map<string, { nome: string; itens: ItemMin[] }>();
  for (const item of fatura.itens) {
    const key  = String(item.animalId ?? 'outros');
    const nome = item.animalId
      ? (animalMap.get(item.animalId)?.nome ?? `Animal #${item.animalId}`)
      : 'Outros Lançamentos';
    if (!grupos.has(key)) grupos.set(key, { nome, itens: [] });
    grupos.get(key)!.itens.push(item);
  }

  const linhasGrupos = [...grupos.values()].map(g => {
    const subtotal = g.itens.reduce((s, i) => s + totalItem(i), 0);
    const linhasItens = g.itens.map(i => `
      <tr>
        <td><span class="badge ${i.tipo.toLowerCase()}">${i.tipo}</span></td>
        <td>${i.descricao}${labelDesconto(i) ? `<br/><small style="color:#dc2626">Desconto ${labelDesconto(i)} (−${brl(descontoItem(i))})</small>` : ''}</td>
        <td class="center">${i.quantidade}</td>
        <td class="right">${brl(i.valor)}</td>
        <td class="right">${brl(totalItem(i))}</td>
      </tr>`).join('');
    return `
      <tr class="group-header">
        <td colspan="4">Prontuário de <strong>${g.nome}</strong></td>
        <td class="right">Subtotal: ${brl(subtotal)}</td>
      </tr>
      ${linhasItens}`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <title>Fatura INV-${String(fatura.id).padStart(3,'0')}</title>
  <style>
    @page { size: A4; margin: 20mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', sans-serif; font-size: 11px; color: #1a1a1a; }

    .header { background: #166534; color: #fff; padding: 18px 24px; border-radius: 8px; margin-bottom: 20px;
               display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .header h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
    .header .sub { font-size: 11px; opacity: .8; }
    .header .meta { margin-top: 10px; font-size: 11px; opacity: .75; display: flex; gap: 24px; flex-wrap: wrap; }
    .brand-logo-box { background: #fff; border-radius: 8px; padding: 6px 10px; flex-shrink: 0; }
    .brand-logo { max-height: 32px; max-width: 160px; object-fit: contain; display: block; }

    .badge { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 9px; font-weight: 700; text-transform: uppercase; }
    .badge.assistencia  { background: #dbeafe; color: #1d4ed8; }
    .badge.medicamento  { background: #ede9fe; color: #6d28d9; }
    .badge.procedimento { background: #d1fae5; color: #065f46; }

    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    th    { background: #f3f4f6; font-size: 10px; text-transform: uppercase; letter-spacing: .05em;
            padding: 7px 10px; text-align: left; border-bottom: 2px solid #e5e7eb; }
    td    { padding: 7px 10px; border-bottom: 1px solid #f3f4f6; vertical-align: middle; }
    tr.group-header td { background: #f9fafb; font-size: 11px; color: #374151; padding: 8px 10px; border-top: 2px solid #e5e7eb; }
    .center { text-align: center; }
    .right  { text-align: right; }

    .total-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px 20px;
                 display: flex; justify-content: space-between; align-items: center; }
    .total-box .label { font-size: 12px; color: #374151; }
    .total-box .value { font-size: 22px; font-weight: 800; color: #dc2626; }

    .status-ABERTA    { color: #b45309; background: #fef3c7; }
    .status-PAGA      { color: #065f46; background: #d1fae5; }
    .status-CANCELADA { color: #6b7280; background: #f3f4f6; }
    .status-badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 10px; font-weight: 700; }

    .footer { margin-top: 32px; font-size: 10px; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 10px; }
    @media print { .no-print { display: none; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>${fatura.proprietario?.fullName ?? 'Cliente'}</h1>
      <div class="sub">Fatura Ref: INV-${String(fatura.id).padStart(3,'0')} · ${formatMes(fatura.mesReferencia)}</div>
      <div class="meta">
        ${fatura.proprietario?.phone ? `<span>Fone: ${fatura.proprietario.phone}</span>` : ''}
        ${fatura.proprietario?.email ? `<span>Email: ${fatura.proprietario.email}</span>` : ''}
        <span>Status: <span class="status-badge status-${fatura.status}">${fatura.status}</span></span>
      </div>
    </div>
    ${resolverUrlAbsoluta(logoUrl) ? `<div class="brand-logo-box"><img class="brand-logo" src="${resolverUrlAbsoluta(logoUrl)}" alt="Logo"></div>` : ''}
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:110px">Tipo</th>
        <th>Descrição</th>
        <th class="center" style="width:60px">Qtd.</th>
        <th class="right" style="width:100px">Valor Unit.</th>
        <th class="right" style="width:110px">Subtotal</th>
      </tr>
    </thead>
    <tbody>
      ${linhasGrupos}
    </tbody>
  </table>

  <div class="total-box">
    <span class="label">Valor Total da Fatura Única</span>
    <span class="value">${brl(fatura.total)}</span>
  </div>

  <div class="footer">
    Emitido em ${new Date().toLocaleString('pt-BR')} · S2Vet — Sistema Hospitalar Veterinário
  </div>
</body>
</html>`;

  // Usa iframe oculto (mesmo padrão de Dieta/EvolucaoPrint) para não abrir nova aba
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

// ─── CSV ──────────────────────────────────────────────────────────────────────

export function exportarFaturaCSV(fatura: FaturaMin, animais: AnimalMin[]) {
  const animalMap = new Map(animais.map(a => [a.id, a]));

  const linhas: string[][] = [
    ['Fatura', `INV-${String(fatura.id).padStart(3,'0')}`],
    ['Proprietário', fatura.proprietario?.fullName ?? ''],
    ['Email', fatura.proprietario?.email ?? ''],
    ['Mês de Referência', formatMes(fatura.mesReferencia)],
    ['Status', fatura.status],
    [''],
    ['Animal', 'Tipo', 'Descrição', 'Quantidade', 'Valor Unitário (R$)', 'Desconto (R$)', 'Subtotal (R$)'],
  ];

  for (const item of fatura.itens) {
    const nomeAnimal = item.animalId
      ? (animalMap.get(item.animalId)?.nome ?? `Animal #${item.animalId}`)
      : 'Outros';
    linhas.push([
      nomeAnimal,
      item.tipo,
      item.descricao,
      String(item.quantidade),
      item.valor.toFixed(2).replace('.', ','),
      descontoItem(item).toFixed(2).replace('.', ','),
      totalItem(item).toFixed(2).replace('.', ','),
    ]);
  }

  linhas.push(['']);
  linhas.push(['', '', '', '', '', 'TOTAL', fatura.total.toFixed(2).replace('.', ',')]);

  const csv = linhas
    .map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');

  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `fatura-INV-${String(fatura.id).padStart(3,'0')}-${fatura.proprietario?.fullName?.replace(/\s+/g,'-') ?? 'cliente'}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── WhatsApp — compartilhar PDF ─────────────────────────────────────────────

async function gerarPdfBlob(fatura: FaturaMin, animais: AnimalMin[], logoUrl?: string | null): Promise<Blob> {
  // Renderiza o HTML da fatura em um iframe oculto, captura com html2canvas e gera PDF
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
    import('jspdf'),
    import('html2canvas'),
  ]);

  const inv   = `INV-${String(fatura.id).padStart(3, '0')}`;
  const nome  = fatura.proprietario?.fullName ?? 'Cliente';

  // Reutiliza a mesma lógica de HTML de imprimirFatura (simplificada)
  const animalMap = new Map(animais.map(a => [a.id, a]));
  const grupos = new Map<string, { nome: string; itens: ItemMin[] }>();
  for (const item of fatura.itens) {
    const key = String(item.animalId ?? 'outros');
    const n   = item.animalId
      ? (animalMap.get(item.animalId)?.nome ?? `Animal #${item.animalId}`)
      : 'Outros Lançamentos';
    if (!grupos.has(key)) grupos.set(key, { nome: n, itens: [] });
    grupos.get(key)!.itens.push(item);
  }

  const linhasGrupos = [...grupos.values()].map(g => {
    const subtotal   = g.itens.reduce((s, i) => s + totalItem(i), 0);
    const linhasItens = g.itens.map(i => `
      <tr>
        <td><span class="badge ${i.tipo.toLowerCase()}">${i.tipo}</span></td>
        <td>${i.descricao}${labelDesconto(i) ? `<br/><small style="color:#dc2626">Desconto ${labelDesconto(i)} (−${brl(descontoItem(i))})</small>` : ''}</td>
        <td class="center">${i.quantidade}</td>
        <td class="right">${brl(i.valor)}</td>
        <td class="right">${brl(totalItem(i))}</td>
      </tr>`).join('');
    return `
      <tr class="group-header">
        <td colspan="4"><strong>${g.nome}</strong></td>
        <td class="right">Subtotal: ${brl(subtotal)}</td>
      </tr>${linhasItens}`;
  }).join('');

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;font-size:11px;color:#1a1a1a;width:794px;padding:24px}
    .header{background:#166534;color:#fff;padding:16px 20px;border-radius:8px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
    .header h1{font-size:18px;font-weight:700;margin-bottom:2px}
    .header .sub{font-size:10px;opacity:.8}
    .header .meta{margin-top:8px;font-size:10px;opacity:.75;display:flex;gap:20px;flex-wrap:wrap}
    .brand-logo-box{background:#fff;border-radius:8px;padding:5px 8px;flex-shrink:0}
    .brand-logo{max-height:28px;max-width:140px;object-fit:contain;display:block}
    .badge{display:inline-block;padding:1px 7px;border-radius:999px;font-size:9px;font-weight:700;text-transform:uppercase}
    .badge.assistencia{background:#dbeafe;color:#1d4ed8}
    .badge.medicamento{background:#ede9fe;color:#6d28d9}
    .badge.procedimento{background:#d1fae5;color:#065f46}
    table{width:100%;border-collapse:collapse;margin-bottom:16px}
    th{background:#f3f4f6;font-size:9px;text-transform:uppercase;padding:6px 8px;text-align:left;border-bottom:2px solid #e5e7eb}
    td{padding:6px 8px;border-bottom:1px solid #f3f4f6;vertical-align:middle}
    tr.group-header td{background:#f9fafb;font-size:10px;color:#374151;padding:7px 8px;border-top:2px solid #e5e7eb}
    .center{text-align:center}.right{text-align:right}
    .total-box{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center}
    .total-box .label{font-size:11px;color:#374151}
    .total-box .value{font-size:20px;font-weight:800;color:#dc2626}
    .footer{margin-top:24px;font-size:9px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:8px}
  </style></head><body>
  <div class="header">
    <div>
      <h1>${nome}</h1>
      <div class="sub">Fatura Ref: ${inv} · ${formatMes(fatura.mesReferencia)}</div>
      <div class="meta">
        ${fatura.proprietario?.phone ? `<span>Fone: ${fatura.proprietario.phone}</span>` : ''}
        ${fatura.proprietario?.email ? `<span>Email: ${fatura.proprietario.email}</span>` : ''}
        <span>Status: ${fatura.status}</span>
      </div>
    </div>
    ${resolverUrlAbsoluta(logoUrl) ? `<div class="brand-logo-box"><img class="brand-logo" src="${resolverUrlAbsoluta(logoUrl)}" alt="Logo"></div>` : ''}
  </div>
  <table>
    <thead><tr><th style="width:100px">Tipo</th><th>Descrição</th><th class="center" style="width:50px">Qtd.</th><th class="right" style="width:90px">Valor Unit.</th><th class="right" style="width:100px">Subtotal</th></tr></thead>
    <tbody>${linhasGrupos}</tbody>
  </table>
  <div class="total-box">
    <span class="label">Valor Total da Fatura Única</span>
    <span class="value">${brl(fatura.total)}</span>
  </div>
  <div class="footer">Emitido em ${new Date().toLocaleString('pt-BR')} · S2Vet</div>
  </body></html>`;

  // Renderiza em div oculta fora da viewport
  const wrapper = document.createElement('div');
  Object.assign(wrapper.style, {
    position: 'fixed', top: '-9999px', left: '-9999px',
    width: '794px', background: '#fff',
  });
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);

  try {
    const canvas = await html2canvas(wrapper, { scale: 1.5, useCORS: true, logging: false });
    const imgData = canvas.toDataURL('image/jpeg', 0.92);

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const ratio  = canvas.height / canvas.width;
    const imgH   = pageW * ratio;

    let y = 0;
    while (y < imgH) {
      if (y > 0) pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, -y, pageW, imgH);
      y += pageH;
    }

    return pdf.output('blob');
  } finally {
    document.body.removeChild(wrapper);
  }
}

export async function compartilharFatura(fatura: FaturaMin, animais: AnimalMin[], logoUrl?: string | null) {
  const inv      = `INV-${String(fatura.id).padStart(3, '0')}`;
  const nome     = fatura.proprietario?.fullName?.replace(/\s+/g, '-') ?? 'cliente';
  const fileName = `fatura-${inv}-${nome}.pdf`;

  const blob = await gerarPdfBlob(fatura, animais, logoUrl);
  const file = new File([blob], fileName, { type: 'application/pdf' });

  // Web Share API com arquivo (funciona no celular — WhatsApp aparece como opção)
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: `Fatura ${inv}` });
    return;
  }

  // Fallback desktop: faz download do PDF
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href    = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}