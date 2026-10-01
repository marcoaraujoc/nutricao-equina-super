// frontend/src/utils/EvolucaoPrint.ts
// Folha da EVOLUÇÃO CLÍNICA. Desde 2026-09-29 o papel é a FOLHA CLÍNICA
// (`print/FolhaClinica.ts`: logo, veterinário, paciente, título, conteúdo, data e
// assinatura); aqui mora só o CORPO — os dados do atendimento, o texto e as mídias.

import { srcImpressao } from './print/PrintShell';
import { gerarHtmlFolhaClinica, prepararFolhaClinica, type AnimalFolha } from './print/FolhaClinica';
import { imprimirHtml } from './print/imprimirHtml';

export interface PrintAnimal {
  nome:      string;
  photoUrl?: string | null;
  raca?:     { nome: string } | null;
  especie?:  { nome: string } | null;
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
  /** `id` habilita CRMV e assinatura de quem conduziu o atendimento. */
  veterinario:     { id?: number | null; fullName: string };
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

function animalFolha(animal: PrintAnimal | null): AnimalFolha | null {
  if (!animal) return null;
  return {
    nome:         animal.nome,
    photoUrl:     animal.photoUrl ?? null,
    especie:      animal.especie?.nome ?? null,
    raca:         animal.raca?.nome ?? null,
    idade:        animal.idadeAnos != null ? `${animal.idadeAnos} anos` : null,
    proprietario: animal.user?.fullName ?? null,
  };
}

// ─── Gerador de HTML ──────────────────────────────────────────────────────────

export function gerarHtmlEvolucao(
  ev:     PrintEvolucao,
  animal: PrintAnimal | null,
): string {
  const statusLabel = STATUS_LABEL[ev.status] ?? ev.status;
  const statusColor = STATUS_COLOR[ev.status] ?? '#6b7280';
  const statusBg    = STATUS_BG[ev.status]    ?? '#f3f4f6';

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
            <img src="${srcImpressao(m.url) ?? ''}" alt="${escaparHtml(m.nome)}" class="media-img" />
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

  const corpo = `
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
  ${audiosHtml}`;

  const cssModulo = `
    .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px 16px; margin-bottom: 14px; }
    .card-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 16px; align-items: start; }
    .lbl { display: block; font-size: 10.5px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px; }
    .val { font-size: 13.5px; font-weight: 600; color: #111; }
    .evolucao-titulo { font-size: 16px; font-weight: 700; color: #111; margin-bottom: 8px; }
    .badge {
      display: inline-block; padding: 2px 10px; border-radius: 20px;
      font-size: 12px; font-weight: 700; color: ${statusColor}; background: ${statusBg};
    }
    .texto {
      white-space: pre-wrap; font-size: 13.5px; line-height: 1.7;
      border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; margin-top: 12px; background: #fafafa;
    }
    .section-title { font-size: 12px; font-weight: 700; color: #374151; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
    .media-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .media-item { text-align: center; }
    .media-img { width: 100%; max-height: 130px; object-fit: cover; border-radius: 6px; border: 1px solid #e5e7eb; }
    .media-nome { font-size: 10.5px; color: #6b7280; margin-top: 3px; word-break: break-all; }
    .obs { font-size: 10.5px; color: #9ca3af; font-style: italic; margin-top: 4px; }
  `;

  return gerarHtmlFolhaClinica({
    documento:    `Evolução Clínica${animal ? ` — ${animal.nome}` : ''}`,
    logoUrl:      animal?.logoUrl,
    profissional: { id: ev.veterinario.id, nome: ev.veterinario.fullName },
    animal:       animalFolha(animal),
    paginas:      [{ titulo: 'Evolução Clínica', subtitulo: escaparHtml(fmt(ev.dataInicio)), corpoHtml: corpo }],
    cssModulo,
    rodape:       `Evolução #${ev.id}`,
  });
}

// ─── Função principal ─────────────────────────────────────────────────────────

/**
 * Resolve o que a folha precisa ANTES de gerar o HTML: CRMV/assinatura de quem
 * conduziu, endereço da clínica e as imagens (logo, foto, mídias) em `data:`.
 * 🔴 Obrigatório em quem vai mandar a folha por WhatsApp/e-mail: o PDF sai do
 * Puppeteer, que BLOQUEIA toda requisição que não seja `data:` (ver printUrl.ts).
 */
export async function prepararEvolucao(
  ev:     PrintEvolucao,
  animal: PrintAnimal | null,
): Promise<void> {
  await prepararFolhaClinica({
    profissionalId: ev.veterinario.id ?? null,
    logoUrl:        animal?.logoUrl,
    imagens: [
      animal?.photoUrl,
      ...(ev.midias ?? []).filter(m => m.tipo === 'IMAGEM').map(m => m.url),
    ],
  });
}

export async function imprimirEvolucao(
  ev:     PrintEvolucao,
  animal: PrintAnimal | null,
): Promise<void> {
  await prepararEvolucao(ev, animal);
  imprimirHtml(gerarHtmlEvolucao(ev, animal));
}
