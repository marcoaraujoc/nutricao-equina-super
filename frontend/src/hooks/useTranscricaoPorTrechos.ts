// frontend/src/hooks/useTranscricaoPorTrechos.ts
//
// 🔴 DITADO POR TRECHOS (2026-10-10) — o que impede perder o que foi dito quando a
// internet cai.
//
// Antes, a gravação inteira ficava na MEMÓRIA e só era enviada ao servidor quando a
// pessoa parava: falha no envio, aba fechada pelo celular ou página recarregada
// jogavam fora minutos de fala, sem volta.
//
// Agora a fala é cortada em trechos de ~12–35 s (de preferência numa PAUSA, para não
// partir palavra ao meio). Cada trecho:
//   1. é gravado no aparelho (IndexedDB) A CADA SEGUNDO enquanto é falado;
//   2. ao fechar, é enviado à mesma rota de sempre (`/clinica/evolucoes/transcrever`);
//   3. só sai do aparelho DEPOIS que o texto dele entrou no campo da evolução.
// Sem internet, os trechos esperam — e são enviados sozinhos quando ela volta. Página
// recarregada no meio: o trecho órfão é recuperado ao reabrir o formulário.
//
// ⚠️ O texto entra SEMPRE NA ORDEM DA FALA: a fila para no primeiro trecho que ainda
// não pôde ser transcrito (rede) em vez de pular para o seguinte. A exceção é o
// trecho que o servidor RECUSA de vez (4xx): ele fica de lado, com aviso, para não
// prender o resto da fala atrás dele.
// ⚠️ Um MediaRecorder por trecho, nunca um só cortado por `timeslice`: só o primeiro
// pedaço de um WebM tem cabeçalho, e um pedaço do meio não é um arquivo que o
// servidor consiga ler.

import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../services/api';
import { modeloPronto, transcreverOffline } from '../services/whisperService';
import {
  atualizarTrechoSeExistir, descartarTrechos, limparTrechosAntigos, listarTrechos,
  removerTrecho, salvarTrecho, type Trecho,
} from '../services/trechosTranscricaoStore';

// ─── Formato e mensagens de microfone ────────────────────────────────────────

// Em ordem de preferência. Chrome/Android/Firefox gravam WebM; Safari (iPhone e Mac)
// só MP4. `undefined` = deixa o navegador escolher o padrão dele.
const FORMATOS_GRAVACAO = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

export function formatoDeGravacao(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
  return FORMATOS_GRAVACAO.find(f => MediaRecorder.isTypeSupported(f));
}

export function extensaoDoAudio(mime: string): string {
  if (mime.includes('mp4') || mime.includes('aac')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}

export function mensagemErroMicrofone(err: unknown): string {
  const nome = (err as { name?: string })?.name;
  if (nome === 'NotAllowedError' || nome === 'SecurityError')
    return 'Permissão de microfone negada. Libere o microfone para este site nas configurações do navegador.';
  if (nome === 'NotFoundError' || nome === 'OverconstrainedError')
    return 'Nenhum microfone encontrado. Conecte um microfone e tente de novo.';
  if (nome === 'NotReadableError')
    return 'O microfone está em uso por outro aplicativo. Feche-o e tente de novo.';
  return 'Não foi possível acessar o microfone.';
}

// ─── Corte dos trechos ───────────────────────────────────────────────────────

const PEDACO_MS          = 1_000;   // a cada quanto o trecho em fala é gravado no aparelho
const VIGIA_MS           = 200;
const MIN_TRECHO_MS      = 12_000;  // antes disso não corta, nem em pausa
const PAUSA_IDEAL_MS     = 700;     // pausa que basta para cortar depois do mínimo
const TRECHO_LONGO_MS    = 25_000;  // daqui em diante, uma pausa curta já serve
const PAUSA_CURTA_MS     = 300;
const MAX_TRECHO_MS      = 35_000;  // corta mesmo sem pausa (fala contínua, ambiente ruidoso)
const SEM_ANALISADOR_MS  = 25_000;  // corte fixo quando o navegador não mede o volume
const LIMIAR_SOM         = 0.015;   // RMS acima disto = alguém falando
// Trecho cujo PICO não passou disto é microfone mudo/silêncio digital: não vale uma
// chamada à IA. ⚠️ Bem abaixo do LIMIAR_SOM de propósito — descartar fala baixa por
// engano é exatamente a perda que este hook existe para evitar.
const PICO_SILENCIO_TOTAL = 0.003;

// ─── Envio ───────────────────────────────────────────────────────────────────

const MAX_TENTATIVAS = 5;           // falhas do SERVIDOR antes de o trecho ir para "erro"
const ESPERAS_MS     = [3_000, 6_000, 12_000, 24_000, 30_000];
const ATRASO_INICIAL_MS = 400;      // ver o efeito de montagem

interface TrechoEmFala {
  id:          string;
  chave:       string;
  ordem:       number;
  seq:         number;
  mime:        string;
  inicio:      number;
  ultimoSom:   number;
  pico:        number;
  pedacos:     Blob[];
  /** Encerrado sem fechar (formulário desmontado): nada mais é gravado dele. */
  encerrado:   boolean;
  /** Gravações no aparelho deste trecho, em fila: a final nunca pode chegar antes. */
  fila:        Promise<void>;
}

type Resultado =
  | { tipo: 'ok'; texto: string }
  | { tipo: 'esperar' }                       // sem rede: tentar de novo depois
  | { tipo: 'falha'; mensagem: string }       // servidor falhou (5xx/429): conta tentativa
  | { tipo: 'definitivo'; mensagem: string }; // servidor recusou (4xx): não adianta repetir

export interface EstadoTrechos {
  /** Trechos já falados que ainda não viraram texto. */
  pendentes:         number;
  enviando:          boolean;
  aguardandoConexao: boolean;
  erros:             number;
  mensagemErro:      string | null;
}

const ESTADO_INICIAL: EstadoTrechos = {
  pendentes: 0, enviando: false, aguardandoConexao: false, erros: 0, mensagemErro: null,
};

function novoId(): string {
  try { return crypto.randomUUID(); }
  catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

async function transcrever(t: Trecho): Promise<Resultado> {
  const blob = new Blob([t.dados], { type: t.mime });
  if (!navigator.onLine) {
    // Sem rede, só o Whisper local — e só se o modelo JÁ estiver carregado: baixá-lo
    // (~80 MB) é justamente o que não dá para fazer offline.
    if (!modeloPronto()) return { tipo: 'esperar' };
    try { return { tipo: 'ok', texto: await transcreverOffline(blob) }; }
    catch { return { tipo: 'esperar' }; }
  }
  try {
    const fd = new FormData();
    fd.append('audio', blob, `trecho.${extensaoDoAudio(t.mime)}`);
    const res = await api.post('/clinica/evolucoes/transcrever', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120_000,
    });
    return { tipo: 'ok', texto: String(res.data?.dados?.texto ?? '') };
  } catch (err) {
    const e = err as { response?: { status?: number; data?: { mensagem?: string } }; status?: number };
    const status = e.response?.status ?? e.status;
    const mensagem = e.response?.data?.mensagem ?? (status ? `erro ${status}` : 'sem conexão');
    if (!status || status === 401) return { tipo: 'esperar' };
    if (status === 408 || status === 429 || status >= 500) return { tipo: 'falha', mensagem };
    return { tipo: 'definitivo', mensagem };
  }
}

/**
 * @param chave  formulário dono do áudio (`ev:<userId>:<animalId>:<novo|id>`);
 *               `null` desliga tudo (somente leitura, rascunho ainda não restaurado).
 * @param aoTexto recebe o texto de cada trecho, na ordem da fala.
 */
export function useTranscricaoPorTrechos(chave: string | null, aoTexto: (texto: string) => void) {
  const [gravando, setGravando] = useState(false);
  const [estado,   setEstado]   = useState<EstadoTrechos>(ESTADO_INICIAL);

  const aoTextoRef     = useRef(aoTexto);
  aoTextoRef.current   = aoTexto;
  const chaveRef       = useRef(chave);
  chaveRef.current     = chave;
  const sessaoRef      = useRef(novoId());
  const seqRef         = useRef(0);
  const ativoRef       = useRef(false);
  const streamRef      = useRef<MediaStream | null>(null);
  const recorderRef    = useRef<MediaRecorder | null>(null);
  const trechoRef      = useRef<TrechoEmFala | null>(null);
  const ctxRef         = useRef<AudioContext | null>(null);
  const analyserRef    = useRef<AnalyserNode | null>(null);
  const amostraRef     = useRef<Float32Array<ArrayBuffer> | null>(null);
  const vigiaRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const esperaRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tentativaRef   = useRef(0);
  const processandoRef = useRef(false);
  const deNovoRef      = useRef(false);
  const enviandoRef    = useRef(false);
  const semRedeRef     = useRef(false);

  // ── Estado exibido ──────────────────────────────────────────────────────────

  const atualizarEstado = useCallback(async () => {
    const c = chaveRef.current;
    if (!c || !ativoRef.current) return;
    const lista = await listarTrechos(c).catch(() => [] as Trecho[]);
    if (!ativoRef.current || chaveRef.current !== c) return;
    const pendentes = lista.filter(t =>
      t.status === 'pendente' || t.status === 'concluido'
      || (t.status === 'gravando' && t.sessao !== sessaoRef.current)).length;
    const comErro = lista.filter(t => t.status === 'erro');
    setEstado({
      pendentes,
      enviando:          enviandoRef.current,
      aguardandoConexao: pendentes > 0 && (semRedeRef.current || !navigator.onLine),
      erros:             comErro.length,
      mensagemErro:      comErro.length ? (comErro[comErro.length - 1].erro ?? null) : null,
    });
  }, []);

  // ── Fila de transcrição ─────────────────────────────────────────────────────

  const processarFilaRef = useRef<() => Promise<void>>(async () => {});

  const agendarNovaTentativa = useCallback(() => {
    if (esperaRef.current) return;
    const espera = ESPERAS_MS[Math.min(tentativaRef.current, ESPERAS_MS.length - 1)];
    tentativaRef.current += 1;
    esperaRef.current = setTimeout(() => {
      esperaRef.current = null;
      void processarFilaRef.current();
    }, espera);
  }, []);

  const processarFila = useCallback(async () => {
    const c = chaveRef.current;
    if (!c || !ativoRef.current) return;
    if (processandoRef.current) { deNovoRef.current = true; return; }
    processandoRef.current = true;
    try {
      while (ativoRef.current && chaveRef.current === c) {
        const lista = await listarTrechos(c);
        let proximo: Trecho | undefined;
        for (const t of lista) {
          if (t.status === 'gravando') {
            // O trecho sendo falado AGORA segura a fila: a ordem do texto espera por ele.
            if (t.sessao === sessaoRef.current) break;
            // Órfão de uma sessão interrompida (página recarregada, formulário
            // fechado no meio da fala): o que foi gravado dele vale como trecho pronto.
            await atualizarTrechoSeExistir(t.id, { status: 'pendente' });
            t.status = 'pendente';
          }
          if (t.status === 'erro') continue;
          if (t.status === 'concluido') {
            if (t.texto?.trim()) aoTextoRef.current(t.texto.trim());
            await removerTrecho(t.id);
            continue;
          }
          proximo = t;
          break;
        }
        if (!proximo) break;

        enviandoRef.current = true;
        void atualizarEstado();
        const r = await transcrever(proximo);
        enviandoRef.current = false;

        if (r.tipo === 'ok') {
          semRedeRef.current   = false;
          tentativaRef.current = 0;
          // Guardado como "concluido" ANTES de entregar: se o formulário fechou durante
          // o envio, o texto espera aqui e entra quando ele reabrir. Se o trecho foi
          // descartado nesse meio-tempo, não volta.
          const existe = await atualizarTrechoSeExistir(proximo.id, { status: 'concluido', texto: r.texto });
          if (!existe) continue;
          if (!ativoRef.current || chaveRef.current !== c) break;
          if (r.texto.trim()) aoTextoRef.current(r.texto.trim());
          await removerTrecho(proximo.id);
          continue;
        }
        if (r.tipo === 'esperar') {
          semRedeRef.current = true;
          agendarNovaTentativa();
          break;
        }
        if (r.tipo === 'falha') {
          const tentativas = proximo.tentativas + 1;
          if (tentativas >= MAX_TENTATIVAS) {
            await atualizarTrechoSeExistir(proximo.id, {
              status: 'erro', tentativas, erro: `o servidor não conseguiu transcrever (${r.mensagem})`,
            });
            continue;
          }
          await atualizarTrechoSeExistir(proximo.id, { tentativas });
          agendarNovaTentativa();
          break;
        }
        await atualizarTrechoSeExistir(proximo.id, { status: 'erro', erro: r.mensagem });
      }
    } catch {
      // IndexedDB falhou no meio: tenta de novo mais tarde, o áudio continua guardado.
      agendarNovaTentativa();
    } finally {
      enviandoRef.current   = false;
      processandoRef.current = false;
      await atualizarEstado();
      if (deNovoRef.current) { deNovoRef.current = false; void processarFila(); }
    }
  }, [agendarNovaTentativa, atualizarEstado]);
  processarFilaRef.current = processarFila;

  // ── Gravação no aparelho ────────────────────────────────────────────────────

  const gravarNoAparelho = useCallback((t: TrechoEmFala, status: 'gravando' | 'pendente') => {
    t.fila = t.fila.then(async () => {
      if (t.encerrado) return;
      const dados = await new Blob(t.pedacos, { type: t.mime }).arrayBuffer();
      // ⚠️ Conferido de novo DEPOIS do await: o formulário pode ter sido zerado
      // enquanto o áudio era lido, e a gravação não pode ressuscitar o descartado.
      if (t.encerrado) return;
      await salvarTrecho({
        id: t.id, chave: t.chave, sessao: sessaoRef.current, ordem: t.ordem, seq: t.seq,
        dados, mime: t.mime, status, tentativas: 0, criadoEm: t.ordem,
      });
    }).catch(() => { /* aparelho sem espaço: o trecho segue em memória até fechar */ });
    return t.fila;
  }, []);

  const fecharTrecho = useCallback(async (t: TrechoEmFala) => {
    if (t.encerrado) return;
    if (t.pedacos.length === 0 || (analyserRef.current && t.pico < PICO_SILENCIO_TOTAL)) {
      t.encerrado = true;
      await t.fila;
      await removerTrecho(t.id).catch(() => {});
    } else {
      await gravarNoAparelho(t, 'pendente');
    }
    void processarFila();
  }, [gravarNoAparelho, processarFila]);

  const abrirTrecho = useCallback((): string | null => {
    const stream = streamRef.current;
    const c      = chaveRef.current;
    if (!stream || !c) return 'Gravação indisponível.';
    const mime = formatoDeGravacao();
    let rec: MediaRecorder;
    try {
      rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch {
      return 'Este navegador não conseguiu iniciar a gravação de áudio.';
    }
    const agora = Date.now();
    const t: TrechoEmFala = {
      id: novoId(), chave: c, ordem: agora, seq: ++seqRef.current, mime: mime || 'audio/webm',
      inicio: agora, ultimoSom: agora, pico: 0, pedacos: [], encerrado: false, fila: Promise.resolve(),
    };
    rec.ondataavailable = e => {
      if (!e.data || e.data.size === 0) return;
      t.pedacos.push(e.data);
      if (rec.state === 'recording') void gravarNoAparelho(t, 'gravando');
    };
    rec.onstop = () => { void fecharTrecho(t); };
    try {
      rec.start(PEDACO_MS);
    } catch {
      return 'Este navegador não conseguiu iniciar a gravação de áudio.';
    }
    t.mime = rec.mimeType || t.mime;
    recorderRef.current = rec;
    trechoRef.current   = t;
    return null;
  }, [fecharTrecho, gravarNoAparelho]);

  /** Fecha o trecho atual e já abre o seguinte — o novo começa ANTES de o antigo parar,
   *  para não sobrar um vão sem gravação entre os dois. */
  const cortar = useCallback(() => {
    const antigo = recorderRef.current;
    if (!antigo) return;
    if (abrirTrecho() !== null) return;   // não abriu o novo: segue no atual
    try { antigo.stop(); } catch { /* já parado */ }
  }, [abrirTrecho]);

  const vigiar = useCallback(() => {
    const t = trechoRef.current;
    if (!t) return;
    const agora = Date.now();
    const idade = agora - t.inicio;
    const analyser = analyserRef.current;
    if (!analyser || !amostraRef.current) {
      if (idade >= SEM_ANALISADOR_MS) cortar();
      return;
    }
    const amostra = amostraRef.current;
    analyser.getFloatTimeDomainData(amostra);
    let soma = 0;
    for (let i = 0; i < amostra.length; i++) soma += amostra[i] * amostra[i];
    const rms = Math.sqrt(soma / amostra.length);
    if (rms > t.pico) t.pico = rms;
    if (rms > LIMIAR_SOM) t.ultimoSom = agora;
    const pausa = agora - t.ultimoSom;
    if (idade >= MAX_TRECHO_MS
      || (idade >= TRECHO_LONGO_MS && pausa >= PAUSA_CURTA_MS)
      || (idade >= MIN_TRECHO_MS && pausa >= PAUSA_IDEAL_MS)) {
      cortar();
    }
  }, [cortar]);

  const liberarMicrofone = useCallback(() => {
    streamRef.current?.getTracks().forEach(tr => tr.stop());
    streamRef.current = null;
    analyserRef.current = null;
    amostraRef.current  = null;
    const ctx = ctxRef.current;
    ctxRef.current = null;
    if (ctx) void ctx.close().catch(() => {});
  }, []);

  // ── API ─────────────────────────────────────────────────────────────────────

  /** Abre o microfone e começa a gravar. Devolve a mensagem de erro, ou `null`. */
  const iniciar = useCallback(async (): Promise<string | null> => {
    if (!chaveRef.current) return 'Gravação indisponível neste formulário.';
    if (recorderRef.current) return null;
    // Sem HTTPS (ex.: celular abrindo http://192.168.x.x) o navegador nem expõe o
    // microfone — `mediaDevices` vem undefined.
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      return 'Este navegador não permite gravar áudio nesta página. Use o endereço com https://.';
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      return mensagemErroMicrofone(err);
    }
    if (!ativoRef.current) { stream.getTracks().forEach(tr => tr.stop()); return null; }
    streamRef.current = stream;
    // Medidor de volume para cortar nas pausas. Sem ele (navegador antigo), o corte é
    // por tempo fixo — o ditado funciona igual.
    try {
      const Ctx = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        void ctx.resume().catch(() => {});
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        ctx.createMediaStreamSource(stream).connect(analyser);
        ctxRef.current      = ctx;
        analyserRef.current = analyser;
        amostraRef.current  = new Float32Array(analyser.fftSize);
      }
    } catch { analyserRef.current = null; amostraRef.current = null; }

    const erro = abrirTrecho();
    if (erro) { liberarMicrofone(); return erro; }
    vigiaRef.current = setInterval(vigiar, VIGIA_MS);
    setGravando(true);
    return null;
  }, [abrirTrecho, liberarMicrofone, vigiar]);

  /** Encerra a gravação. O último trecho é fechado e entra na fila como os outros. */
  const parar = useCallback(() => {
    if (vigiaRef.current) { clearInterval(vigiaRef.current); vigiaRef.current = null; }
    const rec = recorderRef.current;
    recorderRef.current = null;
    trechoRef.current   = null;
    setGravando(false);
    if (rec && rec.state !== 'inactive') {
      // O microfone só é solto depois do último pedaço — soltar antes cortaria o fim
      // da fala no Safari.
      rec.addEventListener('stop', liberarMicrofone, { once: true });
      try { rec.stop(); } catch { liberarMicrofone(); }
    } else {
      liberarMicrofone();
    }
  }, [liberarMicrofone]);

  /** Trechos que o servidor recusou voltam para a fila. */
  const tentarNovamente = useCallback(async () => {
    const c = chaveRef.current;
    if (!c) return;
    const lista = await listarTrechos(c).catch(() => [] as Trecho[]);
    await Promise.all(lista.filter(t => t.status === 'erro')
      .map(t => atualizarTrechoSeExistir(t.id, { status: 'pendente', tentativas: 0, erro: undefined })));
    tentativaRef.current = 0;
    if (esperaRef.current) { clearTimeout(esperaRef.current); esperaRef.current = null; }
    await processarFila();
  }, [processarFila]);

  /** Joga fora todo áudio ainda não transcrito deste formulário (decisão da pessoa). */
  const descartarPendentes = useCallback(async () => {
    const c = chaveRef.current;
    if (!c || recorderRef.current) return;
    await descartarTrechos(c);
    await atualizarEstado();
  }, [atualizarEstado]);

  // ── Ciclo de vida ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!chave) { setEstado(ESTADO_INICIAL); return; }
    ativoRef.current = true;
    sessaoRef.current = novoId();
    void limparTrechosAntigos();
    void atualizarEstado();
    // ⚠️ Pequeno atraso antes de entregar o que sobrou de uma sessão anterior: o
    // formulário pode estar recebendo o rascunho/texto do registro neste mesmo
    // instante, e o texto recuperado tem de ser somado a ELE, não a um campo vazio.
    const inicio = setTimeout(() => { void processarFila(); }, ATRASO_INICIAL_MS);
    const aoVoltarRede = () => {
      semRedeRef.current   = false;
      tentativaRef.current = 0;
      if (esperaRef.current) { clearTimeout(esperaRef.current); esperaRef.current = null; }
      void processarFila();
    };
    const aoPerderRede = () => { semRedeRef.current = true; void atualizarEstado(); };
    window.addEventListener('online',  aoVoltarRede);
    window.addEventListener('offline', aoPerderRede);

    return () => {
      ativoRef.current = false;
      clearTimeout(inicio);
      window.removeEventListener('online',  aoVoltarRede);
      window.removeEventListener('offline', aoPerderRede);
      if (esperaRef.current) { clearTimeout(esperaRef.current); esperaRef.current = null; }
      if (vigiaRef.current)  { clearInterval(vigiaRef.current); vigiaRef.current = null; }
      // Formulário saindo da tela no meio da fala: o trecho em curso para de ser
      // gravado. O que já estava no aparelho FICA (órfão) e é recuperado quando o
      // formulário reabrir — a não ser que quem fechou tenha ZERADO o formulário, e
      // aí ele mesmo chama `descartarTrechos`.
      const t = trechoRef.current;
      if (t) t.encerrado = true;
      const rec = recorderRef.current;
      recorderRef.current = null;
      trechoRef.current   = null;
      if (rec && rec.state !== 'inactive') { try { rec.stop(); } catch { /* já parado */ } }
      liberarMicrofone();
      setGravando(false);
    };
  }, [chave, atualizarEstado, processarFila, liberarMicrofone]);

  return {
    gravando,
    ...estado,
    iniciar,
    parar,
    tentarNovamente,
    descartarPendentes,
  };
}
