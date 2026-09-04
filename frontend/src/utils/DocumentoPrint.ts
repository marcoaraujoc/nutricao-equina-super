// frontend/src/utils/DocumentoPrint.ts
// Impressão e PDF de um DOCUMENTO EMITIDO da Central de Documentos.
//
// O emitido é um SNAPSHOT: o backend já resolveu as variáveis (`{{animal.nome}}`) e
// as lacunas (`[[Tatuagem]]`) na hora da emissão e gravou o RESULTADO em `blocos`.
// Aqui não se resolve nada — só se desenha o que foi gravado. É isso que faz
// reimprimir daqui a dois anos devolver exatamente o papel que o cliente recebeu,
// mesmo que o modelo tenha sido reescrito desde então.
//
// ⚠️ Este arquivo é o espelho de `modules/documentos/BlocoView.tsx` em HTML string.
// Não dá para reusar o componente React: o PDF do backend (Puppeteer) e a impressão
// por iframe recebem uma STRING, não um DOM montado. Ao mexer no visual de um bloco,
// mexa nos dois.
//
// ⚠️ NADA de `{{` ou `[[` chega aqui. Se chegar, é bug do backend (snapshot gravado
// sem resolver) — e imprimir a chave crua no papel é pior do que imprimir vazio, por
// isso `limpar()` remove o que sobrar em vez de deixar passar.

import { imprimirHtml } from './print/imprimirHtml';
import { resolverUrlAbsoluta } from './printUrl';
import { assinaturaDoVeterinario } from '../modules/documentos/catalogo';
import { prepararFolha, cabecalhoVazio } from '../modules/documentos/cabecalho';
import { semBlocosVazios } from '../modules/documentos/vazios';
import type { DadosCabecalho } from '../modules/documentos/cabecalho';
import type { Bloco, DocumentoEmitido, MarcaDocumentoEmitido } from '../modules/documentos/types';

/**
 * URLs de imagem já convertidas em `data:` URI.
 *
 * POR QUÊ: o gerador de PDF do backend (Puppeteer) BLOQUEIA toda requisição que não
 * seja `data:` — proteção contra SSRF, já que o HTML carrega dado de tenant. Uma
 * `<img src="/api/midia/...">` imprime perfeitamente no navegador (tem sessão) e
 * nasce QUEBRADA no PDF do servidor. Resolvendo antes, a MESMA string serve aos dois.
 * Ver `utils/printUrl.ts#carregarComoDataUri`.
 */
export type ImagensDocumento = Record<string, string>;

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Rede de segurança: chave não resolvida nunca vai para o papel. */
const limpar = (v: unknown): string =>
  String(v ?? '').replace(/\{\{[^}]*\}\}/g, '').replace(/\[\[[^\]]*\]\]/g, '');

const texto = (v: unknown): string => esc(limpar(v));

/** Preserva as quebras de linha do que o vet digitou. */
const textoMultilinha = (v: unknown): string => texto(v).replace(/\n/g, '<br>');

/** `data:` URI quando houver; senão a URL absoluta (serve à impressão no navegador). */
const src = (url: string | null | undefined, imagens?: ImagensDocumento): string | null => {
  if (!url) return null;
  return imagens?.[url] ?? resolverUrlAbsoluta(url);
};

// ─── Estilo de um bloco ──────────────────────────────────────────────────────

const PESO: Record<string, number> = { bold: 700, semibold: 600, medium: 500, normal: 400 };

function estiloDe(b: Bloco): string {
  const e = b.estilo ?? {};
  const p: string[] = [];
  if (e.tamanho)         p.push(`font-size:${e.tamanho}px`);
  p.push(`font-weight:${PESO[e.peso ?? 'normal'] ?? 400}`);
  p.push(`color:${e.cor ?? '#111827'}`);
  if (e.alinhamento)     p.push(`text-align:${e.alinhamento}`);
  if (e.espacamentoTopo) p.push(`margin-top:${e.espacamentoTopo}px`);
  if (e.espacamentoBase) p.push(`margin-bottom:${e.espacamentoBase}px`);
  if (e.largura)         p.push(`width:${e.largura}%`);
  // DUAS COLUNAS — espelho de `BlocoView.estiloDe`. Ao mexer num, mexa no outro.
  if (e.colunas && e.colunas > 1) {
    p.push('display:inline-block', 'vertical-align:top',
           `width:${100 / e.colunas}%`, 'padding-right:12px', 'box-sizing:border-box');
  }
  return p.join(';');
}

function tabela(b: Bloco, colunas: string[], linhas: string[][]): string {
  const completa = b.estilo?.borda === 'completa';
  const cel = `padding:4px 6px;text-align:left;${completa ? 'border:1px solid #d1d5db' : 'border-bottom:1px solid #e5e7eb'}`;
  const th  = `${cel};font-weight:600;${completa ? 'background:#f9fafb' : ''}`;
  const cabecalho = colunas.map(c => `<th style="${th}">${texto(c)}</th>`).join('');
  const corpo = linhas.map(l =>
    `<tr>${colunas.map((_, j) => `<td style="${cel}">${texto(l[j]) || '&nbsp;'}</td>`).join('')}</tr>`).join('');
  return `<table style="width:100%;border-collapse:collapse;font-size:${b.estilo?.tamanho ?? 11}px">`
       + `<thead><tr>${cabecalho}</tr></thead><tbody>${corpo}</tbody></table>`;
}

// ─── Um bloco ────────────────────────────────────────────────────────────────

function blocoParaHtml(b: Bloco, marca: MarcaDocumentoEmitido | null, imagens?: ImagensDocumento): string {
  if (!b?.visivel) return '';
  const st = estiloDe(b);
  const c  = b.conteudo ?? {};

  switch (b.tipo) {
    case 'titulo':
      return `<h1 style="${st};letter-spacing:.02em">${texto(c.texto)}</h1>`;

    case 'subtitulo': {
      const linhaBaixo = b.estilo?.borda === 'inferior'
        ? 'border-bottom:1px solid #e5e7eb;padding-bottom:3px' : '';
      return `<h2 style="${st};${linhaBaixo}">${texto(c.texto)}</h2>`;
    }

    case 'texto':
      return `<p style="${st}">${textoMultilinha(c.texto)}</p>`;

    case 'linha':
      return `<hr style="${st};border:0;border-top:1px solid #e5e7eb">`;

    case 'campoAuto': {
      // O backend gravou o valor em `texto` e PRESERVOU a chave em `variavel` — é o
      // que permite auditar de qual variável saiu cada valor do papel. Sem valor,
      // sai o traço: o campo em branco para preencher à mão, como o papel sempre teve.
      const valor = texto(c.texto);
      const traco = '<span style="display:inline-block;min-width:110px;border-bottom:1px solid #9ca3af">&nbsp;</span>';
      return `<p style="${st}"><span style="color:#6b7280">${texto(c.rotulo)}: </span>`
           + `${valor ? `<span style="font-weight:600">${valor}</span>` : traco}</p>`;
    }

    case 'imagem': {
      const url = src(c.url, imagens);
      // Sem imagem não sai nada: a moldura tracejada é andaime do editor, não papel.
      if (!url) return '';
      // `altura: 0` = ALTURA AUTOMÁTICA (documento ENVIADO pela clínica, em que a
      // imagem É a folha). Espelha `BlocoView` — ⚠️ `?? 160` não serve, `0` não é
      // nullish e viraria uma imagem de zero pixel no papel.
      const altura = b.estilo?.altura ? `${b.estilo.altura}px` : 'auto';
      return `<div style="${st};text-align:${b.estilo?.alinhamento ?? 'center'}">`
           + `<img src="${esc(url)}" alt="${texto(c.rotulo)}" style="max-width:100%;height:${altura};object-fit:contain"></div>`;
    }

    case 'checklist':
      return `<ul style="${st};list-style:none;padding:0;margin:0">${(c.itens ?? []).map(i =>
        `<li style="display:flex;gap:6px;align-items:flex-start;margin-bottom:4px">`
        + `<span style="width:11px;height:11px;border:1px solid #9ca3af;border-radius:2px;flex-shrink:0;margin-top:2px"></span>`
        + `<span>${texto(i)}</span></li>`).join('')}</ul>`;

    // Tabela fixa e listas clínicas caem no mesmo desenho: no emitido só existe o que
    // o snapshot gravou. A nota "preenchido na emissão" do editor NÃO sai no papel —
    // aqui a emissão já aconteceu.
    case 'tabela':
    case 'tabelaDinamica':
    case 'medicamentos':
    case 'vacinas':
    case 'procedimentos':
    case 'exames':
      return `<div style="${st}">${tabela(b, c.colunas ?? [], c.linhas ?? [])}</div>`;

    case 'observacoes':
      return `<div style="${st}">`
           + `<p style="font-size:10px;color:#6b7280;margin:0 0 3px">${texto(c.rotulo) || 'Observações'}</p>`
           + `<div style="min-height:${b.estilo?.altura ?? 90}px;border:1px solid #d1d5db;border-radius:6px;padding:8px">${textoMultilinha(c.texto)}</div>`
           + `</div>`;

    case 'assinatura': {
      // 🔴 Espelho da regra de `BlocoView`: a identidade da marca (imagem da
      // assinatura, nome e CRMV) só entra na linha DO VETERINÁRIO. Farmacêutico,
      // comprador e responsável assinam à mão — a linha sai vazia, com o papel
      // embaixo. Ver `assinaturaDoVeterinario`.
      const doVet  = assinaturaDoVeterinario(c);
      const img    = doVet ? src(marca?.assinaturaUrl, imagens) : '';
      const centro = b.estilo?.alinhamento === 'left' ? '0' : '0 auto';
      const crmv   = texto(marca?.crmv);
      const nome   = doVet ? texto(marca?.assinanteNome) : '';
      // A imagem fica SOBRE a linha. Sem assinatura cadastrada sobra o espaço em
      // branco para assinar à mão — nunca se desenha assinatura que não existe.
      return `<div style="${st};text-align:${b.estilo?.alinhamento ?? 'center'};margin-top:${b.estilo?.espacamentoTopo ?? 30}px">`
           + `<div style="width:240px;margin:${centro}">`
           + `<div style="height:42px;display:flex;align-items:flex-end;justify-content:center">`
           + `${img ? `<img src="${esc(img)}" alt="" style="max-height:42px;max-width:240px;object-fit:contain">` : ''}</div>`
           + `<div style="border-top:1px solid #374151;padding-top:4px">`
           + `${nome ? `<p style="font-size:11px;font-weight:600;margin:0">${nome}</p>` : ''}`
           + `<p style="font-size:10px;color:#6b7280;margin:0">${texto(c.rotulo)}</p>`
           + `${doVet && c.mostrarCrmv && crmv ? `<p style="font-size:10px;color:#6b7280;margin:0">${crmv}</p>` : ''}`
           + `</div></div></div>`;
    }

    case 'rodape':
      return `<p style="${st};border-top:1px solid #e5e7eb;padding-top:6px">${textoMultilinha(c.texto)}</p>`;

    // `qrcode` e `linhaTempo` são placeholders GRÁFICOS do editor (o QR de validação
    // ainda não tem rota pública — ver §12). Não imprimem nada, em vez de imprimir um
    // enfeite que finge ser um código verificável.
    default:
      return '';
  }
}

// ─── Documento inteiro ───────────────────────────────────────────────────────

/**
 * Cabeçalho padrão da folha — espelho em STRING de
 * `modules/documentos/CabecalhoFolha.tsx`. A REGRA (o que entra, em que ordem, o que
 * some vazio) é a mesma para os dois: `modules/documentos/cabecalho.ts`.
 */
function cabecalhoHtml(c: DadosCabecalho, imagens?: ImagensDocumento): string {
  if (cabecalhoVazio(c)) return '';
  const logo = src(c.logoUrl, imagens);
  const marca = logo
    ? `<img class="doc-logo" src="${esc(logo)}" alt="">`
    : c.empresaNome
      ? `<p style="font-size:14px;font-weight:700;margin:0">${texto(c.empresaNome)}</p>`
      : '';
  // Título CENTRALIZADO na folha (a pedido, 2026-09-03); a logo segue à esquerda.
  const titulo = c.titulo
    ? `<h1 style="font-size:17px;font-weight:700;letter-spacing:.02em;margin:10px 0 0;text-align:center">${texto(c.titulo)}</h1>`
    : '';
  return `<header class="doc-cabecalho">${marca}${titulo}</header>`;
}

/**
 * QUANTAS VIAS o documento manda imprimir, e de quem é cada uma.
 *
 * 🔴 A REGRA SAI DO PRÓPRIO PAPEL, não de uma configuração à parte: os 12 modelos do
 * CFMV trazem no rodapé, porque a Res. 1.321/2020 exige, "Emitir em 2 vias: 1ª via
 * médico(a) veterinário(a); 2ª via proprietário(a), tutor(a)/responsável." Ler dali é
 * o que faz um modelo da clínica que escreva o mesmo ganhar as duas vias sozinho — e
 * o que impede um documento que NÃO pede duas de sair duplicado.
 *
 * ⚠️ Teto de 4: o número vem de texto livre, e "em 20 vias" (erro de digitação, ou um
 * "20 vias" que era outra coisa na frase) mandaria 20 páginas para a impressora.
 * ⚠️ Sem o padrão, UMA via — nunca duas "por precaução": papel a mais é papel que
 * alguém precisa conferir e descartar.
 */
export function viasDoDocumento(blocos: Bloco[]): { rotulo: string }[] {
  const texto = (Array.isArray(blocos) ? blocos : [])
    .map(b => String(b?.conteudo?.texto ?? ''))
    .join(' ');

  const m = texto.match(/em\s+(\d{1,2})\s+vias?/i);
  const n = m ? Math.min(Math.max(Number(m[1]), 1), 4) : 1;
  if (n < 2) return [{ rotulo: '' }];

  // "1ª via médico(a) veterinário(a)" → o selo diz de quem é a folha na mão.
  const deQuem = (i: number): string => {
    const r = new RegExp(`${i}\\s*[ªa]\\s*via[:\\s]+([^;.]{2,60})`, 'i');
    return (texto.match(r)?.[1] ?? '').trim().replace(/[,\s]+$/, '');
  };
  return Array.from({ length: n }, (_, i) => {
    const quem = deQuem(i + 1);
    return { rotulo: `${i + 1}ª via${quem ? ` — ${quem}` : ''}` };
  });
}

/**
 * HTML completo (`<!DOCTYPE html>…`) do documento emitido — a MESMA string serve à
 * impressão no navegador, ao PDF do backend (WhatsApp/e-mail) e ao download.
 */
export function gerarHtmlDocumento(doc: DocumentoEmitido, imagens?: ImagensDocumento): string {
  // O cabeçalho sai do SNAPSHOT (`doc.contexto` + `doc.marca`), e o bloco `titulo` do
  // modelo é ABSORVIDO por ele — por isso o corpo vem de `prepararFolha`, não de
  // `doc.blocos` cru: senão o título sairia duas vezes no papel.
  const { cabecalho, corpo: blocosCorpo } = prepararFolha({
    blocos:   doc.blocos ?? [],
    nome:     doc.titulo || doc.templateNome,
    // ⚠️ `?? {}` e NUNCA `?? null`: sem contexto, o resolvedor cai no modo EXEMPLO do
    // catálogo e o PAPEL sairia com "Thor" no cabeçalho.
    contexto: doc.contexto ?? {},
    marca:    doc.marca,
  });
  // Campo em branco não vai para o papel nem para o PDF (a pedido, 2026-09-03).
  // Este gerador serve SÓ ao documento emitido — impressão, download e o anexo do
  // WhatsApp/e-mail —, então o filtro é incondicional. Cobre também o que foi emitido
  // ANTES da regra existir: o snapshot antigo tem os blocos vazios dentro.
  const corpo = semBlocosVazios(blocosCorpo)
    .map(b => blocoParaHtml(b, doc.marca, imagens)).join(String.fromCharCode(10));
  const emitido = doc.emitidoEm
    ? new Date(doc.emitidoEm).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '';
  const titulo = `${doc.numeroFmt ? `${doc.numeroFmt} - ` : ''}${doc.titulo || doc.templateNome}`;

  // As VIAS são as que o documento manda emitir. Cada uma é uma folha completa —
  // cabeçalho, corpo e rodapé —, separada por quebra de página; só o SELO muda, e é
  // ele que diz para quem é a folha que a pessoa tem na mão.
  const vias = viasDoDocumento(doc.blocos ?? []);

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>${texto(titulo)}</title>
<style>
  @page { size: A4; margin: 16mm 15mm 18mm; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: Inter, "Helvetica Neue", Arial, sans-serif;
         color:#111827; font-size:12px; line-height:1.5; }
  h1 { margin:0 0 8px; } h2 { margin:0 0 4px; } p { margin:0 0 6px; }
  .doc-cabecalho { border-bottom:1px solid #e5e7eb; padding-bottom:10px; margin-bottom:14px; }
  .doc-logo { max-height:52px; max-width:190px; object-fit:contain; display:block; }
  /* Identificação da via impressa: é ela que torna o papel rastreável até o registro
     no sistema — sem o número, duas vias iguais são indistinguíveis. */
  .doc-rodape { margin-top:22px; padding-top:6px; border-top:1px solid #e5e7eb;
                font-size:8px; color:#9ca3af; display:flex; justify-content:space-between; gap:12px; }
  table { page-break-inside: auto; } tr { page-break-inside: avoid; }
  /* Selo da via: discreto e no alto à direita — quem confere procura ali, e ele não
     pode competir com o título do documento. */
  .doc-selo-via { text-align:right; font-size:9px; letter-spacing:.06em; text-transform:uppercase;
                  color:#6b7280; margin:0 0 4px; }
</style></head>
<body>
${vias.map((via, i) => `
<section class="doc-via"${i < vias.length - 1 ? ' style="page-break-after:always"' : ''}>
  ${via.rotulo ? `<p class="doc-selo-via">${texto(via.rotulo)}</p>` : ''}
  ${cabecalhoHtml(cabecalho, imagens)}
  ${corpo}
  <div class="doc-rodape">
    <span>${texto(doc.numeroFmt ?? '')}${doc.numeroFmt && doc.animalNome ? ' · ' : ''}${texto(doc.animalNome)}</span>
    <span>${emitido ? `Emitido em ${esc(emitido)}` : ''}${doc.emitidoPor ? ` por ${texto(doc.emitidoPor)}` : ''}</span>
  </div>
</section>`).join('')}
</body></html>`;
}

export function imprimirDocumento(doc: DocumentoEmitido, imagens?: ImagensDocumento): void {
  imprimirHtml(gerarHtmlDocumento(doc, imagens));
}

/** Nome do arquivo do PDF (WhatsApp / e-mail / download). */
export function nomeArquivoDocumento(doc: DocumentoEmitido): string {
  const base = `${doc.numeroFmt ?? 'documento'}-${doc.titulo || doc.templateNome}`;
  // `NFD` separa a acentuação da letra e o `̀-ͯ` remove só a acentuação —
  // sem isso "atestado sanitário" viraria "atestado-sanit-rio", porque o passo
  // seguinte trata todo caractere fora de `\w` como separador.
  const limpo = base
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    .toLowerCase();
  return `${limpo || 'documento'}.pdf`;
}
