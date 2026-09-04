// src/modules/documentos/upload.ts
// Documento ENVIADO pela clínica: transforma o arquivo escolhido nos BLOCOS do modelo.
//
// DOIS CAMINHOS, e a diferença entre eles é o que a tela oferece como opção:
//
//   IDENTIFICAR OS CAMPOS (padrão) → as páginas vão para a IA, que devolve blocos de
//     verdade, com `{{variáveis}}` no que o S2Vet já sabe e `[[lacunas]]` no que ele
//     não sabe. O documento passa a se preencher sozinho com o paciente selecionado e
//     a pedir o resto num formulário — ver `services/documentoConversaoService.js`.
//   COMO IMAGEM (reserva) → o comportamento original: uma página, um bloco `imagem`.
//     É para onde a tela cai quando a identificação falha ou a pessoa a desliga. Ele
//     imprime e é enviado como qualquer documento, mas é papel morto: nenhum campo.
//
// 🔴 A DECISÃO QUE GOVERNA OS DOIS: **o que sobe é sempre IMAGEM**, mesmo quando a
// pessoa escolhe um PDF — que é convertido aqui, uma imagem por página, antes de
// subir.
//
// POR QUÊ, já que guardar o PDF cru seria mais simples: a folha do documento é montada
// em HTML e percorre QUATRO caminhos — o preview A4 na tela (`BlocoView`), a impressão
// por iframe, o PDF do Puppeteer que vai no WhatsApp/e-mail (`DocumentoPrint`) e o
// snapshot do emitido. Um PDF não se desenha dentro de nenhum deles: cada um precisaria
// de um desvio próprio (pdf.js no preview, abrir noutra aba na impressão, mandar o
// arquivo em vez do HTML no envio), e o documento enviado viraria um cidadão de segunda
// classe — exatamente o oposto de "seguir as mesmas regras de todos os documentos".
// Convertido em imagem, ele É um documento como qualquer outro, sem UMA linha de
// exceção em nenhum dos quatro caminhos.
//
// ⚠️ `pdfjs-dist` entra por `import()` DINÂMICO, como `jspdf`/`html2canvas` já fazem em
// `CentralDocumentos.exportarPdf`: são centenas de kB que só interessam a quem envia um
// PDF, e o custo não pode cair sobre quem só abre a tela para emitir um atestado.

import { criarBloco } from './catalogo';
import { enviarArquivoTemplate } from './api';
import type { Bloco } from './types';

/** Aceito no seletor de arquivo e revalidado aqui. */
export const TIPOS_ACEITOS = 'image/jpeg,image/png,image/webp,application/pdf';

/** Teto do multer da rota (15 MB). Barrar aqui evita subir para receber 413. */
const TETO_BYTES = 15 * 1024 * 1024;

/**
 * Escala de renderização do PDF. 2 ≈ 144 DPI: legível impresso e ainda leve.
 * Acima disso o JPEG de uma página A4 passa de 1 MB sem ganho visível no papel.
 */
const ESCALA_PDF = 2;

/** Teto do lado maior da IMAGEM enviada direto (foto de celular chega com 4000px+). */
const LADO_MAXIMO = 2000;

const QUALIDADE_JPEG = 0.85;

export const ehPdf = (f: File): boolean =>
  f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

/** As páginas do arquivo, já em imagem, mais o texto que o PDF trazia embutido. */
export interface PaginasDoArquivo {
  paginas: Blob[];
  /**
   * Texto embutido do PDF, quando havia. Vazio em imagem e em PDF escaneado.
   *
   * POR QUE ele viaja junto das imagens para a IA em vez de substituí-las: o texto dá
   * a redação EXATA (nenhum OCR erra uma vírgula que já está lá), e a imagem dá a
   * ESTRUTURA (o que é caixa, o que é tabela, onde está a linha de assinatura). Um
   * sozinho perde metade do documento.
   */
  texto: string;
}

function canvasParaBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      b => (b ? resolve(b) : reject(new Error('Falha ao converter a página.'))),
      'image/jpeg',
      QUALIDADE_JPEG,
    );
  });
}

/** Redesenha a imagem com o lado maior em `LADO_MAXIMO`, mantendo a proporção. */
async function comprimirImagem(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width  = Math.round(bitmap.width  * escala);
  canvas.height = Math.round(bitmap.height * escala);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Não foi possível processar a imagem.');
  // Fundo branco: JPEG não tem transparência, e um PNG com fundo transparente sairia
  // com o alfa virando PRETO no papel.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvasParaBlob(canvas);
}

/** Renderiza cada página do PDF num JPEG e recolhe o texto embutido de todas. */
async function pdfParaPaginas(file: File): Promise<PaginasDoArquivo> {
  const pdfjs = await import('pdfjs-dist');
  // O worker é um módulo à parte; `new URL(..., import.meta.url)` é a forma que o Vite
  // entende para empacotá-lo. Sem isto o pdf.js tenta buscar o worker de um caminho que
  // não existe no build e falha só em produção.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url,
  ).toString();

  // ⚠️ Quem tem `destroy()` é a TAREFA de carregamento, não o documento — por isso ela
  // fica numa variável em vez de encadear `.promise` direto.
  const tarefa = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const doc = await tarefa.promise;
  const paginas: Blob[] = [];
  const textos: string[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const pagina   = await doc.getPage(n);
      const viewport = pagina.getViewport({ scale: ESCALA_PDF });
      const canvas   = document.createElement('canvas');
      canvas.width   = Math.round(viewport.width);
      canvas.height  = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Não foi possível renderizar o PDF.');
      // PDF não tem fundo: sem pintar de branco, o JPEG sai com fundo preto.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await pagina.render({ canvas, canvasContext: ctx, viewport }).promise;
      paginas.push(await canvasParaBlob(canvas));

      // O texto é OPCIONAL e nunca derruba a conversão: PDF escaneado devolve nada, e
      // a IA segue lendo as imagens. Por isso o catch silencioso.
      try {
        const conteudo = await pagina.getTextContent();
        const linha = conteudo.items
          .map(i => ('str' in i ? i.str : ''))
          .join(' ')
          .replace(/[ \t]+/g, ' ')
          .trim();
        if (linha) textos.push(linha);
      } catch { /* página sem camada de texto */ }

      pagina.cleanup();
    }
  } finally {
    // Libera o worker mesmo se uma página falhar — senão ele fica vivo até o reload.
    await tarefa.destroy();
  }
  return { paginas, texto: textos.join('\n\n') };
}

/**
 * Arquivo escolhido → páginas em imagem (+ o texto do PDF, quando houver).
 *
 * É o passo comum aos dois caminhos: as MESMAS imagens vão para a IA identificar os
 * campos e, se isso não der certo, para o storage como blocos `imagem`. Converter uma
 * vez só também evita repetir a renderização, que é a parte cara.
 */
export async function paginasDoArquivo(file: File): Promise<PaginasDoArquivo> {
  if (file.size > TETO_BYTES) {
    throw new Error('Arquivo grande demais — o limite é 15 MB.');
  }
  const r = ehPdf(file)
    ? await pdfParaPaginas(file)
    : { paginas: [await comprimirImagem(file)], texto: '' };
  if (r.paginas.length === 0) throw new Error('O arquivo não tem nenhuma página.');
  return r;
}

/**
 * Páginas → blocos `imagem`, com os arquivos já no storage.
 *
 * Uma página = um bloco `imagem` de largura cheia. `onProgresso` alimenta o "Página 2
 * de 7" do diálogo: subir um PDF de várias páginas leva segundos, e sem sinal de vida
 * a pessoa clica de novo.
 */
export async function blocosDeImagens(
  paginas: Blob[],
  nomeArquivo: string,
  onProgresso?: (feito: number, total: number) => void,
): Promise<Bloco[]> {
  const blocos: Bloco[] = [];
  for (let i = 0; i < paginas.length; i++) {
    const url = await enviarArquivoTemplate(paginas[i], `${nomeArquivo}-p${i + 1}.jpg`);
    const b = criarBloco('imagem');
    blocos.push({
      ...b,
      conteudo: { ...b.conteudo, url, rotulo: nomeArquivo },
      // `altura: 0` = sem altura fixa. O padrão do bloco `imagem` é 160px, pensado
      // para uma foto de exame no meio do texto; aqui a imagem É a folha, e cortá-la
      // em 160px entregaria uma tira do documento.
      estilo:   { ...b.estilo, altura: 0, largura: 100, alinhamento: 'center' },
    });
    onProgresso?.(i + 1, paginas.length);
  }
  return blocos;
}

/**
 * Atalho do caminho reserva: arquivo → blocos `imagem`.
 *
 * Mantido porque é o contrato que a tela sempre usou, e porque continua sendo o que
 * roda quando a identificação de campos é desligada ou falha.
 */
export async function arquivoParaBlocos(
  file: File,
  onProgresso?: (feito: number, total: number) => void,
): Promise<Bloco[]> {
  const { paginas } = await paginasDoArquivo(file);
  return blocosDeImagens(paginas, file.name, onProgresso);
}
