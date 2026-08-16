// frontend/src/utils/ResultadoExamePrint.ts
//
// Impressão e compartilhamento do RESULTADO do exame clínico (laudo/tabela/imagens),
// dentro do card "Resultados do Exame" (/exames/:animalId?tipo=laboratorial|imagem).
// Distinto de utils/ExamePrint.ts, que imprime a REQUISIÇÃO (Pedido de Exames) — aqui
// o conteúdo é o que voltou do laboratório, não o que foi pedido.

import { resolverUrlAbsoluta } from './printUrl';

export interface ResultadoItemPrint {
  parametro:  string;
  valor:      string | null;
  unidade:    string | null;
  referencia: string | null;
}

export interface ImagemPrint {
  nome:       string | null;
  arquivoUrl: string;
}

export interface ExameParaPrint {
  id:              number;
  numero:          number | null;
  tipo:            string;
  descricao:       string;
  status:          string;
  dataSolicitacao: string;
  dataResultado:   string | null;
  resultado:       string | null;
  laboratorio?:    string | null;
  resultadoItens:  ResultadoItemPrint[];
  imagens:         ImagemPrint[];
  veterinario:     { fullName: string } | null;
}

export interface AnimalParaPrint {
  nome:     string;
  raca?:    { nome: string } | null;
  user?:    { fullName: string } | null;
  logoUrl?: string | null;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtData(iso: string | null): string {
  if (!iso) return '—';
  const s = iso.split('T')[0];
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

export function numeroExamePrint(ex: { numero: number | null; id: number }): string {
  return ex.numero != null ? `EX-${String(ex.numero).padStart(4, '0')}` : `#${ex.id}`;
}

// ─── Impressão ──────────────────────────────────────────────────────────────

function gerarHtmlResultado(ex: ExameParaPrint, animal?: AnimalParaPrint | null): string {
  const logoUrl = resolverUrlAbsoluta(animal?.logoUrl);

  const tabela = ex.resultadoItens.length > 0 ? `
    <table style="width:100%;border-collapse:collapse;margin-top:10px;">
      <thead>
        <tr style="background:#f9fafb;">
          <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left;font-size:9px;font-weight:700;color:#6b7280;text-transform:uppercase;">Parâmetro</th>
          <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left;font-size:9px;font-weight:700;color:#6b7280;text-transform:uppercase;">Valor</th>
          <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left;font-size:9px;font-weight:700;color:#6b7280;text-transform:uppercase;">Unidade</th>
          <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left;font-size:9px;font-weight:700;color:#6b7280;text-transform:uppercase;">Referência</th>
        </tr>
      </thead>
      <tbody>
        ${ex.resultadoItens.map((it, i) => `
          <tr style="${i % 2 === 1 ? 'background:#fafafa;' : ''}">
            <td style="padding:6px 10px;border:1px solid #e5e7eb;font-size:10px;color:#111;">${esc(it.parametro)}</td>
            <td style="padding:6px 10px;border:1px solid #e5e7eb;font-size:10px;font-weight:600;color:#111;">${esc(it.valor ?? '—')}</td>
            <td style="padding:6px 10px;border:1px solid #e5e7eb;font-size:10px;color:#6b7280;">${esc(it.unidade ?? '—')}</td>
            <td style="padding:6px 10px;border:1px solid #e5e7eb;font-size:10px;color:#6b7280;">${esc(it.referencia ?? '—')}</td>
          </tr>`).join('')}
      </tbody>
    </table>` : '';

  const laudo = ex.resultado ? `
    <div style="margin-top:14px;padding:12px 16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">
      <p style="font-size:9px;font-weight:700;color:#6b7280;text-transform:uppercase;margin-bottom:6px;">Laudo</p>
      <p style="font-size:11px;color:#111;white-space:pre-line;">${esc(ex.resultado)}</p>
    </div>` : '';

  const imagens = ex.imagens.length > 0 ? `
    <div style="margin-top:14px;">
      <p style="font-size:9px;font-weight:700;color:#6b7280;text-transform:uppercase;margin-bottom:6px;">Imagens (${ex.imagens.length})</p>
      <div style="display:flex;flex-wrap:wrap;gap:8px;">
        ${ex.imagens.map(img => `
          <img src="${esc(resolverUrlAbsoluta(img.arquivoUrl) ?? img.arquivoUrl)}" alt="${esc(img.nome ?? 'Imagem')}"
            style="width:140px;height:140px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb;" />`).join('')}
      </div>
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Resultado de Exame — S2Vet</title>
<style>
  @page { size: A4; margin: 16mm 20mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #111; background: #fff; }
  .header { border-bottom: 2px solid #1d4ed8; padding-bottom: 10px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: flex-end; }
  .header h1 { font-size: 20px; font-weight: 700; color: #1d4ed8; }
  .brand-logo { max-height: 32px; max-width: 200px; object-fit: contain; }
  .header .sub { font-size: 10px; color: #6b7280; margin-top: 2px; }
  .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; margin-bottom: 12px; }
  .card-title { font-size: 10px; font-weight: 700; color: #374151; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 10px; border-bottom: 1px solid #f3f4f6; padding-bottom: 6px; }
  .card-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 16px; }
  .lbl { display: block; font-size: 9px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 2px; }
  .val { font-size: 11px; font-weight: 600; color: #111; }
  .footer { border-top: 1px solid #e5e7eb; padding-top: 8px; margin-top: 20px; display: flex; justify-content: space-between; color: #9ca3af; font-size: 9px; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
  <div class="header">
    <div>
      ${logoUrl ? `<img class="brand-logo" src="${logoUrl}" alt="Logo">` : `<h1>S2Vet</h1>`}
      <p class="sub">Sistema Hospitalar Veterinário · Módulo Clínico</p>
      <p class="sub" style="margin-top:4px;">Emitido em: ${new Date().toLocaleString('pt-BR')}</p>
    </div>
    <div style="text-align:right;">
      <p style="font-size:10px;color:#9ca3af;margin-bottom:4px;">RESULTADO DE EXAME</p>
      <span style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;color:#065f46;background:#d1fae5;">${esc(ex.tipo)}</span>
    </div>
  </div>

  ${animal ? `
  <div class="card">
    <div class="card-title">Animal</div>
    <div class="card-grid">
      <div><span class="lbl">Nome</span><span class="val">${esc(animal.nome)}</span></div>
      ${animal.raca ? `<div><span class="lbl">Raça</span><span class="val">${esc(animal.raca.nome)}</span></div>` : ''}
      ${animal.user ? `<div><span class="lbl">Proprietário</span><span class="val">${esc(animal.user.fullName)}</span></div>` : ''}
    </div>
  </div>` : ''}

  <div class="card">
    <div class="card-title">Informações do Exame</div>
    <div class="card-grid">
      <div><span class="lbl">Nº</span><span class="val">${esc(numeroExamePrint(ex))}</span></div>
      <div><span class="lbl">Exame</span><span class="val">${esc(ex.descricao)}</span></div>
      <div><span class="lbl">Data da Solicitação</span><span class="val">${fmtData(ex.dataSolicitacao)}</span></div>
      <div><span class="lbl">Data do Resultado</span><span class="val">${fmtData(ex.dataResultado)}</span></div>
      ${ex.laboratorio ? `<div><span class="lbl">Laboratório</span><span class="val">${esc(ex.laboratorio)}</span></div>` : ''}
      ${ex.veterinario ? `<div><span class="lbl">Solicitado por</span><span class="val">${esc(ex.veterinario.fullName)}</span></div>` : ''}
    </div>
  </div>

  ${tabela}
  ${laudo}
  ${imagens}

  <div class="footer">
    <span>S2Vet · Sistema Hospitalar Veterinário</span>
    <span>Emitido em ${new Date().toLocaleString('pt-BR')}</span>
  </div>
</body>
</html>`;
}

export function imprimirResultadoExame(ex: ExameParaPrint, animal?: AnimalParaPrint | null): void {
  const iframe = document.createElement('iframe');
  Object.assign(iframe.style, { position: 'fixed', top: '-9999px', left: '-9999px', width: '0', height: '0', border: 'none' });
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
  if (!doc) { document.body.removeChild(iframe); return; }

  doc.open();
  doc.write(gerarHtmlResultado(ex, animal));
  doc.close();

  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => { if (document.body.contains(iframe)) document.body.removeChild(iframe); }, 500);
  }, 250);
}

// ─── Compartilhamento (texto) ───────────────────────────────────────────────

export function textoResultadoExame(ex: ExameParaPrint): string {
  const linhas = [
    `*Resultado de Exame — ${ex.tipo}*`,
    `Exame: ${ex.descricao}`,
    `Nº: ${numeroExamePrint(ex)}`,
    `Data do resultado: ${fmtData(ex.dataResultado)}`,
    ex.laboratorio ? `Laboratório: ${ex.laboratorio}` : '',
  ].filter(Boolean);

  if (ex.resultadoItens.length > 0) {
    linhas.push('', '*Parâmetros:*');
    ex.resultadoItens.forEach(it => {
      const partes = [it.valor, it.unidade].filter(Boolean).join(' ');
      const ref = it.referencia ? ` (ref: ${it.referencia})` : '';
      linhas.push(`• ${it.parametro}: ${partes || '—'}${ref}`);
    });
  }

  if (ex.resultado) linhas.push('', '*Laudo:*', ex.resultado);
  if (ex.imagens.length > 0) linhas.push('', `📎 ${ex.imagens.length} imagem${ex.imagens.length !== 1 ? 'ns' : ''} anexada${ex.imagens.length !== 1 ? 's' : ''} — disponíveis no sistema.`);

  return linhas.join('\n');
}
