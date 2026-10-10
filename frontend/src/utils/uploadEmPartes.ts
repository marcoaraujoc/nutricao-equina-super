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
  /** 0-100, do arquivo inteiro, com a velocidade real e o tempo que falta. */
  onProgresso?: (pct: number, ritmo?: RitmoEnvio) => void;
}

/** Velocidade MEDIDA (não estimada) e tempo restante, para a tela mostrar. */
export interface RitmoEnvio { mbPorSeg: number; restanteSeg: number }

/**
 * Partes simultâneas. Pelo Cloudflare cada parte é recebida inteira na borda antes de
 * seguir até o servidor, e em fila uma espera a ida-e-volta da outra; em paralelo
 * essas esperas se sobrepõem. Três é o bastante para encher a conexão sem disputar
 * o envio de quem está numa rede fraca.
 */
const PARALELAS = 3;

/**
 * Envia `arquivo` para `url` (rota `.../partes`) e devolve a resposta da ÚLTIMA parte —
 * que é a do registro criado. Lança o erro da parte que desistiu.
 *
 * Ordem: a parte 0 vai SOZINHA primeiro (é nela que o servidor confere acesso e tipo,
 * e é ela que zera um envio anterior com o mesmo id); as do meio vão em paralelo; a
 * ÚLTIMA vai sozinha depois de todas — é ela que remonta o arquivo, então só pode
 * chegar quando as outras já estão no servidor.
 */
export async function enviarEmPartes<T = unknown>(url: string, arquivo: File, opts: EnvioEmPartesOpcoes = {}): Promise<T> {
  const total    = Math.max(1, Math.ceil(arquivo.size / TAMANHO_PARTE));
  const uploadId = novoUploadId();
  const inicio   = Date.now();
  const enviadoPorParte = new Array<number>(total).fill(0);

  const avisar = () => {
    const enviados = enviadoPorParte.reduce((a, b) => a + b, 0);
    const seg = (Date.now() - inicio) / 1000;
    const ritmo = seg > 1 && enviados > 0
      ? { mbPorSeg: enviados / seg / 1048576, restanteSeg: Math.max(0, (arquivo.size - enviados) / (enviados / seg)) }
      : undefined;
    opts.onProgresso?.(Math.min(99, Math.round((enviados / arquivo.size) * 100)), ritmo);
  };

  const enviarParte = async (indice: number): Promise<T> => {
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
            enviadoPorParte[indice] = Math.min(pedaco.size, e.loaded ?? 0);
            avisar();
          },
        });
        enviadoPorParte[indice] = pedaco.size;
        avisar();
        return res.data as T;
      } catch (err) {
        enviadoPorParte[indice] = 0;
        // A ÚLTIMA parte não se repete às cegas: ela remonta o arquivo e grava no banco,
        // e um 5xx ali pode ter chegado DEPOIS de gravar — repetir duplicaria o anexo.
        if (indice === total - 1 || tentativa >= TENTATIVAS_POR_PARTE || !valeRepetir(err)) throw err;
        await espera(1000 * tentativa);
      }
    }
  };

  let resposta = await enviarParte(0);
  if (total > 1) {
    const meio = Array.from({ length: Math.max(0, total - 2) }, (_, i) => i + 1);
    let proximo = 0;
    const trabalhador = async () => {
      while (proximo < meio.length) await enviarParte(meio[proximo++]);
    };
    await Promise.all(Array.from({ length: Math.min(PARALELAS, meio.length) }, trabalhador));
    resposta = await enviarParte(total - 1);
  }
  opts.onProgresso?.(100);
  return resposta;
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
