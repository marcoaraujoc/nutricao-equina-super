// frontend/src/utils/imageCompress.ts
// Compressão de imagem por Canvas, com ALVO DE TAMANHO (não só resolução fixa) —
// reduz qualidade e, se ainda não couber, também a dimensão, até ficar dentro do
// limite (padrão 1MB) ou esgotar as tentativas. PDF e outros não-imagem passam
// direto: Canvas não sabe rasterizar isso.

const LIMITE_PADRAO_BYTES = 1024 * 1024; // 1MB

function carregarImagem(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Falha ao ler a imagem')); };
    img.src = url;
  });
}

function canvasParaBlob(canvas: HTMLCanvasElement, qualidade: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', qualidade));
}

/** Comprime `file` até `limiteBytes` (padrão 1MB). Arquivo já menor, ou que não é
 *  imagem (ex.: PDF), volta INTOCADO. Nunca lança — falha de leitura/canvas devolve
 *  o arquivo original, para o upload nunca travar por causa da compressão. */
export async function comprimirImagemAteLimite(file: File, limiteBytes = LIMITE_PADRAO_BYTES): Promise<File> {
  if (!file.type.startsWith('image/') || file.size <= limiteBytes) return file;

  try {
    const img = await carregarImagem(file);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    let width  = img.width;
    let height = img.height;
    let qualidade = 0.85;

    const render = async (): Promise<Blob | null> => {
      canvas.width  = width;
      canvas.height = height;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      return canvasParaBlob(canvas, qualidade);
    };

    let blob = await render();
    // Primeiro reduz QUALIDADE (mantém nitidez/tamanho visual); esgotada a faixa
    // razoável, passa a reduzir DIMENSÃO também. Até 10 tentativas — evita loop
    // infinito em imagem cuja compressão nunca cabe no limite (ex.: foto já quase
    // sólida de ruído).
    for (let tentativa = 0; blob && blob.size > limiteBytes && tentativa < 10; tentativa++) {
      if (qualidade > 0.4) {
        qualidade = Math.max(0.4, qualidade - 0.1);
      } else {
        width  = Math.round(width * 0.85);
        height = Math.round(height * 0.85);
      }
      blob = await render();
    }

    if (!blob || blob.size >= file.size) return file; // compressão não ajudou — mantém original
    return new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}

/** Aplica `comprimirImagemAteLimite` a uma lista de arquivos, em paralelo. */
export async function comprimirImagensAteLimite(files: File[], limiteBytes = LIMITE_PADRAO_BYTES): Promise<File[]> {
  return Promise.all(files.map(f => comprimirImagemAteLimite(f, limiteBytes)));
}
