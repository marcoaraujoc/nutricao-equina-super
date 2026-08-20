// frontend/src/utils/print/PrintShell.ts
// Peças de impressão/PDF compartilhadas por TODOS os documentos da aplicação:
// cabeçalho (marca + data de emissão), CSS base A4 e rodapé fixo que repete em
// toda página impressa (marca do produto à esquerda, assinatura do
// profissional responsável centralizada). Todo utilitário de impressão/PDF
// novo usa isto — não duplicar cabeçalho/rodapé/CSS de página.

import { resolverUrlAbsoluta } from '../printUrl';

export interface PrintShellUser {
  fullName?: string | null;
  email?: string | null;
}

// ── CSS base — cabeçalho, página A4 e rodapé fixo ──────────────────────────────
export const PRINT_SHELL_CSS = `
  @page { size: A4; margin: 5mm 5mm 15mm; }

  .ps-sys-header {
    display: flex; justify-content: space-between; align-items: flex-start;
    border-bottom: 2pt solid #059669; padding-bottom: 10pt; margin-bottom: 18pt;
  }
  .ps-sys-name   { font-size: 22pt; font-weight: 700; color: #059669; line-height: 1; }
  .ps-brand-logo { max-height: 28pt; max-width: 160pt; object-fit: contain; }
  .ps-sys-date   { font-size: 9pt;  color: #9ca3af; text-align: right; line-height: 1.7; }

  /* ── Rodapé administrativo simples (sem assinatura) ── */
  .ps-footer {
    margin-top: 20pt; padding-top: 8pt;
    border-top: 0.5pt solid #e5e7eb;
    font-size: 8pt; color: #9ca3af;
    text-align: right;
  }

  /* ── Rodapé fixo com assinatura — repete no rodapé de toda página impressa ── */
  .ps-signature {
    position: fixed; left: 0; right: 0; bottom: 0;
    padding: 0 5mm 2mm;
    display: grid; grid-template-columns: 1fr auto 1fr; align-items: flex-end;
  }
  .ps-sig-brand { font-size: 7pt; color: #9ca3af; text-align: left; }
  .ps-sig-block { width: 85mm; text-align: center; }
  .ps-sig-line  { border-top: 0.8pt solid #111; margin-bottom: 3pt; }
  .ps-sig-label { font-size: 8pt;   color: #374151; line-height: 1.2; }
  .ps-sig-name  { font-size: 8.5pt; font-weight: 600; color: #111; margin-top: 1pt; line-height: 1.2; }
`;

// ── Cabeçalho: logo da empresa (ou marca S2Vet) + data/hora de emissão ────────
export function renderCabecalho(logoUrlBruto?: string | null): string {
  const logoUrl = resolverUrlAbsoluta(logoUrlBruto);
  const agora = new Date();
  const dataEmissao = agora.toLocaleDateString('pt-BR');
  const horaEmissao = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `
  <div class="ps-sys-header">
    <div>
      ${logoUrl ? `<img class="ps-brand-logo" src="${logoUrl}" alt="Logo">` : `<div class="ps-sys-name">S2Vet</div>`}
    </div>
    <div class="ps-sys-date">
      Emitido em ${dataEmissao}<br>às ${horaEmissao}
    </div>
  </div>`;
}

// ── Rodapé com assinatura — documentos CLÍNICOS (evolução, prescrição, vacina,
//    exame, encaminhamento, dieta...). Fixo: repete em toda página impressa.
export function renderRodapeAssinatura(
  user?: PrintShellUser | null,
  rotulo = 'Assinatura do Veterinário Responsável',
): string {
  return `
  <div class="ps-signature">
    <div class="ps-sig-brand">S2Vet — Sistema Hospitalar Veterinário</div>
    <div class="ps-sig-block">
      <div class="ps-sig-line"></div>
      <div class="ps-sig-label">${rotulo}</div>
      ${user?.fullName ? `<div class="ps-sig-name">${user.fullName}</div>` : ''}
    </div>
  </div>`;
}

// ── Rodapé simples, sem assinatura — documentos ADMINISTRATIVOS/financeiros
//    (fatura, orçamento) não têm assinatura de profissional.
export function renderRodapeSimples(textoDireita: string): string {
  return `
  <div class="ps-footer">
    <span>${textoDireita}</span>
  </div>`;
}
