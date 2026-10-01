// frontend/src/utils/ResultadoExamePrint.ts
//
// Impressão e compartilhamento do RESULTADO do exame clínico (laudo/tabela/imagens),
// dentro do card "Resultados do Exame" (/exames/:animalId?tipo=laboratorial|imagem).
// Distinto de utils/ExamePrint.ts, que imprime a REQUISIÇÃO (Pedido de Exames) — aqui
// o conteúdo é o que voltou do laboratório, não o que foi pedido.

// Desde 2026-09-29 o papel é a FOLHA CLÍNICA (`print/FolhaClinica.ts`); aqui mora só
// o CORPO — dados do exame, tabela, laudo e imagens.

import { srcImpressao } from './print/PrintShell';
import { gerarHtmlFolhaClinica, prepararFolhaClinica } from './print/FolhaClinica';
import { imprimirHtml } from './print/imprimirHtml';

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
  /** `id` habilita CRMV e assinatura de quem solicitou/assina o resultado. */
  veterinario:     { id?: number | null; fullName: string } | null;
}

export interface AnimalParaPrint {
  nome:      string;
  photoUrl?: string | null;
  raca?:     { nome: string } | null;
  especie?:  { nome: string } | null;
  user?:     { fullName: string } | null;
  logoUrl?:  string | null;
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

export function gerarHtmlResultado(ex: ExameParaPrint, animal?: AnimalParaPrint | null): string {
  const tabela = ex.resultadoItens.length > 0 ? `
    <table style="width:100%;border-collapse:collapse;margin-top:10px;">
      <thead>
        <tr style="background:#f9fafb;">
          <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left;font-size:11.7px;font-weight:700;color:#6b7280;text-transform:uppercase;">Parâmetro</th>
          <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left;font-size:11.7px;font-weight:700;color:#6b7280;text-transform:uppercase;">Valor</th>
          <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left;font-size:11.7px;font-weight:700;color:#6b7280;text-transform:uppercase;">Unidade</th>
          <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left;font-size:11.7px;font-weight:700;color:#6b7280;text-transform:uppercase;">Referência</th>
        </tr>
      </thead>
      <tbody>
        ${ex.resultadoItens.map((it, i) => `
          <tr style="${i % 2 === 1 ? 'background:#fafafa;' : ''}">
            <td style="padding:6px 10px;border:1px solid #e5e7eb;font-size:13px;color:#111;">${esc(it.parametro)}</td>
            <td style="padding:6px 10px;border:1px solid #e5e7eb;font-size:13px;font-weight:600;color:#111;">${esc(it.valor ?? '—')}</td>
            <td style="padding:6px 10px;border:1px solid #e5e7eb;font-size:13px;color:#6b7280;">${esc(it.unidade ?? '—')}</td>
            <td style="padding:6px 10px;border:1px solid #e5e7eb;font-size:13px;color:#6b7280;">${esc(it.referencia ?? '—')}</td>
          </tr>`).join('')}
      </tbody>
    </table>` : '';

  const laudo = ex.resultado ? `
    <div style="margin-top:14px;padding:12px 16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">
      <p style="font-size:11.7px;font-weight:700;color:#6b7280;text-transform:uppercase;margin-bottom:6px;">Laudo</p>
      <p style="font-size:14.3px;color:#111;white-space:pre-line;">${esc(ex.resultado)}</p>
    </div>` : '';

  const imagens = ex.imagens.length > 0 ? `
    <div style="margin-top:14px;">
      <p style="font-size:11.7px;font-weight:700;color:#6b7280;text-transform:uppercase;margin-bottom:6px;">Imagens (${ex.imagens.length})</p>
      <div style="display:flex;flex-wrap:wrap;gap:8px;">
        ${ex.imagens.map(img => `
          <img src="${esc(srcImpressao(img.arquivoUrl) ?? img.arquivoUrl)}" alt="${esc(img.nome ?? 'Imagem')}"
            style="width:140px;height:140px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb;" />`).join('')}
      </div>
    </div>` : '';

  const corpo = `
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
  ${imagens}`;

  return gerarHtmlFolhaClinica({
    documento:    `Resultado de Exame ${numeroExamePrint(ex)}${animal ? ` — ${animal.nome}` : ''}`,
    logoUrl:      animal?.logoUrl,
    profissional: ex.veterinario ? { id: ex.veterinario.id, nome: ex.veterinario.fullName } : null,
    animal: animal ? {
      nome:         animal.nome,
      photoUrl:     animal.photoUrl ?? null,
      especie:      animal.especie?.nome ?? null,
      raca:         animal.raca?.nome ?? null,
      proprietario: animal.user?.fullName ?? null,
    } : null,
    paginas: [{
      titulo:    'Resultado de Exame',
      subtitulo: `${esc(ex.tipo)} · ${esc(numeroExamePrint(ex))}`,
      corpoHtml: corpo,
    }],
    cssModulo: `
      .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; margin-bottom: 12px; }
      .card-title { font-size: 12px; font-weight: 700; color: #374151; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 10px; border-bottom: 1px solid #f3f4f6; padding-bottom: 6px; }
      .card-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 16px; }
      .lbl { display: block; font-size: 10.5px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 2px; }
      .val { font-size: 13px; font-weight: 600; color: #111; }
    `,
  });
}

/** Resolve CRMV/assinatura, endereço da clínica e imagens — obrigatório antes de gerar PDF. */
export async function prepararResultadoExame(ex: ExameParaPrint, animal?: AnimalParaPrint | null): Promise<void> {
  await prepararFolhaClinica({
    profissionalId: ex.veterinario?.id ?? null,
    logoUrl:        animal?.logoUrl,
    imagens:        [animal?.photoUrl, ...ex.imagens.map(i => i.arquivoUrl)],
  });
}

export async function imprimirResultadoExame(ex: ExameParaPrint, animal?: AnimalParaPrint | null): Promise<void> {
  await prepararResultadoExame(ex, animal);
  imprimirHtml(gerarHtmlResultado(ex, animal));
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
