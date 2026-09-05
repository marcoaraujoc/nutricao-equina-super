// frontend/src/utils/EvolucaoPrint.ts
// Utilitário de impressão para Evolução Clínica — segue o padrão de Dietaprint.ts

import { PRINT_SHELL_CSS, renderCabecalho, renderRodapeAssinatura } from './print/PrintShell';
import { imprimirHtml } from './print/imprimirHtml';

export interface PrintAnimal {
  nome:      string;
  photoUrl?: string | null;
  raca?:     { nome: string } | null;
  user?:     { fullName: string } | null;
  idadeAnos?: number | null;
  logoUrl?:  string | null;
}

export interface PrintEvolucaoMidia {
  id:   number;
  tipo: 'IMAGEM' | 'VIDEO' | 'AUDIO';
  url:  string;
  nome: string;
}

export interface PrintEvolucao {
  id:              number;
  especialidade:   string;
  status:          'EM_ANDAMENTO' | 'FINALIZADA' | 'CANCELADA';
  titulo?:         string | null;
  texto:           string;
  dataInicio:      string;
  dataFim?:        string | null;
  dataModificacao?: string | null;
  veterinario:     { fullName: string };
  modificadoPor?:  { fullName: string } | null;
  midias?:         PrintEvolucaoMidia[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  EM_ANDAMENTO: 'Em Andamento',
  FINALIZADA:   'Finalizada',
  CANCELADA:    'Cancelada',
};

const STATUS_COLOR: Record<string, string> = {
  EM_ANDAMENTO: '#1d4ed8',
  FINALIZADA:   '#059669',
  CANCELADA:    '#dc2626',
};

const STATUS_BG: Record<string, string> = {
  EM_ANDAMENTO: '#dbeafe',
  FINALIZADA:   '#d1fae5',
  CANCELADA:    '#fee2e2',
};

function fmt(data: string | null | undefined): string {
  if (!data) return '—';
  const d = new Date(data);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtData(data: string | null | undefined): string {
  if (!data) return '—';
  const d = new Date(data);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function escaparHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Gerador de HTML ──────────────────────────────────────────────────────────

export function gerarHtmlEvolucao(
  ev:     PrintEvolucao,
  animal: PrintAnimal | null,
): string {
  const statusLabel = STATUS_LABEL[ev.status] ?? ev.status;
  const statusColor = STATUS_COLOR[ev.status] ?? '#6b7280';
  const statusBg    = STATUS_BG[ev.status]    ?? '#f3f4f6';

  const animalSection = animal ? `
    <div class="card">
      <div class="card-grid">
        ${animal.photoUrl ? `
          <div class="animal-photo-wrap" style="grid-row:1/3">
            <img src="${animal.photoUrl}" alt="${escaparHtml(animal.nome)}" class="animal-photo" />
          </div>
        ` : ''}
        <div><span class="lbl">Animal</span><span class="val">${escaparHtml(animal.nome)}</span></div>
        <div><span class="lbl">Raça</span><span class="val">${animal.raca?.nome ?? '—'}</span></div>
        <div><span class="lbl">Idade</span><span class="val">${animal.idadeAnos != null ? `${animal.idadeAnos} anos` : '—'}</span></div>
        <div><span class="lbl">Proprietário</span><span class="val">${animal.user?.fullName ?? '—'}</span></div>
      </div>
    </div>
  ` : '';

  const midias = ev.midias ?? [];
  const imagens = midias.filter(m => m.tipo === 'IMAGEM');
  const videos  = midias.filter(m => m.tipo === 'VIDEO');
  const audios  = midias.filter(m => m.tipo === 'AUDIO');

  const imagensHtml = imagens.length > 0 ? `
    <div class="card">
      <div class="section-title">Imagens</div>
      <div class="media-grid">
        ${imagens.map(m => `
          <div class="media-item">
            <img src="${m.url}" alt="${escaparHtml(m.nome)}" class="media-img" />
            <p class="media-nome">${escaparHtml(m.nome)}</p>
          </div>
        `).join('')}
      </div>
    </div>
  ` : '';

  const videosHtml = videos.length > 0 ? `
    <div class="card">
      <div class="section-title">Vídeos</div>
      ${videos.map(m => `
        <p class="media-nome">🎬 ${escaparHtml(m.nome)}</p>
      `).join('')}
      <p class="obs">Vídeos não são exibidos na impressão.</p>
    </div>
  ` : '';

  const audiosHtml = audios.length > 0 ? `
    <div class="card">
      <div class="section-title">Áudios</div>
      ${audios.map(m => `
        <p class="media-nome">🎵 ${escaparHtml(m.nome)}</p>
      `).join('')}
      <p class="obs">Áudios não são exibidos na impressão.</p>
    </div>
  ` : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Evolução Clínica — S2Vet</title>
  <style>
    ${PRINT_SHELL_CSS}
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 15.6px; color: #111; background: #fff; padding: 5mm 5mm 17mm; }

    /* Cards */
    .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px 16px; margin-bottom: 14px; }
    .card-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 16px; align-items: start; }

    /* Labels e valores */
    .lbl { display: block; font-size: 11.7px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px; }
    .val { font-size: 15.6px; font-weight: 600; color: #111; }

    /* Animal photo */
    .animal-photo-wrap { display: flex; align-items: center; justify-content: center; }
    .animal-photo { width: 72px; height: 72px; object-fit: cover; border-radius: 8px; border: 1px solid #e5e7eb; }

    /* Título da evolução */
    .evolucao-titulo { font-size: 19.5px; font-weight: 700; color: #111; margin-bottom: 8px; }

    /* Status badge */
    .badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 700;
      color: ${statusColor};
      background: ${statusBg};
    }

    /* Texto da evolução */
    .texto {
      white-space: pre-wrap;
      font-size: 15.6px;
      line-height: 1.8;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 14px;
      margin-top: 12px;
      background: #fafafa;
    }

    /* Seções de mídia */
    .section-title { font-size: 14.3px; font-weight: 700; color: #374151; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
    .media-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .media-item { text-align: center; }
    .media-img { width: 100%; max-height: 130px; object-fit: cover; border-radius: 6px; border: 1px solid #e5e7eb; }
    .media-nome { font-size: 11.7px; color: #6b7280; margin-top: 3px; word-break: break-all; }
    .obs { font-size: 11.7px; color: #9ca3af; font-style: italic; margin-top: 4px; }

    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>

  ${renderCabecalho(animal?.logoUrl)}

  ${animalSection}

  <div class="card">
    ${ev.titulo ? `<p class="evolucao-titulo">${escaparHtml(ev.titulo)}</p>` : ''}
    <div class="card-grid">
      <div>
        <span class="lbl">Especialidade</span>
        <span class="val">${escaparHtml(ev.especialidade)}</span>
      </div>
      <div>
        <span class="lbl">Status</span>
        <span class="badge">${statusLabel}</span>
      </div>
      <div>
        <span class="lbl">Data de Início</span>
        <span class="val">${fmt(ev.dataInicio)}</span>
      </div>
      ${ev.dataFim ? `
      <div>
        <span class="lbl">Data de Fim</span>
        <span class="val">${fmt(ev.dataFim)}</span>
      </div>` : ''}
      <div>
        <span class="lbl">Veterinário Responsável</span>
        <span class="val">${escaparHtml(ev.veterinario.fullName)}</span>
      </div>
      ${ev.modificadoPor && ev.modificadoPor.fullName !== ev.veterinario.fullName ? `
      <div>
        <span class="lbl">Modificado por</span>
        <span class="val">${escaparHtml(ev.modificadoPor.fullName)}</span>
      </div>
      ${ev.dataModificacao ? `
      <div>
        <span class="lbl">Data Modificação</span>
        <span class="val">${fmtData(ev.dataModificacao)}</span>
      </div>` : ''}` : ''}
    </div>
    <div class="texto">${escaparHtml(ev.texto)}</div>
  </div>

  ${imagensHtml}
  ${videosHtml}
  ${audiosHtml}

  <div class="ps-footer">
    <span>Evolução #${ev.id}</span>
  </div>

  ${renderRodapeAssinatura({ fullName: ev.veterinario.fullName })}

</body>
</html>`;
}

// ─── Função principal ─────────────────────────────────────────────────────────

export function imprimirEvolucao(
  ev:     PrintEvolucao,
  animal: PrintAnimal | null,
): void {
  imprimirHtml(gerarHtmlEvolucao(ev, animal));
}