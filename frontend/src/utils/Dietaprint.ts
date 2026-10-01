// ─── Dietaprint.ts ────────────────────────────────────────────────────────────
// Gera o HTML completo para impressão do plano de dieta.
// Seções independentes: Diário (por período do dia) | Semanal | Mensal
// ─────────────────────────────────────────────────────────────────────────────

// Desde 2026-09-29 o papel é a FOLHA CLÍNICA (`print/FolhaClinica.ts`); aqui mora só
// o CORPO — os blocos de alimentação por período.
import {
  gerarHtmlFolhaClinica, prepararFolhaClinica, escFolha as esc,
} from './print/FolhaClinica';

export interface PrintAnimal {
  nome: string;
  photoUrl?: string | null;
  raca?: { nome: string } | null;
  dataNascimento?: string | Date | null;
  /** Contato do cliente — destino do PDF por WhatsApp / e-mail. */
  user?: { fullName: string; email?: string | null; phone?: string | null } | null;
  logoUrl?: string | null;
}

export interface PrintPlan {
  nome: string;
  ativo: boolean;
}

export interface PrintItem {
  alimento?: { nome: string } | null;
  horario?: string | null;
  qtdGramasDia: number;
  unidade: string;
  periodicidade: string;
}

export interface PrintUser {
  /** `id` habilita CRMV e assinatura de quem emite a dieta. */
  id?:       number | null;
  fullName?: string | null;
  email?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTipo(periodicidade: string): 'diario' | 'semanal' | 'mensal' {
  if (periodicidade.includes('semana')) return 'semanal';
  if (periodicidade.includes('mês'))   return 'mensal';
  return 'diario';
}

const PERIOD_ORDER = ['Madrugada', 'Manhã', 'Meio-dia', 'Tarde', 'Noite', 'Sem horário'];
const PERIOD_LABELS = new Set(['Manhã', 'Meio-dia', 'Tarde', 'Noite', 'Madrugada']);
const SEMANA_ORDER  = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
const MES_ORDER     = ['Dia 1', 'Dia 7', 'Dia 15', 'Dia 22', 'Último dia'];

function getMealPeriod(horario: string | null | undefined): string {
  if (!horario) return 'Sem horário';
  if (PERIOD_LABELS.has(horario)) return horario;
  const match = horario.match(/^(\d{1,2}):\d{2}$/);
  if (match) {
    const h = parseInt(match[1], 10);
    if (h >= 4  && h < 12) return 'Manhã';
    if (h >= 12 && h < 14) return 'Meio-dia';
    if (h >= 14 && h < 18) return 'Tarde';
    if (h >= 18 && h < 24) return 'Noite';
    return 'Madrugada';
  }
  return horario;
}

function formatarDataBR(data: string | Date | null | undefined): string {
  if (!data) return '—';
  const d = new Date(data instanceof Date ? data.toISOString() : data);
  if (isNaN(d.getTime())) return '—';
  return [
    String(d.getUTCDate()).padStart(2, '0'),
    String(d.getUTCMonth() + 1).padStart(2, '0'),
    d.getUTCFullYear(),
  ].join('/');
}

// ── Bloco de período (reutilizado para diário, semanal e mensal) ──────────────

function buildPeriodBlock(label: string, items: PrintItem[]): string {
  const rows = items.map(item => `
    <tr>
      <td class="item-name-cell">${item.alimento?.nome ?? '—'}</td>
      <td class="item-qty-cell">${item.qtdGramasDia}&nbsp;${item.unidade}</td>
      <td class="item-freq-cell">${item.periodicidade}</td>
    </tr>`).join('');

  return `
    <div class="period-wrapper">
      <div class="period-header">${label}</div>
      <table class="period-table">
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── HTML agrupado em três seções independentes ────────────────────────────────

function buildGroupedHTML(itens: PrintItem[]): string {
  if (itens.length === 0) {
    return '<p class="empty-msg">Nenhum alimento cadastrado neste plano.</p>';
  }

  const itensDiarios  = itens.filter(i => getTipo(i.periodicidade) === 'diario');
  const itensSemanais = itens.filter(i => getTipo(i.periodicidade) === 'semanal');
  const itensMensais  = itens.filter(i => getTipo(i.periodicidade) === 'mensal');

  let html = '';

  // ── Seção Diário ──────────────────────────────────────────────────────────
  if (itensDiarios.length > 0) {
    const grouped = new Map<string, PrintItem[]>();
    itensDiarios.forEach(item => {
      const period = getMealPeriod(item.horario);
      if (!grouped.has(period)) grouped.set(period, []);
      grouped.get(period)!.push(item);
    });
    const sorted = [...grouped.keys()].sort(
      (a, b) => PERIOD_ORDER.indexOf(a) - PERIOD_ORDER.indexOf(b),
    );
    html += sorted.map(p => buildPeriodBlock(p, grouped.get(p)!)).join('');
  }

  // ── Seção Semanal ─────────────────────────────────────────────────────────
  if (itensSemanais.length > 0) {
    html += `<div class="section-divider">📅 &nbsp; SEMANAL</div>`;
    const grouped = new Map<string, PrintItem[]>();
    itensSemanais.forEach(item => {
      const day = item.horario ?? 'Sem dia';
      if (!grouped.has(day)) grouped.set(day, []);
      grouped.get(day)!.push(item);
    });
    const sorted = [...grouped.keys()].sort((a, b) => {
      const ai = SEMANA_ORDER.indexOf(a);
      const bi = SEMANA_ORDER.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
    html += sorted.map(d => buildPeriodBlock(d, grouped.get(d)!)).join('');
  }

  // ── Seção Mensal ──────────────────────────────────────────────────────────
  if (itensMensais.length > 0) {
    html += `<div class="section-divider">📆 &nbsp; MENSAL</div>`;
    const grouped = new Map<string, PrintItem[]>();
    itensMensais.forEach(item => {
      const day = item.horario ?? 'Sem dia';
      if (!grouped.has(day)) grouped.set(day, []);
      grouped.get(day)!.push(item);
    });
    const sorted = [...grouped.keys()].sort((a, b) => {
      const ai = MES_ORDER.indexOf(a);
      const bi = MES_ORDER.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
    html += sorted.map(d => buildPeriodBlock(d, grouped.get(d)!)).join('');
  }

  return html;
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const PRINT_CSS = `
  .plan-row {
    position: relative; display: flex; justify-content: center; align-items: center;
    margin-top: 12pt; margin-bottom: 12pt;
  }
  .plan-name { font-size: 15pt; font-weight: 700; color: #111; text-align: center; }
  .badge     { position: absolute; right: 0; font-size: 9pt; font-weight: 600; padding: 3pt 10pt; border-radius: 20pt; border: 0.8pt solid; }
  .badge-on  { color: #065f46; border-color: #059669; background: #d1fae5; }
  .badge-off { color: #6b7280; border-color: #d1d5db; background: #f3f4f6; }

  /* ── Divisor de seção (Semanal / Mensal) ── */
  .section-divider {
    text-align: center; font-size: 8.5pt; font-weight: 700;
    color: #374151; letter-spacing: 2pt;
    margin: 18pt 0 12pt; padding: 6pt 0;
    border-top: 0.8pt solid #d1d5db; border-bottom: 0.8pt solid #d1d5db;
    background: #f9fafb;
  }

  /* ── Blocos de período ── */
  .period-wrapper {
    border: 0.5pt solid #d1fae5; border-radius: 6pt;
    overflow: hidden; margin-bottom: 14pt;
  }
  .period-header {
    background: #059669; color: #fff;
    font-size: 9pt; font-weight: 700; letter-spacing: 2pt;
    text-align: center; text-transform: uppercase;
    padding: 6pt 10pt;
  }
  .period-table { width: 100%; border-collapse: collapse; }
  .item-name-cell {
    padding: 6pt 10pt; font-size: 10pt; color: #111;
    border-bottom: 0.3pt solid #f3f4f6;
    vertical-align: middle; width: 55%;
  }
  .item-qty-cell {
    padding: 6pt 10pt; font-size: 10pt;
    font-weight: 700; color: #059669;
    border-bottom: 0.3pt solid #f3f4f6;
    vertical-align: middle; width: 20%; text-align: right;
  }
  .item-freq-cell {
    padding: 6pt 10pt; font-size: 9pt; color: #6b7280;
    border-bottom: 0.3pt solid #f3f4f6;
    vertical-align: middle; width: 25%; text-align: right;
  }
  .period-table tbody tr:last-child td { border-bottom: none; }

  .empty-msg { color: #9ca3af; font-size: 10pt; text-align: center; padding: 12pt; }
`;

// ── Função principal exportada ────────────────────────────────────────────────

export function gerarHtmlDieta(
  animal: PrintAnimal | null,
  plano: PrintPlan,
  itens: PrintItem[],
  user: PrintUser | null,
): string {
  const totalItens  = itens.length;
  const groupedHTML = buildGroupedHTML(itens);
  const nascimento  = formatarDataBR(animal?.dataNascimento);

  return gerarHtmlFolhaClinica({
    documento:    `Plano de Dieta · ${plano.nome}`,
    logoUrl:      animal?.logoUrl,
    // Quem assina a dieta é o veterinário que a emite (o usuário da tela), como antes.
    profissional: user ? { id: user.id ?? null, nome: user.fullName ?? null } : null,
    animal: animal ? {
      nome:         animal.nome,
      photoUrl:     animal.photoUrl ?? null,
      raca:         animal.raca?.nome ?? null,
      nascimento:   nascimento !== '—' ? nascimento : null,
      proprietario: animal.user?.fullName ?? null,
    } : null,
    paginas: [{
      titulo:    'Plano de Dieta',
      subtitulo: esc(plano.nome),
      corpoHtml: groupedHTML,
    }],
    cssModulo: PRINT_CSS,
    rodape:    `Total: ${totalItens} ${totalItens === 1 ? 'alimento' : 'alimentos'}`,
  });
}

/**
 * Resolve o que a folha precisa ANTES de gerar o HTML: CRMV/assinatura de quem
 * emite, endereço da clínica e as imagens (logo e foto) em `data:`. Obrigatório em
 * quem vai mandar a dieta por WhatsApp/e-mail — ver print/FolhaClinica.ts.
 */
export async function prepararDieta(animal: PrintAnimal | null, user?: PrintUser | null): Promise<void> {
  await prepararFolhaClinica({
    profissionalId: user?.id ?? null,
    logoUrl:        animal?.logoUrl,
    imagens:        [animal?.photoUrl],
  });
}
