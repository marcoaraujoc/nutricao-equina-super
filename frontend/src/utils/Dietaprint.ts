// ─── dietaPrint.ts ────────────────────────────────────────────────────────────
// Gera o HTML completo para impressão do plano de dieta.
// Isolado em utilitário para manter Dieta.tsx legível.
// ─────────────────────────────────────────────────────────────────────────────

// ── Interfaces mínimas exigidas pelo utilitário ──────────────────────────────

export interface PrintAnimal {
  nome: string;
  photoUrl?: string | null;
  raca?: { nome: string } | null;
  dataNascimento?: string | Date | null;
  user?: { fullName: string; email: string } | null;
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
  fullName?: string | null;
  email?: string | null;
}

// ── Helpers internos ──────────────────────────────────────────────────────────

const FREQ_ORDER   = ['Diário', '2x ao dia', '3x ao dia', 'Semanal', 'Quinzenal', 'Mensal'];
const PERIOD_ORDER = ['Madrugada', 'Manhã', 'Tarde', 'Noite', 'Sem horário'];

// Períodos aceitos como label direto (campo horario salvo como texto no banco)
const PERIOD_LABELS = new Set(['Manhã', 'Tarde', 'Noite', 'Madrugada']);

function getMealPeriod(horario: string | null | undefined): string {
  if (!horario) return 'Sem horário';

  // Já é um label de período (ex: "Manhã", "Tarde") — usa direto
  if (PERIOD_LABELS.has(horario)) return horario;

  // Formato HH:MM — converte para período
  const match = horario.match(/^(\d{1,2}):\d{2}$/);
  if (match) {
    const h = parseInt(match[1], 10);
    if (h >= 4  && h < 12) return 'Manhã';
    if (h >= 12 && h < 18) return 'Tarde';
    if (h >= 18 && h < 24) return 'Noite';
    return 'Madrugada';          // 00:00–03:59
  }

  // Qualquer outro valor — usa como está
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

// ── Geração do HTML agrupado ──────────────────────────────────────────────────

function buildGroupedHTML(itens: PrintItem[]): string {
  // Agrupar: periodicidade → período do dia → itens
  const grouped = new Map<string, Map<string, PrintItem[]>>();

  itens.forEach(item => {
    const freq   = item.periodicidade;
    const period = getMealPeriod(item.horario);
    if (!grouped.has(freq)) grouped.set(freq, new Map());
    const byPeriod = grouped.get(freq)!;
    if (!byPeriod.has(period)) byPeriod.set(period, []);
    byPeriod.get(period)!.push(item);
  });

  const sortedFreqs = [...grouped.keys()].sort((a, b) => {
    const ai = FREQ_ORDER.indexOf(a);
    const bi = FREQ_ORDER.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  if (sortedFreqs.length === 0) {
    return '<p class="empty-msg">Nenhum alimento cadastrado neste plano.</p>';
  }

  return sortedFreqs.map(freq => {
    const byPeriod = grouped.get(freq)!;
    const sortedPeriods = [...byPeriod.keys()].sort(
      (a, b) => PERIOD_ORDER.indexOf(a) - PERIOD_ORDER.indexOf(b),
    );

    // Constrói as linhas com rowspan para o período do dia
    let rows = '';
    sortedPeriods.forEach((period, pIdx) => {
      const periodItens = byPeriod.get(period)!;
      const topBorder   = pIdx > 0 ? 'border-top: 0.8pt solid #d1fae5;' : '';

      periodItens.forEach((item, iIdx) => {
        const mealCell = iIdx === 0
          ? `<td class="meal-cell" rowspan="${periodItens.length}" style="${topBorder}">${period}</td>`
          : '';

        const itemBorder = (iIdx === periodItens.length - 1 && pIdx < sortedPeriods.length - 1)
          ? 'border-bottom: 0.8pt solid #d1fae5;'
          : '';

        rows += `
          <tr>
            ${mealCell}
            <td class="item-cell" style="${itemBorder}">
              <span class="item-qty">${item.qtdGramasDia}&nbsp;${item.unidade}</span>
              <span class="item-sep"> · </span>
              <span class="item-name">${item.alimento?.nome ?? '—'}</span>
            </td>
          </tr>`;
      });
    });

    return `
      <div class="freq-wrapper">
        <table class="freq-table">
          <thead>
            <tr><th colspan="2" class="freq-header">${freq.toUpperCase()}</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join('');
}

// ── CSS embutido ──────────────────────────────────────────────────────────────

const PRINT_CSS = `
  @page { size: A4; margin: 18mm 20mm; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; color: #111; }

  /* ── Cabeçalho do sistema ── */
  .sys-header {
    display: flex; justify-content: space-between; align-items: flex-start;
    border-bottom: 2pt solid #059669; padding-bottom: 10pt; margin-bottom: 18pt;
  }
  .sys-name { font-size: 22pt; font-weight: 700; color: #059669; line-height: 1; }
  .sys-sub  { font-size: 9pt;  color: #6b7280; margin-top: 4pt; }
  .sys-date { font-size: 9pt;  color: #9ca3af; text-align: right; line-height: 1.7; }

  /* ── Títulos de seção ── */
  .sec-title {
    font-size: 8pt; font-weight: 700; color: #059669;
    text-transform: uppercase; letter-spacing: 1pt;
    margin-bottom: 8pt; margin-top: 16pt;
  }

  /* ── Card do animal (espelho do AnimalCard da página) ── */
  .animal-card {
    display: flex; gap: 14pt; align-items: stretch;
    background: #f9fafb; border: 0.5pt solid #e5e7eb;
    border-radius: 8pt; padding: 10pt; margin-bottom: 4pt;
  }
  .animal-photo {
    width: 78pt; height: 78pt; border-radius: 6pt;
    object-fit: cover; flex-shrink: 0; border: 0.5pt solid #e5e7eb;
  }
  .animal-info { flex: 1; display: flex; flex-direction: column; justify-content: space-between; }
  .animal-top  { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8pt; }
  .animal-bottom {
    display: flex; gap: 20pt;
    margin-top: 8pt; padding-top: 8pt; border-top: 0.5pt solid #e5e7eb;
  }
  .f-label { font-size: 8pt;   color: #6b7280; margin-bottom: 3pt; }
  .f-val   { font-size: 10pt;  font-weight: 600; color: #111; }
  .f-val-s { font-size: 9.5pt; font-weight: 500; color: #374151; }

  /* ── Cabeçalho do plano ── */
  .plan-row {
    position: relative; display: flex; justify-content: center; align-items: center;
    margin-top: 12pt; margin-bottom: 12pt;
  }
  .plan-name { font-size: 15pt; font-weight: 700; color: #111; text-align: center; }
  .badge     { position: absolute; right: 0; font-size: 9pt; font-weight: 600; padding: 3pt 10pt; border-radius: 20pt; border: 0.8pt solid; }
  .badge-on  { color: #065f46; border-color: #059669; background: #d1fae5; }
  .badge-off { color: #6b7280; border-color: #d1d5db; background: #f3f4f6; }

  /* ── Grupos de frequência ── */
  .freq-wrapper {
    border: 0.5pt solid #d1fae5; border-radius: 6pt;
    overflow: hidden; margin-bottom: 12pt;
  }
  .freq-table { width: 100%; border-collapse: collapse; }

  .freq-header {
    background: #059669; color: #fff;
    font-size: 8.5pt; font-weight: 700; letter-spacing: 2.5pt;
    text-align: center; padding: 5pt 8pt; text-transform: uppercase;
  }

  .meal-cell {
    width: 68pt; min-width: 68pt;
    background: #f0fdf4; color: #065f46;
    font-size: 9pt; font-weight: 700;
    text-align: center; vertical-align: middle;
    padding: 6pt 4pt;
    border-right: 0.8pt solid #d1fae5;
  }

  .item-cell {
    padding: 5pt 10pt;
    border-bottom: 0.3pt solid #f3f4f6;
    font-size: 10pt; vertical-align: middle;
  }
  .freq-table tbody tr:last-child .item-cell { border-bottom: none; }

  .item-qty  { font-weight: 700; color: #059669; }
  .item-sep  { color: #d1d5db; }
  .item-name { color: #111; }

  /* ── Rodapé ── */
  .footer {
    margin-top: 20pt; padding-top: 8pt;
    border-top: 0.5pt solid #e5e7eb;
    font-size: 8pt; color: #9ca3af;
    display: flex; justify-content: space-between;
  }

  .empty-msg { color: #9ca3af; font-size: 10pt; text-align: center; padding: 12pt; }
`;

// ── Função principal exportada ─────────────────────────────────────────────────

export function gerarHtmlDieta(
  animal: PrintAnimal | null,
  plano: PrintPlan,
  itens: PrintItem[],
  user: PrintUser | null,
): string {
  const agora       = new Date();
  const dataEmissao = agora.toLocaleDateString('pt-BR');
  const horaEmissao = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const fotoUrl     = animal?.photoUrl ?? 'https://picsum.photos/id/1015/400/400';
  const totalItens  = itens.length;
  const groupedHTML = buildGroupedHTML(itens);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Plano de Dieta · ${plano.nome}</title>
  <style>${PRINT_CSS}</style>
</head>
<body>

  <!-- Cabeçalho sistema -->
  <div class="sys-header">
    <div>
      <div class="sys-name">S2Vet</div>
      <div class="sys-sub">Sistema Hospitalar Veterinário · Módulo Nutricional</div>
    </div>
    <div class="sys-date">
      Emitido em ${dataEmissao}<br>às ${horaEmissao}
    </div>
  </div>

  <!-- Dados do animal -->
  <div class="sec-title">Dados do Animal</div>
  <div class="animal-card">
    <img class="animal-photo" src="${fotoUrl}" alt="${animal?.nome ?? 'Animal'}">
    <div class="animal-info">
      <div class="animal-top">
        <div>
          <div class="f-label">Nome</div>
          <div class="f-val">${animal?.nome ?? '—'}</div>
        </div>
        <div>
          <div class="f-label">Raça</div>
          <div class="f-val-s">${animal?.raca?.nome ?? 'Não informada'}</div>
        </div>
        <div>
          <div class="f-label">Nascimento</div>
          <div class="f-val-s">${formatarDataBR(animal?.dataNascimento)}</div>
        </div>
      </div>
      <div class="animal-bottom">
        <div>
          <div class="f-label">Proprietário</div>
          <div class="f-val-s">${animal?.user?.fullName ?? user?.fullName ?? '—'}</div>
        </div>
        <div>
          <div class="f-label">E-mail</div>
          <div class="f-val-s">${animal?.user?.email ?? user?.email ?? '—'}</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Plano de dieta -->
  <div class="sec-title">Plano de Dieta</div>
  <div class="plan-row">
    <span class="plan-name">${plano.nome}</span>
    <span class="badge ${plano.ativo ? 'badge-on' : 'badge-off'}">
      ${plano.ativo ? 'Ativo' : 'Inativo'}
    </span>
  </div>

  <!-- Alimentos agrupados por frequência e período do dia -->
  ${groupedHTML}

  <!-- Rodapé -->
  <div class="footer">
    <span>S2Vet — Sistema Hospitalar Veterinário</span>
    <span>Total: ${totalItens} ${totalItens === 1 ? 'alimento' : 'alimentos'}</span>
  </div>

  <script>
    window.onload = function () {
      window.print();
      window.onafterprint = function () { window.close(); };
    };
  </script>
</body>
</html>`;
}