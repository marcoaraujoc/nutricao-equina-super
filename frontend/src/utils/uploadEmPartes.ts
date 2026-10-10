// Envio de arquivo GRANDE em partes — espelho de backend/src/lib/uploadEmPartes.js.
//
// 🔴 POR QUÊ (2026-10-09): o acesso passa pelo Cloudflare, que corta com HTTP 524 a
// requisição cujo servidor não responde em 100 s. Num envio único a resposta só sai
// depois do último byte, então o limite real virava a velocidade de UPLOAD de quem
// envia: um MP4 de 89 MB levou mais de 4 minutos e morreu sem gravar nada.
// Em partes de 4 MB cada requisição termina em segundos, e uma parte que falhe por
// rede é repetida sozinha — sem recomeçar o arquivo do zero.
import api from '../services/api';

export const TAMANHO_PARTE = 4 * 1024 * 1024;
const TENTATIVAS_POR_PARTE = 3;

function novoUploadId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

const espera = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Falha que vale repetir: rede caiu, timeout, 5xx/524. 4xx é recusa — repetir não muda. */
function valeRepetir(err: unknown): boolean {
  const status = (err as { response?: { status?: number } })?.response?.status;
  return status == null || status >= 500 || status === 429;
}

export interface EnvioEmPartesOpcoes {
  /** Campos extras enviados com cada parte (ex.: `tipo`). */
  campos?: Record<string, string>;
  /** 0-100, do arquivo inteiro. */
  onProgresso?: (pct: number) => void;
}

/**
 * Envia `arquivo` para `url` (rota `.../partes`) e devolve a resposta da ÚLTIMA parte —
 * que é a do registro criado. Lança o erro da parte que desistiu.
 */
export async function enviarEmPartes<T = unknown>(url: string, arquivo: File, opts: EnvioEmPartesOpcoes = {}): Promise<T> {
  const total    = Math.max(1, Math.ceil(arquivo.size / TAMANHO_PARTE));
  const uploadId = novoUploadId();
  let resposta: T | undefined;

  for (let indice = 0; indice < total; indice++) {
    const pedaco = arquivo.slice(indice * TAMANHO_PARTE, (indice + 1) * TAMANHO_PARTE);
    for (let tentativa = 1; ; tentativa++) {
      try {
        const fd = new FormData();
        fd.append('uploadId', uploadId);
        fd.append('indice', String(indice));
        fd.append('total', String(total));
        fd.append('tamanhoTotal', String(arquivo.size));
        fd.append('nome', arquivo.name);
        fd.append('mime', arquivo.type);
        for (const [k, v] of Object.entries(opts.campos ?? {})) fd.append(k, v);
        fd.append('parte', pedaco, arquivo.name);
        const res = await api.post(url, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (e) => {
            const parcial = e.total ? e.loaded / e.total : 0;
            opts.onProgresso?.(Math.min(99, Math.round(((indice + parcial) / total) * 100)));
          },
        });
        resposta = res.data as T;
        break;
      } catch (err) {
        // A ÚLTIMA parte não se repete às cegas: ela remonta o arquivo e grava no banco,
        // e um 5xx ali pode ter chegado DEPOIS de gravar — repetir duplicaria o anexo.
        if (indice === total - 1 || tentativa >= TENTATIVAS_POR_PARTE || !valeRepetir(err)) throw err;
        await espera(1000 * tentativa);
      }
    }
  }
  opts.onProgresso?.(100);
  return resposta as T;
}

/** Mensagem legível do erro de envio — a do servidor quando houver. */
export function mensagemErroEnvio(err: unknown, nome: string): string {
  const r = (err as { response?: { status?: number; data?: { mensagem?: string; error?: string } } })?.response;
  const msg = r?.data?.mensagem ?? r?.data?.error;
  if (msg) return `${nome}: ${msg}`;
  if (r?.status === 524 || r?.status === 504) return `${nome}: o servidor demorou demais para responder. Tente novamente.`;
  if (!r) return `${nome}: a conexão caiu durante o envio. Verifique a internet e tente novamente.`;
  return `Erro ao enviar ${nome}.`;
}
