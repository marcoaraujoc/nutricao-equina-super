// frontend/src/utils/EncaminhamentoPrint.ts
// Folha do ENCAMINHAMENTO — impressão e PDF (WhatsApp / e-mail).
//
// Nasceu em 2026-09-05: o encaminhamento era o último registro clínico que ainda
// saía do sistema como TEXTO colado na conversa, porque não havia folha para
// mandar. Segue o mesmo esqueleto dos demais (`PrintShell`): cabeçalho com a logo
// da clínica, cards de conteúdo e o rodapé fixo com a assinatura do responsável.
//
// ⚠️ Toda imagem passa por `srcImpressao`, e quem vai gerar PDF chama
// `prepararEncaminhamento` ANTES: o PDF sai do Puppeteer, que BLOQUEIA qualquer
// requisição que não seja `data:` (anti-SSRF, ver printUrl.ts). Sem isso a logo
// imprime bem na tela e nasce QUEBRADA no arquivo que chega ao cliente.
import {
  PRINT_SHELL_CSS, renderCabecalho, renderRodapeAssinatura, prepararImagensImpressao,
} from './print/PrintShell';
import { imprimirHtml } from './print/imprimirHtml';

export interface PrintAnimalEncaminhamento {
  nome:       string;
  raca?:      { nome: string } | null;
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
  veterinario:        { fullName: string } | null;
}

const esc = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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

export function gerarHtmlEncaminhamento(
  enc:    PrintEncaminhamento,
  animal: PrintAnimalEncaminhamento | null,
): string {
  const idade = animal?.idadeAnos != null ? `${animal.idadeAnos} ano(s)` : null;

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Encaminhamento</title><style>
  ${PRINT_SHELL_CSS}
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 14.3px; color: #111; background: #fff; padding: 5mm 5mm 17mm; }
  .titulo { font-size: 20.8px; font-weight: 800; color: #059669; margin-bottom: 4px; }
  .sub    { font-size: 13px; color: #6b7280; margin-bottom: 14px; }
  .card       { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; margin-bottom: 12px; }
  .card-title { font-size: 13px; font-weight: 700; color: #374151; text-transform: uppercase;
                letter-spacing: 0.05em; margin-bottom: 10px; border-bottom: 1px solid #f3f4f6; padding-bottom: 6px; }
  .grid  { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px 20px; }
  .campo { display: flex; flex-direction: column; }
  .lbl   { font-size: 11.7px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 2px; }
  .val   { font-size: 14.3px; font-weight: 600; color: #111; }
  .largo { grid-column: 1 / -1; }
  .selo  { display: inline-block; padding: 2px 10px; border-radius: 999px;
           font-size: 13px; font-weight: 700; border: 1px solid #e5e7eb; color: #374151; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>
  ${renderCabecalho(animal?.logoUrl)}

  <div class="titulo">Encaminhamento</div>
  <div class="sub">${esc(enc.especialidade)} · ${esc(dataBR(enc.dataEncaminhamento))}
    ${enc.urgencia !== 'NORMAL' ? ` · <span class="selo">${esc(enc.urgenciaLabel)}</span>` : ''}</div>

  ${animal ? `
  <div class="card">
    <div class="card-title">Paciente</div>
    <div class="grid">
      ${campo('Nome', animal.nome)}
      ${campo('Raça', animal.raca?.nome)}
      ${campo('Idade', idade)}
      ${campo('Proprietário', animal.user?.fullName)}
    </div>
  </div>` : ''}

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
  </div>

  ${renderRodapeAssinatura(
    enc.veterinario ? { fullName: enc.veterinario.fullName } : null,
    'Assinatura do Veterinário Responsável',
  )}
</body></html>`;
}

/** Resolve as imagens da folha para `data:` — obrigatório antes de gerar PDF. */
export async function prepararEncaminhamento(
  animal: PrintAnimalEncaminhamento | null,
): Promise<void> {
  await prepararImagensImpressao([animal?.logoUrl]);
}

export function imprimirEncaminhamento(
  enc:    PrintEncaminhamento,
  animal: PrintAnimalEncaminhamento | null,
): void {
  imprimirHtml(gerarHtmlEncaminhamento(enc, animal));
}
