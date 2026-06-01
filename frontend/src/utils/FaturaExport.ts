// frontend/src/utils/FaturaExport.ts
// Utilitários de exportação: PDF (print), CSV e Share para o módulo financeiro

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
interface ItemMin   { animalId?: number | null; tipo: string; descricao: string; valor: number; quantidade: number }
interface FaturaMin {
  id: number; total: number; status: string; mesReferencia?: string | null;
  itens: ItemMin[];
  proprietario?: { fullName: string; email: string; phone?: string | null } | null;
}

// ─── PDF / Impressão ─────────────────────────────────────────────────────────

export function imprimirFatura(fatura: FaturaMin, animais: AnimalMin[]) {
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
    const subtotal = g.itens.reduce((s, i) => s + i.valor * i.quantidade, 0);
    const linhasItens = g.itens.map(i => `
      <tr>
        <td><span class="badge ${i.tipo.toLowerCase()}">${i.tipo}</span></td>
        <td>${i.descricao}</td>
        <td class="center">${i.quantidade}</td>
        <td class="right">${brl(i.valor)}</td>
        <td class="right">${brl(i.valor * i.quantidade)}</td>
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

    .header { background: #166534; color: #fff; padding: 18px 24px; border-radius: 8px; margin-bottom: 20px; }
    .header h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
    .header .sub { font-size: 11px; opacity: .8; }
    .header .meta { margin-top: 10px; font-size: 11px; opacity: .75; display: flex; gap: 24px; flex-wrap: wrap; }

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
    <h1>${fatura.proprietario?.fullName ?? 'Cliente'}</h1>
    <div class="sub">Fatura Ref: INV-${String(fatura.id).padStart(3,'0')} · ${formatMes(fatura.mesReferencia)}</div>
    <div class="meta">
      ${fatura.proprietario?.phone ? `<span>Fone: ${fatura.proprietario.phone}</span>` : ''}
      ${fatura.proprietario?.email ? `<span>Email: ${fatura.proprietario.email}</span>` : ''}
      <span>Status: <span class="status-badge status-${fatura.status}">${fatura.status}</span></span>
    </div>
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
    ['Animal', 'Tipo', 'Descrição', 'Quantidade', 'Valor Unitário (R$)', 'Subtotal (R$)'],
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
      (item.valor * item.quantidade).toFixed(2).replace('.', ','),
    ]);
  }

  linhas.push(['']);
  linhas.push(['', '', '', '', 'TOTAL', fatura.total.toFixed(2).replace('.', ',')]);

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

// ─── Share ────────────────────────────────────────────────────────────────────

export async function compartilharFatura(fatura: FaturaMin): Promise<'shared' | 'copied'> {
  const title = `Fatura INV-${String(fatura.id).padStart(3,'0')} — ${fatura.proprietario?.fullName ?? 'Cliente'}`;
  const text  = [
    title,
    `Mês: ${formatMes(fatura.mesReferencia)}`,
    `Status: ${fatura.status}`,
    `Total: ${brl(fatura.total)}`,
    fatura.proprietario?.email ? `Email: ${fatura.proprietario.email}` : '',
  ].filter(Boolean).join('\n');

  if (navigator.share) {
    await navigator.share({ title, text });
    return 'shared';
  }

  await navigator.clipboard.writeText(text);
  return 'copied';
}