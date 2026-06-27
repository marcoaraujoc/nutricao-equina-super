// frontend/src/utils/ExameCompraPrint.ts
// Gerador de HTML para impressão e PDF do Exame de Compra Equino.
// Field definitions duplicadas intencionalmente para desacoplar da página.

// ─── Field definitions ────────────────────────────────────────────────────────

type FieldDef = [string, string, string, string]; // [key, label, opt1, opt2]

const F_CLINICO: FieldDef[] = [
  ['conformacao',    'Conformação / Atitude',            'Boa',    'Anormal'],
  ['nutricional',    'Estado Nutricional',               'Normal', 'Anormal'],
  ['pele',           'Pele/Pêlos',                       'Normal', 'Anormal'],
  ['mucosas',        'Mucosas',                          'Normal', 'Anormal'],
  ['olhos_aparencia','Olhos – Aparência externa (Dto)',  'Normal', 'Anormal'],
  ['olhos_reflexos', 'Olhos – Reflexos',                 'Normal', 'Anormal'],
  ['linfonodos',     'Linfonodos',                       'Normal', 'Anormal'],
  ['vicios',         'Vícios',                           'Ausente','Presente'],
  ['cicatrizes',     'Cicatrizes (cirúrgica ou não)',    'Ausente','Presente'],
];
const F_CARDIO: FieldDef[]  = [['auscultacao','Auscultação Cardíaca','Normal','Anormal']];
const F_RESP: FieldDef[] = [
  ['padrao',   'Padrão respiratório',                   'Normal', 'Anormal'],
  ['repouso',  'Respiração em repouso',                 'Normal', 'Anormal'],
  ['exercicio','Respiração após exercício',             'Normal', 'Anormal'],
  ['ruido',    'Ruído respiratório durante o trabalho', 'Ausente','Presente'],
];
const F_DIGEST: FieldDef[] = [
  ['boca',      'Boca / Dentes',                    'Normal', 'Anormal'],
  ['abre_boca', 'Exame realizado c/ "abre boca"?',  'Não',    'Sim'],
];
const F_UROGEN: FieldDef[] = [
  ['externo',    'Exame externo',         'Normal', 'Anormal'],
  ['testiculos', 'Testículos / Prepúcio', 'Normal', 'Anormal'],
  ['vulva',      'Vulva / Úbere',         'Normal', 'Anormal'],
];
const F_NERVOSO: FieldDef[] = [
  ['tail_tone',  'Teste "Tail tone"', 'Normal', 'Anormal'],
  ['spin_left',  'Teste "Spin left"', 'Normal', 'Anormal'],
  ['spin_right', 'Teste "Spin right"','Normal', 'Anormal'],
  ['recuo',      'Recuo',             'Normal', 'Anormal'],
  ['coordenacao','Coordenação',       'Normal', 'Anormal'],
];
const F_INSPECAO: FieldDef[] = [
  ['atrofia', 'Atrofia muscular',          'Ausente','Presente'],
  ['cabeca',  'Cabeça',                    'Normal', 'Anormal'],
  ['pescoco', 'Pescoço',                   'Normal', 'Anormal'],
  ['cernelha','Cernelha',                  'Normal', 'Anormal'],
  ['dorso',   'Dorso',                     'Normal', 'Anormal'],
  ['garupa',  'Garupa',                    'Normal', 'Anormal'],
  ['mae',     'Membro anterior esquerdo',  'Normal', 'Anormal'],
  ['mad',     'Membro anterior direito',   'Normal', 'Anormal'],
  ['mpe',     'Membro posterior esquerdo', 'Normal', 'Anormal'],
  ['mpd',     'Membro posterior direito',  'Normal', 'Anormal'],
];
const F_CASCOS: FieldDef[] = [
  ['qualidade', 'Qualidade córnea',   'Normal', 'Anormal'],
  ['largura',   'Largura dos talões', 'Normal', 'Anormal'],
  ['ranilha',   'Ranilha',            'Normal', 'Anormal'],
  ['percussao', 'Percussão',          'Normal', 'Anormal'],
  ['tamanho',   'Tamanho / Formato',  'Normal', 'Anormal'],
];
const LOCOMOCAO_GROUPS: { titulo: string; items: [string, string][] }[] = [
  { titulo: 'Passo em piso duro', items: [
    ['passo_reta','Em linha reta'],
    ['passo_esq', 'Pequeno círculo à esquerda'],
    ['passo_dir', 'Pequeno círculo à direita'],
  ]},
  { titulo: 'Trote em piso duro', items: [
    ['trote_duro_reta','Em linha reta'],
    ['trote_duro_esq', 'Círculo à esquerda'],
    ['trote_duro_dir', 'Círculo à direita'],
  ]},
  { titulo: 'Trote em piso macio', items: [
    ['trote_macio_esq','Círculo à esquerda'],
    ['trote_macio_dir','Círculo à direita'],
  ]},
  { titulo: 'Galope em piso macio', items: [
    ['galope_esq','Círculo à esquerda'],
    ['galope_dir','Círculo à direita'],
  ]},
];
const FLEXAO_JOINTS: [string, string][] = [
  ['boleto_ae',   'Boleto ant. esquerdo / Interfalangeana distal'],
  ['boleto_ad',   'Boleto ant. direito / Interfalangeana distal'],
  ['carpo_e',     'Carpo esquerdo'],
  ['carpo_d',     'Carpo direito'],
  ['boleto_pe',   'Boleto post. esquerdo'],
  ['boleto_pd',   'Boleto post. direito'],
  ['curvilhao_e', 'Curvilhão esquerdo'],
  ['curvilhao_d', 'Curvilhão direito'],
  ['patela_e',    'Patela esquerda'],
  ['patela_d',    'Patela direita'],
];
const RADIO_PARTES: { key: string; label: string }[] = [
  { key: 'casco_ae',    label: 'Casco AE' },
  { key: 'casco_ad',    label: 'Casco AD' },
  { key: 'boleto_ae',   label: 'Boleto AE' },
  { key: 'boleto_ad',   label: 'Boleto AD' },
  { key: 'boleto_pe',   label: 'Boleto PE' },
  { key: 'boleto_pd',   label: 'Boleto PD' },
  { key: 'curvilhao_e', label: 'Curvilhão E' },
  { key: 'curvilhao_d', label: 'Curvilhão D' },
  { key: 'patela_e',    label: 'Patela E' },
  { key: 'patela_d',    label: 'Patela D' },
];
const PATAS = ['AE', 'AD', 'PE', 'PD'];

// ─── Interfaces públicas ──────────────────────────────────────────────────────

export interface ExameCompraPrintItem {
  id:              number;
  numero:          number | null;
  tipo:            string;
  dataSolicitacao: string;
  status:          string;
  observacao:      string | null;
  veterinario:     { id: number; fullName: string } | null;
}

export interface ExameCompraPrintAnimal {
  nome:       string;
  photoUrl?:  string | null;
  raca?:      { nome: string } | null;
  idadeAnos?: number | null;
  especie?:   { nome: string } | null;
  user?:      { fullName: string; email: string } | null;
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

const CSS = `
  @page { size: A4; margin: 14mm 18mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 10.5px; color: #111; background: #fff; }
  .page-break { page-break-before: always; break-before: page; }
  .header { border-bottom: 2px solid #d97706; padding-bottom: 10px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: flex-end; }
  .header h1 { font-size: 19px; font-weight: 700; color: #d97706; }
  .header .sub { font-size: 9.5px; color: #6b7280; margin-top: 2px; }
  .card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 14px; margin-bottom: 10px; }
  .card-title { font-size: 9.5px; font-weight: 700; color: #374151; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 8px; border-bottom: 1px solid #f3f4f6; padding-bottom: 5px; }
  .section-h { font-size: 9.5px; font-weight: 700; color: #374151; text-transform: uppercase; letter-spacing: .05em; margin: 14px 0 8px; padding: 5px 8px; background: #f9fafb; border-left: 3px solid #d97706; border-radius: 0 4px 4px 0; }
  .sub-h { font-size: 8.5px; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: .05em; margin: 10px 0 4px; }
  .lbl { display: block; font-size: 8.5px; color: #9ca3af; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 2px; }
  .val { font-size: 10.5px; font-weight: 600; color: #111; }
  .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px 14px; }
  .grid2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px 14px; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  th { padding: 4px 8px; border: 1px solid #e5e7eb; text-align: left; font-size: 8px; font-weight: 700; color: #9ca3af; text-transform: uppercase; background: #f9fafb; }
  td { padding: 4px 8px; border: 1px solid #e5e7eb; font-size: 10px; }
  .normal { color: #166534; }
  .anormal { color: #92400e; background: #fffbeb; font-weight: 700; }
  .obs-cell { color: #6b7280; font-style: italic; font-size: 9.5px; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 20px; font-size: 10.5px; font-weight: 700; color: #92400e; background: #fef3c7; }
  .footer { border-top: 1px solid #e5e7eb; padding-top: 7px; margin-top: 18px; display: flex; justify-content: space-between; color: #9ca3af; font-size: 8.5px; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function esc(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('T')[0].split('-');
  return `${d}/${m}/${y}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseLaudo(obs: string | null): any {
  if (!obs) return null;
  try { return JSON.parse(obs); } catch { return null; }
}

function fmtNumero(n: number | null | undefined): string {
  return n != null ? `#${String(n).padStart(3, '0')}` : '';
}

// ─── Render: seção binária (Normal/Anormal) ───────────────────────────────────

function renderBinSection(
  titulo: string,
  fields: FieldDef[],
  valores: Record<string,string> | null | undefined,
  obs: Record<string,string> | null | undefined,
): string {
  if (!valores) return '';
  const rows = fields.map(([k, label, opt1]) => {
    const v  = valores[k] ?? opt1;
    const o  = obs?.[k] ?? '';
    const ok = v === opt1;
    return `<tr>
      <td>${esc(label)}</td>
      <td class="${ok ? 'normal' : 'anormal'}">${esc(v)}</td>
      <td class="obs-cell">${esc(o)}</td>
    </tr>`;
  }).join('');
  return `<div style="margin-bottom:8px;">
    <p class="sub-h">${esc(titulo)}</p>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr><th style="width:52%;">Parâmetro</th><th style="width:20%;">Resultado</th><th>Observações</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

// ─── Render: Pinçamento ───────────────────────────────────────────────────────

function renderPincamento(
  pincamento: Record<string,string>,
  pincamentoObs: Record<string,string>,
): string {
  const rows = PATAS.map(p => {
    const v  = pincamento?.[p] ?? 'Normal';
    const o  = pincamentoObs?.[p] ?? '';
    const ok = v === 'Normal';
    return `<tr>
      <td style="font-weight:600;">${esc(p)}</td>
      <td class="${ok ? 'normal' : 'anormal'}">${esc(v)}</td>
      <td class="obs-cell">${esc(o)}</td>
    </tr>`;
  }).join('');
  return `<div style="margin-bottom:8px;">
    <p class="sub-h">Pinçamento</p>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr><th style="width:25%;">Pata</th><th style="width:25%;">Resultado</th><th>Observações</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

// ─── Render: Ferrageamento ────────────────────────────────────────────────────

function renderFerrageamento(
  tipo: string | null | undefined,
  patas: Record<string,string> | null | undefined,
): string {
  const patasRows = PATAS.map(p => {
    const v = patas?.[p] ?? '';
    return `<tr><td style="font-weight:600;width:25%;">${esc(p)}</td><td>${esc(v) || '—'}</td></tr>`;
  }).join('');
  return `<div style="margin-bottom:8px;">
    <p class="sub-h">Ferrageamento</p>
    <p style="font-size:10px;margin-bottom:5px;">Tipo: <strong>${esc(tipo) || 'Normal'}</strong></p>
    <table style="width:50%;border-collapse:collapse;"><tbody>${patasRows}</tbody></table>
  </div>`;
}

// ─── Render: Locomoção ────────────────────────────────────────────────────────

function renderLocomocao(
  valores: Record<string,string> | null | undefined,
  obsMap:  Record<string,string> | null | undefined,
): string {
  if (!valores) return '';
  const groups = LOCOMOCAO_GROUPS.map(g => {
    const rows = g.items.map(([k, label]) => {
      const v  = valores[k] ?? 'Normal';
      const o  = obsMap?.[k] ?? '';
      const ok = v === 'Normal';
      return `<tr>
        <td>${esc(label)}</td>
        <td class="${ok ? 'normal' : 'anormal'}" style="width:22%;">${esc(v)}</td>
        <td class="obs-cell">${esc(o)}</td>
      </tr>`;
    }).join('');
    return `<p style="font-size:8.5px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;margin:6px 0 3px;">${esc(g.titulo)}</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:4px;">
      <thead><tr><th>Marcha / Condição</th><th style="width:22%;">Resultado</th><th>Observações</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }).join('');
  return `<div style="margin-bottom:8px;"><p class="sub-h">Locomoção</p>${groups}</div>`;
}

// ─── Render: Testes de Flexão ─────────────────────────────────────────────────

function renderFlexao(
  flexao: Record<string,{ sensivel: boolean; grau: string }> | null | undefined,
): string {
  if (!flexao) return '';
  const rows = FLEXAO_JOINTS.map(([k, label]) => {
    const item = flexao[k] ?? { sensivel: false, grau: '-' };
    const ok   = !item.sensivel;
    return `<tr>
      <td>${esc(label)}</td>
      <td class="${ok ? 'normal' : 'anormal'}" style="width:22%;">${ok ? 'Não sensível' : 'Sensível'}</td>
      <td style="width:15%;text-align:center;${!ok ? 'color:#92400e;font-weight:700;' : 'color:#9ca3af;'}">${item.sensivel ? esc(item.grau) : '—'}</td>
    </tr>`;
  }).join('');
  return `<div style="margin-bottom:8px;">
    <p class="sub-h">Testes de Flexão</p>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr><th>Articulação</th><th style="width:22%;">Sensibilidade</th><th style="width:15%;text-align:center;">Grau</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

// ─── Render: Raio-X avaliação ─────────────────────────────────────────────────

function renderRadioAval(radioAval: Record<string, number | null> | null | undefined): string {
  if (!radioAval) return '';
  const rows = RADIO_PARTES.map(p => {
    const v = radioAval[p.key];
    let badge = '—';
    let style = 'color:#9ca3af;';
    if (v != null) {
      const colors = ['','#166534','#4d7c0f','#d97706','#dc2626','#991b1b'];
      badge = String(v);
      style = `color:${colors[v] ?? '#111'};font-weight:700;`;
    }
    return `<tr><td>${esc(p.label)}</td><td style="text-align:center;${style}">${badge}</td></tr>`;
  }).join('');
  return `<table style="width:220px;border-collapse:collapse;margin-bottom:6px;">
    <thead><tr><th>Estrutura</th><th style="text-align:center;width:80px;">Avaliação (1–5)</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ─── Render: Imagem ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderImagem(img: any): string {
  if (!img) return '';
  const parts: string[] = [];

  // Raio-X
  const temRadioAval = img.radioAval && Object.values(img.radioAval as Record<string,number|null>).some(v => v != null);
  if (img.raioX || temRadioAval || img.raioXLaudo) {
    parts.push(`<p class="sub-h">Raio-X</p>`);
    if (img.raioX && img.raioX !== 'LAUDO EM ANEXO') {
      parts.push(`<p style="font-size:10px;margin-bottom:5px;">${esc(img.raioX)}</p>`);
    }
    if (temRadioAval) parts.push(renderRadioAval(img.radioAval));
    if (img.raioXLaudo) {
      parts.push(`<p style="font-size:10px;color:#374151;white-space:pre-line;background:#f9fafb;border:1px solid #e5e7eb;border-radius:4px;padding:6px 10px;margin-bottom:6px;">${esc(img.raioXLaudo)}</p>`);
    }
  }

  // Ultrassonografia
  if (img.ultrassom || img.ultrassomLaudo) {
    parts.push(`<p class="sub-h">Ultrassonografia</p>`);
    if (img.ultrassom && img.ultrassom !== 'IMAGENS MAD E MAE – LAUDO EM ANEXO') {
      parts.push(`<p style="font-size:10px;margin-bottom:5px;">${esc(img.ultrassom)}</p>`);
    }
    if (img.ultrassomLaudo) {
      parts.push(`<p style="font-size:10px;color:#374151;white-space:pre-line;background:#f9fafb;border:1px solid #e5e7eb;border-radius:4px;padding:6px 10px;margin-bottom:6px;">${esc(img.ultrassomLaudo)}</p>`);
    }
  }

  // Endoscopia
  if (img.endoscopia) {
    parts.push(`<p class="sub-h">Endoscopia</p>`);
    parts.push(`<p style="font-size:10px;margin-bottom:6px;">${esc(img.endoscopia)}</p>`);
  }

  // Outros
  if (img.outros) {
    parts.push(`<p class="sub-h">Outros</p>`);
    parts.push(`<p style="font-size:10px;margin-bottom:6px;">${esc(img.outros)}</p>`);
  }

  // Comportamento / Anti-dopping
  const extras: string[] = [];
  if (img.comportamentoSuspeito != null) {
    extras.push(`Comportamento suspeito: <strong>${img.comportamentoSuspeito ? 'Sim' : 'Não'}</strong>`);
  }
  if (img.antiDopping != null) {
    extras.push(`Anti-dopping: <strong>${img.antiDopping ? 'Sim' : 'Não'}</strong>${
      img.antiDopping && img.antiDoppingResultado ? ` — ${esc(img.antiDoppingResultado)}` : ''
    }`);
  }
  if (extras.length > 0) {
    parts.push(`<p style="font-size:10px;margin-top:4px;">${extras.join(' &nbsp;|&nbsp; ')}</p>`);
  }

  if (parts.length === 0) return '';
  return `<div style="margin-bottom:8px;">${parts.join('')}</div>`;
}

// ─── Gerador HTML principal ───────────────────────────────────────────────────

export function gerarHtmlExameCompra(
  ex:     ExameCompraPrintItem,
  animal?: ExameCompraPrintAnimal | null,
): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let laudo: any = parseLaudo(ex.observacao);

  // Compatibilidade com formatos legados
  if (laudo && !laudo.clinicoGeral) {
    if (laudo.grupos?.[0]?.laudoCompra) laudo = laudo.grupos[0].laudoCompra;
    else if (typeof laudo.obs === 'string') { try { laudo = JSON.parse(laudo.obs); } catch { /* mantém */ } }
  }

  const me  = laudo?.musculoEsqueletico ?? {};
  const img = laudo?.imagem ?? {};

  // ── Animal card ─────────────────────────────────────────────────────────────
  const animalBlock = animal ? `
    <div class="card">
      <div class="card-title">Animal</div>
      <div style="display:flex;align-items:flex-start;gap:12px;">
        ${typeof animal.photoUrl === 'string' && animal.photoUrl
          ? `<img src="${esc(animal.photoUrl)}" alt="${esc(animal.nome)}" style="width:52px;height:52px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb;flex-shrink:0;" />`
          : ''}
        <div class="grid3" style="flex:1;">
          <div><span class="lbl">Nome</span><span class="val">${esc(animal.nome)}</span></div>
          ${animal.raca    ? `<div><span class="lbl">Raça</span><span class="val">${esc(animal.raca.nome)}</span></div>` : ''}
          ${animal.especie ? `<div><span class="lbl">Espécie</span><span class="val">${esc(animal.especie.nome)}</span></div>` : ''}
          ${animal.idadeAnos != null ? `<div><span class="lbl">Idade</span><span class="val">${animal.idadeAnos} ano${animal.idadeAnos !== 1 ? 's' : ''}</span></div>` : ''}
          ${animal.user    ? `<div><span class="lbl">Proprietário</span><span class="val">${esc(animal.user.fullName)}</span></div>` : ''}
        </div>
      </div>
    </div>` : '';

  // ── Info card ───────────────────────────────────────────────────────────────
  const infoBlock = `
    <div class="card">
      <div class="card-title">Informações do Exame</div>
      <div class="grid3">
        <div><span class="lbl">Data da Avaliação</span><span class="val">${fmtDate(ex.dataSolicitacao)}</span></div>
        ${ex.veterinario ? `<div><span class="lbl">Médico Veterinário</span><span class="val">${esc(ex.veterinario.fullName)}</span></div>` : ''}
        <div><span class="lbl">Status</span><span class="val">${esc(ex.status)}</span></div>
        ${ex.numero != null ? `<div><span class="lbl">Nº</span><span class="val">${fmtNumero(ex.numero)}</span></div>` : ''}
      </div>
    </div>`;

  // ── Assinatura ──────────────────────────────────────────────────────────────
  const sigBlock = ex.veterinario ? `
    <div style="margin-top:36px;display:flex;justify-content:flex-end;">
      <div style="text-align:center;width:210px;">
        <div style="border-top:1px solid #374151;padding-top:5px;font-size:10px;font-weight:600;color:#374151;">${esc(ex.veterinario.fullName)}</div>
        <div style="font-size:8.5px;color:#9ca3af;margin-top:2px;">Médico Veterinário Responsável</div>
      </div>
    </div>` : '';

  // ── Justificativa de alteração ──────────────────────────────────────────────
  const justificativaBlock = laudo?.justificativa ? `
    <div style="margin-top:10px;padding:8px 12px;background:#fffbeb;border:1px solid #fcd34d;border-radius:4px;">
      <p style="font-size:8.5px;font-weight:700;color:#d97706;text-transform:uppercase;margin-bottom:3px;">Justificativa de Alteração</p>
      <p style="font-size:10px;color:#374151;">${esc(laudo.justificativa)}</p>
    </div>` : '';

  // ── Corpo ───────────────────────────────────────────────────────────────────
  const body = `
  <div class="header">
    <div>
      <h1>S2Vet</h1>
      <p class="sub">Sistema Hospitalar Veterinário · Módulo Clínico</p>
      <p class="sub" style="margin-top:3px;">Emitido em: ${new Date().toLocaleString('pt-BR')}</p>
    </div>
    <div style="text-align:right;">
      <p style="font-size:9.5px;color:#9ca3af;margin-bottom:4px;">LAUDO DE EXAME DE COMPRA</p>
      <span class="badge">Compra Equina</span>
    </div>
  </div>

  ${animalBlock}
  ${infoBlock}
  ${justificativaBlock}

  <div class="section-h">Exame Clínico Geral</div>
  <div class="card">
    ${renderBinSection('Parâmetros gerais', F_CLINICO, laudo?.clinicoGeral?.valores, laudo?.clinicoGeral?.obs)}
  </div>

  <div class="section-h">Fisiologia Geral</div>
  <div class="card">
    <div class="two-col">
      <div>
        ${renderBinSection('Cardiovascular', F_CARDIO, laudo?.cardiovascular?.valores, laudo?.cardiovascular?.obs)}
        ${renderBinSection('Sistema Nervoso', F_NERVOSO, laudo?.nervoso?.valores, laudo?.nervoso?.obs)}
      </div>
      <div>
        ${renderBinSection('Respiratório', F_RESP, laudo?.respiratorio?.valores, laudo?.respiratorio?.obs)}
        ${renderBinSection('Digestório', F_DIGEST, laudo?.digestivo?.valores, laudo?.digestivo?.obs)}
        ${renderBinSection('Urogenital', F_UROGEN, laudo?.urogenital?.valores, laudo?.urogenital?.obs)}
      </div>
    </div>
  </div>

  <div class="section-h page-break">Sistema Músculo-Esquelético</div>
  <div class="card">
    <div class="two-col">
      <div>
        ${renderBinSection('Inspeção / Palpação / Percussão', F_INSPECAO, me.inspecao?.valores, me.inspecao?.obs)}
      </div>
      <div>
        ${renderBinSection('Cascos', F_CASCOS, me.cascos?.valores, me.cascos?.obs)}
        ${renderPincamento(me.cascos?.pincamento ?? {}, me.cascos?.pincamentoObs ?? {})}
        ${renderFerrageamento(me.ferrageamento?.tipo, me.ferrageamento?.patas)}
      </div>
    </div>
    ${renderLocomocao(me.locomocao?.valores, me.locomocao?.obs)}
    ${renderFlexao(me.flexao)}
  </div>

  <div class="section-h page-break">Exames de Imagem</div>
  <div class="card">
    ${renderImagem(img)}
  </div>

  ${laudo?.conclusao ? `
  <div class="section-h">Conclusão / Parecer Final</div>
  <div class="card">
    <p style="font-size:11px;color:#111;line-height:1.6;white-space:pre-line;">${esc(laudo.conclusao)}</p>
  </div>` : ''}

  ${sigBlock}

  <div class="footer">
    <span>S2Vet · Sistema Hospitalar Veterinário · Exame de Compra Equino ${fmtNumero(ex.numero)}</span>
    <span>Emitido em ${new Date().toLocaleString('pt-BR')}</span>
  </div>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Exame de Compra ${fmtNumero(ex.numero)}${animal ? ` — ${animal.nome}` : ''} — S2Vet</title>
  <style>${CSS}</style>
</head>
<body>${body}</body>
</html>`;
}

// ─── Imprimir via iframe ──────────────────────────────────────────────────────

export function imprimirExameCompra(
  ex:      ExameCompraPrintItem,
  animal?: ExameCompraPrintAnimal | null,
): void {
  const iframe = document.createElement('iframe');
  Object.assign(iframe.style, {
    position: 'fixed', top: '-9999px', left: '-9999px',
    width: '0', height: '0', border: 'none',
  });
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
  if (!doc) { document.body.removeChild(iframe); return; }

  doc.open();
  doc.write(gerarHtmlExameCompra(ex, animal));
  doc.close();

  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => {
      if (document.body.contains(iframe)) document.body.removeChild(iframe);
    }, 500);
  }, 250);
}

// ─── Abrir em nova aba (para salvar como PDF e compartilhar) ──────────────────

export function abrirLaudoExameCompra(
  ex:      ExameCompraPrintItem,
  animal?: ExameCompraPrintAnimal | null,
): void {
  const html = gerarHtmlExameCompra(ex, animal);
  const blob = new Blob([html], { type: 'text/html; charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const win  = window.open(url, '_blank');
  // Libera o object URL após a janela ter tempo de carregar o conteúdo
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  if (!win) {
    // Fallback se popup blocker ativou
    const a = document.createElement('a');
    a.href = url;
    a.download = `exame-compra${ex.numero != null ? `-${String(ex.numero).padStart(3,'0')}` : ''}${animal ? `-${animal.nome.replace(/\s+/g,'-').toLowerCase()}` : ''}.html`;
    a.click();
  }
}
