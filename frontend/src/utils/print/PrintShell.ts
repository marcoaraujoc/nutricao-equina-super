// frontend/src/utils/print/PrintShell.ts
// Peças de impressão/PDF compartilhadas por TODOS os documentos da aplicação:
// cabeçalho (marca + data de emissão), CSS base A4 e rodapé fixo que repete em
// toda página impressa (marca do produto à esquerda, assinatura do
// profissional responsável centralizada). Todo utilitário de impressão/PDF
// novo usa isto — não duplicar cabeçalho/rodapé/CSS de página.

import { resolverUrlAbsoluta, carregarComoDataUri } from '../printUrl';

// ── Imagens da folha (logo, assinatura, foto do paciente) ────────────────────
//
// 🔴 O MESMO HTML percorre DOIS caminhos: a impressão do navegador (tem rede e
// cookie de sessão, então `<img src="/api/midia/…">` carrega) e o PDF do
// SERVIDOR (Puppeteer, usado pelo envio por WhatsApp/e-mail), que BLOQUEIA toda
// requisição que não seja `data:` — proteção contra SSRF, ver printUrl.ts. Sem
// isto a logo e a assinatura imprimem bem na tela e nascem QUEBRADAS no PDF.
//
// Quem vai gerar PDF chama `prepararImagensImpressao([...])` ANTES de montar o
// HTML; os geradores continuam SÍNCRONOS e apenas consultam `srcImpressao`, que
// usa o `data:` quando existe e cai na URL absoluta quando não existe.
const imagensResolvidas = new Map<string, string>();

/** Resolve as URLs para `data:` e guarda em cache. Nunca lança. */
export async function prepararImagensImpressao(
  urls: Array<string | null | undefined>,
): Promise<void> {
  const pendentes = Array.from(new Set(
    urls.filter((u): u is string => !!u && !u.startsWith('data:') && !imagensResolvidas.has(u)),
  ));
  if (pendentes.length === 0) return;
  await Promise.all(pendentes.map(async (u) => {
    const dataUri = await carregarComoDataUri(u);
    if (dataUri) imagensResolvidas.set(u, dataUri);
  }));
}

/** `src` de uma imagem da folha: `data:` quando já resolvido, senão URL absoluta. */
export function srcImpressao(url: string | null | undefined): string | null {
  if (!url) return null;
  return imagensResolvidas.get(url) ?? resolverUrlAbsoluta(url);
}

export interface PrintShellUser {
  fullName?: string | null;
  email?: string | null;
}

// ── CSS base — cabeçalho, página A4 e rodapé fixo ──────────────────────────────
export const PRINT_SHELL_CSS = `
  /* 🔴 MARGEM DE DOCUMENTO, NAO DE FORMULARIO. Era 5mm/5mm/15mm e, somada ao
     padding lateral do body de cada gerador (mais 5mm), deixava a MANCHA DE TEXTO
     com 190mm de largura numa folha de 210mm. Com o corpo em ~7,5pt isso da ~140
     caracteres por linha - o dobro do confortavel (65-75) - e a folha "parece um
     A5 deitado" (relatado em 2026-09-05): texto miudo espalhado de borda a borda.
     Medido na prescricao real, antes: mancha 190mm, margens esq 10,0 / dir 10,2mm.
     ATENCAO: a base (20mm) nao e estetica. .ps-signature e position:fixed;bottom:0
     e ocupa o pe de TODA pagina impressa; quem reserva o espaco para ela e o
     padding-bottom do body de cada gerador. Encurtar um sem o outro faz o texto
     passar por baixo da assinatura. */
  @page { size: A4; margin: 12mm 14mm 20mm; }

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

  /* ── Bloco de assinatura NO CORPO da folha (não é o rodapé fixo) ── */
  .ps-assinaturas   { margin-top: 34px; display: flex; justify-content: space-around; gap: 24px; page-break-inside: avoid; }
  .ps-assin         { width: 220px; text-align: center; }
  /* A caixa da imagem tem altura FIXA e existe mesmo sem assinatura cadastrada:
     é o espaço para assinar à mão, e sem ele as linhas de dois assinantes ficariam
     em alturas diferentes quando só um tem assinatura digitalizada. */
  .ps-assin-img-box { height: 46px; display: flex; align-items: flex-end; justify-content: center; }
  .ps-assin-img     { max-height: 46px; max-width: 210px; object-fit: contain; }
  .ps-assin-linha   { border-top: 1px solid #374151; padding-top: 5px; }
  .ps-assin-nome    { font-size: 10px; font-weight: 600; color: #374151; }
  .ps-assin-cargo   { font-size: 9px; color: #9ca3af; margin-top: 1px; }
  .ps-assin-crmv    { font-size: 9px; color: #6b7280; margin-top: 1px; }
`;

// ── Cabeçalho: logo da empresa (ou marca S2Vet) + data/hora de emissão ────────
export function renderCabecalho(logoUrlBruto?: string | null): string {
  const logoUrl = srcImpressao(logoUrlBruto);
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

// ── Bloco de assinatura no CORPO da folha ────────────────────────────────────
//
// 🔴 A imagem da assinatura é de QUEM ASSINA AQUELA LINHA, nunca "a do usuário
// logado". Espelha a regra do bloco `assinatura` da Central de Documentos
// (catalogo.ts#assinaturaDoVeterinario): carimbar a assinatura escaneada do
// veterinário na linha do executor/proprietário produz documento FALSO.
// Sem assinatura cadastrada sobra o espaço em branco para assinar à mão — nunca
// se desenha uma assinatura que não existe.
export interface BlocoAssinatura {
  /** Nome impresso sob a linha. Vazio = linha em branco (para preencher à mão). */
  nome?:          string | null;
  /** Papel de quem assina: "Médico Veterinário Responsável", "Executor"… */
  cargo:          string;
  /** Imagem da assinatura escaneada DESTA pessoa (ver srcImpressao/prepararImagensImpressao). */
  assinaturaUrl?: string | null;
  /** CRMV — só faz sentido na linha do veterinário. */
  crmv?:          string | null;
}

function escHtml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// O CRMV é cadastrado JÁ com o prefixo na maioria das bases ("CRMV-SP 12345",
// que é o exemplo do catálogo de variáveis). Prefixar sempre produziria
// "CRMV CRMV-SP 12345" no papel.
function rotuloCrmv(crmv: string): string {
  return /^crmv/i.test(crmv.trim()) ? crmv.trim() : `CRMV ${crmv.trim()}`;
}

export function renderAssinaturas(blocos: BlocoAssinatura[]): string {
  if (blocos.length === 0) return '';
  return `
  <div class="ps-assinaturas">
    ${blocos.map(b => {
      const img = srcImpressao(b.assinaturaUrl);
      return `
      <div class="ps-assin">
        <div class="ps-assin-img-box">${img ? `<img class="ps-assin-img" src="${img}" alt="">` : ''}</div>
        <div class="ps-assin-linha">
          ${b.nome ? `<div class="ps-assin-nome">${escHtml(b.nome)}</div>` : '<div class="ps-assin-nome">&nbsp;</div>'}
          <div class="ps-assin-cargo">${escHtml(b.cargo)}</div>
          ${b.crmv ? `<div class="ps-assin-crmv">${escHtml(rotuloCrmv(b.crmv))}</div>` : ''}
        </div>
      </div>`;
    }).join('')}
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
