// frontend/src/utils/EncaminhamentoPrint.ts
// Folha do ENCAMINHAMENTO — impressão e PDF (WhatsApp / e-mail).
//
// Nasceu em 2026-09-05: o encaminhamento era o último registro clínico que ainda
// saía do sistema como TEXTO colado na conversa, porque não havia folha para
// mandar. Desde 2026-09-29 o papel é a FOLHA CLÍNICA (`print/FolhaClinica.ts`):
// logo, veterinário, paciente, título, conteúdo, data e assinatura. Aqui mora só o
// CORPO — os cards de destino e motivo.
//
// ⚠️ Quem vai gerar PDF chama `prepararEncaminhamento` ANTES: é ele que resolve a
// assinatura/CRMV, o endereço da clínica e as imagens em `data:` (o Puppeteer
// bloqueia qualquer outra origem — ver printUrl.ts).
import {
  gerarHtmlFolhaClinica, prepararFolhaClinica, escFolha as esc, type AnimalFolha,
} from './print/FolhaClinica';
import { imprimirHtml } from './print/imprimirHtml';

export interface PrintAnimalEncaminhamento {
  nome:       string;
  photoUrl?:  string | null;
  raca?:      { nome: string } | null;
  especie?:   { nome: string } | null;
  user?:      { fullName: string } | null;
  idadeAnos?: number | null;
  logoUrl?:   string | null;
}

export interface PrintEncaminhamento {
  id:                 number;
  especialidade:      string;
  motivo:             string;
  destino:            string;
  /** Prestador da própria equipe × destino externo — muda o que a folha declara. */
  interno:            boolean;
  urgencia:           string;
  urgenciaLabel:      string;
  status:             string;
  statusLabel:        string;
  dataEncaminhamento: string;
  observacao:         string | null;
  veterinario:        { id?: number | null; fullName: string } | null;
}

const linhas = (v: string): string => esc(v).replace(/\n/g, '<br>');

function dataBR(iso: string): string {
  // Data PURA do calendário: lida por pedaço, nunca por `new Date().getDate()`, que
  // desloca o dia conforme o fuso (CLAUDE.md §6).
  const [ano, mes, dia] = String(iso).slice(0, 10).split('-');
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : String(iso);
}

/** Campo "Rótulo: valor" — some inteiro quando não há valor (nada de "—" inventado). */
function campo(rotulo: string, valor?: string | null): string {
  if (!valor || !String(valor).trim()) return '';
  return `<div class="campo"><span class="lbl">${esc(rotulo)}</span><span class="val">${linhas(String(valor))}</span></div>`;
}

function animalFolha(animal: PrintAnimalEncaminhamento | null): AnimalFolha | null {
  if (!animal) return null;
  return {
    nome:         animal.nome,
    photoUrl:     animal.photoUrl ?? null,
    especie:      animal.especie?.nome ?? null,
    raca:         animal.raca?.nome ?? null,
    idade:        animal.idadeAnos != null ? `${animal.idadeAnos} ano(s)` : null,
    proprietario: animal.user?.fullName ?? null,
  };
}

const CSS_MODULO = `
  .card       { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; margin-bottom: 12px; }
  .card-title { font-size: 12px; font-weight: 700; color: #374151; text-transform: uppercase;
                letter-spacing: 0.05em; margin-bottom: 10px; border-bottom: 1px solid #f3f4f6; padding-bottom: 6px; }
  .grid  { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px 20px; }
  .campo { display: flex; flex-direction: column; }
  .lbl   { font-size: 10.5px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 2px; }
  .val   { font-size: 13px; font-weight: 600; color: #111; }
  .largo { grid-column: 1 / -1; }
  .selo  { display: inline-block; padding: 1px 8px; border-radius: 999px;
           font-size: 11px; font-weight: 700; border: 1px solid #e5e7eb; color: #374151; }
`;

export function gerarHtmlEncaminhamento(
  enc:    PrintEncaminhamento,
  animal: PrintAnimalEncaminhamento | null,
): string {
  const corpo = `
  <div class="card">
    <div class="card-title">Destino</div>
    <div class="grid">
      ${campo('Especialidade', enc.especialidade)}
      ${campo('Encaminhado para', enc.destino)}
      ${campo('Tipo', enc.interno ? 'Prestador da equipe' : 'Externo')}
      ${campo('Situação', enc.statusLabel)}
    </div>
  </div>

  <div class="card">
    <div class="card-title">Motivo do encaminhamento</div>
    <div class="grid">
      ${campo('Motivo', enc.motivo) || '<div class="campo largo"><span class="val">—</span></div>'}
      ${enc.observacao ? `<div class="largo">${campo('Observações', enc.observacao)}</div>` : ''}
    </div>
  </div>`;

  const subtitulo = [
    esc(enc.especialidade),
    esc(dataBR(enc.dataEncaminhamento)),
    enc.urgencia !== 'NORMAL' ? `<span class="selo">${esc(enc.urgenciaLabel)}</span>` : '',
  ].filter(Boolean).join(' · ');

  return gerarHtmlFolhaClinica({
    documento:    `Encaminhamento${animal ? ` — ${animal.nome}` : ''}`,
    logoUrl:      animal?.logoUrl,
    profissional: enc.veterinario ? { id: enc.veterinario.id, nome: enc.veterinario.fullName } : null,
    animal:       animalFolha(animal),
    paginas:      [{ titulo: 'Encaminhamento', subtitulo, corpoHtml: corpo }],
    cssModulo:    CSS_MODULO,
  });
}

/** Resolve assinatura, endereço da clínica e imagens — obrigatório antes de gerar PDF. */
export async function prepararEncaminhamento(
  animal: PrintAnimalEncaminhamento | null,
  enc?:   PrintEncaminhamento | null,
): Promise<void> {
  await prepararFolhaClinica({
    profissionalId: enc?.veterinario?.id ?? null,
    logoUrl:        animal?.logoUrl,
    imagens:        [animal?.photoUrl],
  });
}

export async function imprimirEncaminhamento(
  enc:    PrintEncaminhamento,
  animal: PrintAnimalEncaminhamento | null,
): Promise<void> {
  await prepararEncaminhamento(animal, enc);
  imprimirHtml(gerarHtmlEncaminhamento(enc, animal));
}
