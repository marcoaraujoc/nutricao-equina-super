// frontend/src/utils/ExamePrint.ts

export interface LaudoCompra {
  gerais:    Record<string, string>;
  sistemas:  Record<string, string>;
  neuro:     Record<string, string>;
  locomocao: Record<string, string>;
  flexao:    Record<string, string>;
  obs:       string;
}

export interface GrupoExame {
  // campos para roteamento de página na impressão
  tipo?:           string | null;       // 'Laboratorial' | 'Imagem' | 'Compra'
  laboratorio?:    string | null;
  dataHoraColeta?: string | null;
  laudoCompra?:    LaudoCompra | null;
  // conteúdo do grupo
  nome:             string | null;      // área / categoria (ex: "Hematologia")
  exames:           string[];
  tipoAmostra:      string | null;
  qtdAmostra:       number | null;
  indicacaoClinica: string | null;
  obs:              string | null;
}

export interface ExtraInfoExame {
  laboratorio:      string | null;
  dataHoraColeta:   string | null;
  tipoAmostra:      string | null;
  indicacaoClinica: string | null;
  obs:              string | null;
  grupoNome?:       string | null;
  laudoCompra?:     LaudoCompra | null;
  grupos?:          GrupoExame[] | null;
}

export interface PrintExameClinico {
  id:              number;
  tipo:            string;
  descricao:       string;
  status:          string;
  observacao:      string | null;
  qtdAmostra:      number | null;
  dataSolicitacao: string;
  veterinario:     { id: number; fullName: string } | null;
}

export interface PrintAnimalExame {
  nome:       string;
  photoUrl?:  unknown;
  raca?:      { nome: string } | null;
  user?:      { fullName: string; email: string } | null;
  idadeAnos?: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const s = iso.split('T')[0];
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

function parseExtra(obs: string | null): ExtraInfoExame {
  if (!obs) return { laboratorio: null, dataHoraColeta: null, tipoAmostra: null, indicacaoClinica: null, obs: null };
  try { return JSON.parse(obs) as ExtraInfoExame; }
  catch { return { laboratorio: null, dataHoraColeta: null, tipoAmostra: null, indicacaoClinica: null, obs }; }
}

const TIPO_BADGE: Record<string, { color: string; bg: string }> = {
  Laboratorial: { color: '#1d4ed8', bg: '#dbeafe' },
  'Bioquímico': { color: '#7c3aed', bg: '#ede9fe' },
  Imagem:       { color: '#065f46', bg: '#d1fae5' },
  Compra:       { color: '#92400e', bg: '#fef3c7' },
};

// ─── CSS compartilhado ────────────────────────────────────────────────────────

const CSS = `
  @page { size: A4; margin: 16mm 20mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #111; background: #fff; }
  .exam-page { }
  .page-break { page-break-before: always; break-before: page; }
  .header { border-bottom: 2px solid #1d4ed8; padding-bottom: 10px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: flex-end; }
  .header h1 { font-size: 20px; font-weight: 700; color: #1d4ed8; }
  .header .sub { font-size: 10px; color: #6b7280; margin-top: 2px; }
  .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; margin-bottom: 12px; }
  .card-title { font-size: 10px; font-weight: 700; color: #374151; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 10px; border-bottom: 1px solid #f3f4f6; padding-bottom: 6px; }
  .card-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 16px; }
  .lbl { display: block; font-size: 9px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 2px; }
  .val { font-size: 11px; font-weight: 600; color: #111; }
  .section-title { font-size: 10px; font-weight: 700; color: #374151; text-transform: uppercase; letter-spacing: 0.05em; margin: 14px 0 8px; }
  .footer { border-top: 1px solid #e5e7eb; padding-top: 8px; margin-top: 20px; display: flex; justify-content: space-between; color: #9ca3af; font-size: 9px; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;

// ─── Render helpers ───────────────────────────────────────────────────────────

function renderAchadoTable(titulo: string, dados: Record<string, string>, primeiroValor: string): string {
  const rows = Object.entries(dados).map(([label, valor]) => {
    const isNormal = valor === primeiroValor;
    const bg    = isNormal ? '' : 'background:#fefce8;';
    const color = isNormal ? '#374151' : '#92400e';
    const bold  = isNormal ? '' : 'font-weight:700;';
    return `<tr>
      <td style="padding:5px 10px;border:1px solid #e5e7eb;font-size:10px;color:#374151;">${esc(label)}</td>
      <td style="padding:5px 10px;border:1px solid #e5e7eb;font-size:10px;${bg}color:${color};${bold}">${esc(valor)}</td>
    </tr>`;
  }).join('');
  return `<div style="margin-bottom:12px;">
    <p style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin-bottom:4px;">${esc(titulo)}</p>
    <table style="width:100%;border-collapse:collapse;"><tbody>${rows}</tbody></table>
  </div>`;
}

function renderFlexaoTable(dados: Record<string, string>): string {
  const OPTIONS = ['Não sensível (-)', 'Sensível (+)', 'Muito Sensível (++)'];
  const rows = Object.entries(dados).map(([label, valor]) => {
    const idx   = OPTIONS.indexOf(valor);
    const bg    = idx === 0 ? '' : idx === 1 ? 'background:#fefce8;' : 'background:#fee2e2;';
    const color = idx === 0 ? '#374151' : idx === 1 ? '#92400e' : '#991b1b';
    const bold  = idx === 0 ? '' : 'font-weight:700;';
    return `<tr>
      <td style="padding:5px 10px;border:1px solid #e5e7eb;font-size:10px;color:#374151;">${esc(label)}</td>
      <td style="padding:5px 10px;border:1px solid #e5e7eb;font-size:10px;${bg}color:${color};${bold}">${esc(valor)}</td>
    </tr>`;
  }).join('');
  return `<div style="margin-bottom:12px;">
    <p style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin-bottom:4px;">Testes de Flexão</p>
    <table style="width:100%;border-collapse:collapse;"><tbody>${rows}</tbody></table>
  </div>`;
}

function formField(label: string, content: string | null | undefined, lines = 1): string {
  const lineH = 22;
  if (content) {
    return `<div style="margin-bottom:12px;">
      <p style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin-bottom:4px;">${esc(label)}</p>
      <p style="font-size:11px;color:#111;padding:4px 0;border-bottom:1px solid #d1d5db;">${esc(content)}</p>
    </div>`;
  }
  const blanks = Array.from({ length: lines }, () =>
    `<div style="height:${lineH}px;border-bottom:1px solid #d1d5db;margin-bottom:${lines > 1 ? '2px' : '0'};"></div>`
  ).join('');
  return `<div style="margin-bottom:12px;">
    <p style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin-bottom:4px;">${esc(label)}</p>
    ${blanks}
  </div>`;
}

// ─── Agrupador: separa grupos por (tipo + laboratório) para paginação ─────────

interface PaginaGrupo {
  tipo:       string;
  laboratorio: string | null;
  grupos:     GrupoExame[];
}

function agruparParaPaginas(grupos: GrupoExame[], tipoBase: string): PaginaGrupo[] {
  const map = new Map<string, PaginaGrupo>();
  for (const g of grupos) {
    const tipo = g.tipo || tipoBase;
    const lab  = g.laboratorio ?? null;
    const key  = `${tipo}::${lab ?? ''}`;
    if (!map.has(key)) map.set(key, { tipo, laboratorio: lab, grupos: [] });
    map.get(key)!.grupos.push(g);
  }
  return Array.from(map.values());
}

// ─── Gerador de conteúdo de uma página ───────────────────────────────────────
//
// Aceita override de tipo/extra para o caso multi-página onde cada página
// representa um laboratório ou tipo distinto dentro do mesmo registro.

interface PaginaOpts {
  tipo?:             string;
  laboratorio?:      string | null;
  dataHoraColeta?:   string | null;
  tipoAmostra?:      string | null;
  qtdAmostra?:       number | null;
  indicacaoClinica?: string | null;
  obs?:              string | null;
  gruposPage?:       GrupoExame[];  // grupos que pertencem a esta página
}

function gerarPaginaExame(
  ex:      PrintExameClinico,
  animal?: PrintAnimalExame | null,
  opts?:   PaginaOpts,
): string {
  const extra      = parseExtra(ex.observacao);
  const tipo       = opts?.tipo ?? ex.tipo;
  const badge      = TIPO_BADGE[tipo] ?? { color: '#374151', bg: '#f3f4f6' };
  const isCompra   = tipo === 'Compra';

  // Valores resolvidos (opts sobrescrevem extra)
  const laboratorio      = opts !== undefined && 'laboratorio'      in opts ? opts.laboratorio      : extra.laboratorio;
  const dataHoraColeta   = opts !== undefined && 'dataHoraColeta'   in opts ? opts.dataHoraColeta   : extra.dataHoraColeta;
  const tipoAmostra      = opts !== undefined && 'tipoAmostra'      in opts ? opts.tipoAmostra      : extra.tipoAmostra;
  const qtdAmostra       = opts !== undefined && 'qtdAmostra'       in opts ? opts.qtdAmostra       : ex.qtdAmostra;
  const indicacaoClinica = opts !== undefined && 'indicacaoClinica' in opts ? opts.indicacaoClinica : extra.indicacaoClinica;
  const obsGeral         = opts !== undefined && 'obs'              in opts ? opts.obs              : extra.obs;

  // Grupos desta página (opts ou todos do extra)
  const gruposPage = opts?.gruposPage ?? extra.grupos ?? null;
  const laudo      = extra.laudoCompra ?? null;

  // ── Bloco animal ──────────────────────────────────────────────────────────
  const animalBlock = animal ? `
    <div class="card">
      <div class="card-title">Animal</div>
      <div style="display:flex;align-items:flex-start;gap:14px;">
        ${typeof animal.photoUrl === 'string' && animal.photoUrl
          ? `<img src="${esc(animal.photoUrl)}" alt="${esc(animal.nome)}" style="width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid #e5e7eb;flex-shrink:0;" />`
          : ''}
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px 16px;flex:1;">
          <div><span class="lbl">Nome</span><span class="val">${esc(animal.nome)}</span></div>
          ${animal.raca      ? `<div><span class="lbl">Raça</span><span class="val">${esc(animal.raca.nome)}</span></div>` : ''}
          ${animal.idadeAnos != null ? `<div><span class="lbl">Idade</span><span class="val">${animal.idadeAnos} ano${animal.idadeAnos !== 1 ? 's' : ''}</span></div>` : ''}
          ${animal.user      ? `<div><span class="lbl">Proprietário</span><span class="val">${esc(animal.user.fullName)}</span></div>` : ''}
        </div>
      </div>
    </div>` : '';

  // ── Info card ─────────────────────────────────────────────────────────────
  const infoRows = [
    laboratorio    ? `<div><span class="lbl">Laboratório / Local</span><span class="val">${esc(laboratorio)}</span></div>` : '',
    dataHoraColeta ? `<div><span class="lbl">Data/Hora da Coleta</span><span class="val">${fmt(dataHoraColeta)}</span></div>` : '',
    tipoAmostra    ? `<div><span class="lbl">Tipo de Amostra</span><span class="val">${esc(tipoAmostra!)}</span></div>` : '',
    qtdAmostra != null ? `<div><span class="lbl">Qtd. de Amostras</span><span class="val">${qtdAmostra} amostra${qtdAmostra !== 1 ? 's' : ''}</span></div>` : '',
  ].filter(Boolean).join('');

  // ── Lista de exames ───────────────────────────────────────────────────────
  const examListBlock = (() => {
    if (isCompra) return '';

    // Grupos desta página
    if (gruposPage && gruposPage.length > 0) {
      const totalExames = gruposPage.reduce((s, g) => s + g.exames.length, 0);
      return `
        <div style="margin-top:14px;">
          <p class="section-title">Exames Solicitados (${totalExames})</p>
          ${gruposPage.map(grp => {
            if (grp.exames.length === 0) return '';
            return `
              <div style="margin-bottom:14px;">
                ${grp.nome
                  ? `<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;padding:5px 10px;background:#eff6ff;border-left:3px solid #1d4ed8;border-radius:0 6px 6px 0;">
                       <span style="font-size:11px;font-weight:700;color:#1d4ed8;flex:1;">${esc(grp.nome)}</span>
                       ${grp.tipoAmostra
                         ? `<span style="font-size:9px;color:#6b7280;">Amostra: ${esc(grp.tipoAmostra)}${grp.qtdAmostra ? ` · ${grp.qtdAmostra} unid.` : ''}</span>`
                         : ''}
                     </div>`
                  : ''
                }
                <table style="width:100%;border-collapse:collapse;">
                  <tbody>
                    ${grp.exames.map((e, i) => `
                      <tr style="${i % 2 === 1 ? 'background:#fafafa;' : ''}">
                        <td style="padding:5px 10px;border:1px solid #e5e7eb;font-size:10px;color:#9ca3af;width:28px;">${i + 1}</td>
                        <td style="padding:5px 10px;border:1px solid #e5e7eb;font-size:11px;font-weight:500;color:#111;">${esc(e)}</td>
                      </tr>`).join('')}
                  </tbody>
                </table>
                ${grp.indicacaoClinica ? `<p style="font-size:10px;color:#6b7280;margin-top:4px;padding-left:2px;">Indicação: ${esc(grp.indicacaoClinica)}</p>` : ''}
                ${grp.obs ? `<p style="font-size:10px;color:#6b7280;margin-top:2px;padding-left:2px;">Obs.: ${esc(grp.obs)}</p>` : ''}
              </div>`;
          }).join('')}
        </div>`;
    }

    // Fallback: exame simples (sem grupos)
    const examList = ex.descricao.split(', ').filter(Boolean);
    if (examList.length === 0) return '';
    return `
      <div style="margin-top:14px;">
        ${extra.grupoNome
          ? `<p style="font-size:13px;font-weight:700;color:#111;margin-bottom:4px;">${esc(extra.grupoNome)}</p>
             <p class="section-title" style="margin-top:0;">Exames Solicitados (${examList.length})</p>`
          : `<p class="section-title">Exames Solicitados (${examList.length})</p>`
        }
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left;font-size:9px;font-weight:700;color:#6b7280;text-transform:uppercase;">#</th>
              <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left;font-size:9px;font-weight:700;color:#6b7280;text-transform:uppercase;">Procedimento</th>
            </tr>
          </thead>
          <tbody>
            ${examList.map((e, i) => `
              <tr style="${i % 2 === 1 ? 'background:#fafafa;' : ''}">
                <td style="padding:6px 10px;border:1px solid #e5e7eb;font-size:10px;color:#9ca3af;width:32px;">${i + 1}</td>
                <td style="padding:6px 10px;border:1px solid #e5e7eb;font-size:11px;font-weight:500;color:#111;">${esc(e)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  })();

  // ── Campos de formulário ──────────────────────────────────────────────────
  const camposFormBlock = !isCompra ? `
    <div style="margin-top:16px;">
      ${formField('Indicação / Suspeita Clínica', indicacaoClinica, 2)}
      ${formField('Instruções de Preparo / Observações', obsGeral, 2)}
    </div>` : '';

  // ── Laudo de compra ───────────────────────────────────────────────────────
  const laudoParaRender = opts?.gruposPage
    ? opts.gruposPage.find(g => g.laudoCompra)?.laudoCompra ?? null
    : laudo;

  const laudoBlock = isCompra && laudoParaRender ? `
    <div style="margin-top:14px;">
      <p class="section-title">Laudo de Exame de Compra Equino</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          ${renderAchadoTable('Clínico Geral',  laudoParaRender.gerais,    Object.values(laudoParaRender.gerais)[0] ?? 'Boa')}
          ${renderAchadoTable('Sistemas',        laudoParaRender.sistemas,  Object.values(laudoParaRender.sistemas)[0] ?? 'Normal')}
        </div>
        <div>
          ${renderAchadoTable('Neuromuscular / Locomotor', laudoParaRender.neuro,     Object.values(laudoParaRender.neuro)[0] ?? 'Normal')}
          ${renderAchadoTable('Locomoção Dinâmica',        laudoParaRender.locomocao, Object.values(laudoParaRender.locomocao)[0] ?? 'Normal')}
        </div>
      </div>
      ${renderFlexaoTable(laudoParaRender.flexao)}
      ${laudoParaRender.obs ? `
        <div style="margin-top:8px;padding:10px 14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;">
          <p style="font-size:9px;font-weight:700;color:#6b7280;text-transform:uppercase;margin-bottom:4px;">Observações / Parecer Final</p>
          <p style="font-size:11px;color:#111;white-space:pre-line;">${esc(laudoParaRender.obs)}</p>
        </div>` : ''}
    </div>` : '';

  // ── Assinatura ────────────────────────────────────────────────────────────
  const signaturaBlock = ex.veterinario ? `
    <div style="margin-top:40px;display:flex;justify-content:flex-end;">
      <div style="text-align:center;width:220px;">
        <div style="border-top:1px solid #374151;padding-top:6px;font-size:10px;font-weight:600;color:#374151;">${esc(ex.veterinario.fullName)}</div>
        <div style="font-size:9px;color:#9ca3af;margin-top:2px;">Médico Veterinário Responsável</div>
      </div>
    </div>` : '';

  return `
  <div class="header">
    <div>
      <h1>S2Vet</h1>
      <p class="sub">Sistema Hospitalar Veterinário · Módulo Clínico</p>
      <p class="sub" style="margin-top:4px;">Emitido em: ${new Date().toLocaleString('pt-BR')}</p>
    </div>
    <div style="text-align:right;">
      <p style="font-size:10px;color:#9ca3af;margin-bottom:4px;">REQUISIÇÃO DE EXAME</p>
      <span style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;color:${badge.color};background:${badge.bg};">${esc(tipo)}</span>
    </div>
  </div>

  ${animalBlock}

  <div class="card">
    <div class="card-title">Informações do Exame</div>
    <div class="card-grid">
      <div><span class="lbl">Data da Solicitação</span><span class="val">${fmtDate(ex.dataSolicitacao)}</span></div>
      ${ex.veterinario ? `<div><span class="lbl">Solicitado por</span><span class="val">${esc(ex.veterinario.fullName)}</span></div>` : ''}
      <div><span class="lbl">Status</span><span class="val">${esc(ex.status)}</span></div>
      ${infoRows}
    </div>
  </div>

  ${examListBlock}
  ${camposFormBlock}
  ${laudoBlock}
  ${signaturaBlock}

  <div class="footer">
    <span>S2Vet · Sistema Hospitalar Veterinário</span>
    <span>Emitido em ${new Date().toLocaleString('pt-BR')}</span>
  </div>`;
}

// ─── Gerador HTML principal ───────────────────────────────────────────────────
//
// Se o registro tem grupos com laboratórios ou tipos distintos, gera uma página
// por (tipo + laboratório). Caso contrário, gera uma única página.

export function gerarHtmlExame(ex: PrintExameClinico, animal?: PrintAnimalExame | null): string {
  const extra  = parseExtra(ex.observacao);
  const grupos = extra.grupos;

  let bodyContent: string;

  if (grupos && grupos.length > 0) {
    const paginas = agruparParaPaginas(grupos, ex.tipo);

    if (paginas.length > 1) {
      // Multi-página: uma por (tipo + laboratório)
      bodyContent = paginas.map((pg, i) => {
        const dataColeta    = pg.grupos.find(g => g.dataHoraColeta)?.dataHoraColeta ?? null;
        const tipoAmostra   = pg.grupos.length === 1 ? pg.grupos[0].tipoAmostra : null;
        const qtdTotal      = pg.grupos.reduce((s, g) => g.qtdAmostra != null ? (s ?? 0) + g.qtdAmostra : s, null as number | null);
        const indicacao     = pg.grupos.map(g => g.indicacaoClinica).filter(Boolean).join('; ') || null;
        const obsLocal      = pg.grupos.map(g => g.obs).filter(Boolean).join('\n') || null;

        const opts: PaginaOpts = {
          tipo: pg.tipo, laboratorio: pg.laboratorio,
          dataHoraColeta: dataColeta, tipoAmostra, qtdAmostra: qtdTotal,
          indicacaoClinica: indicacao, obs: obsLocal,
          gruposPage: pg.grupos,
        };
        return `<div class="exam-page${i > 0 ? ' page-break' : ''}">${gerarPaginaExame(ex, animal, opts)}</div>`;
      }).join('\n');
    } else {
      // Página única com grupos (mesmo lab/tipo)
      const pg = paginas[0];
      const dataColeta  = pg.grupos.find(g => g.dataHoraColeta)?.dataHoraColeta ?? null;
      const tipoAmostra = pg.grupos.length === 1 ? pg.grupos[0].tipoAmostra : null;
      const qtdTotal    = pg.grupos.reduce((s, g) => g.qtdAmostra != null ? (s ?? 0) + g.qtdAmostra : s, null as number | null);
      const indicacao   = pg.grupos.map(g => g.indicacaoClinica).filter(Boolean).join('; ') || null;
      const obsLocal    = pg.grupos.map(g => g.obs).filter(Boolean).join('\n') || null;

      const opts: PaginaOpts = {
        tipo: pg.tipo, laboratorio: pg.laboratorio,
        dataHoraColeta: dataColeta, tipoAmostra, qtdAmostra: qtdTotal,
        indicacaoClinica: indicacao, obs: obsLocal,
        gruposPage: pg.grupos,
      };
      bodyContent = `<div class="exam-page">${gerarPaginaExame(ex, animal, opts)}</div>`;
    }
  } else {
    // Registro simples sem grupos
    bodyContent = `<div class="exam-page">${gerarPaginaExame(ex, animal)}</div>`;
  }

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Requisição de Exame — S2Vet</title>
  <style>${CSS}</style>
</head>
<body>
${bodyContent}
</body>
</html>`;
}

// ─── Função principal ─────────────────────────────────────────────────────────

export function imprimirExame(ex: PrintExameClinico, animal?: PrintAnimalExame | null): void {
  const iframe = document.createElement('iframe');
  Object.assign(iframe.style, {
    position: 'fixed', top: '-9999px', left: '-9999px',
    width: '0', height: '0', border: 'none',
  });
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
  if (!doc) { document.body.removeChild(iframe); return; }

  doc.open();
  doc.write(gerarHtmlExame(ex, animal));
  doc.close();

  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => {
      if (document.body.contains(iframe)) document.body.removeChild(iframe);
    }, 500);
  }, 250);
}
