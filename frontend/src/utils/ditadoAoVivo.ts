// src/utils/ditadoAoVivo.ts
//
// Texto do DITADO AO VIVO (Web Speech do navegador) enquanto a pessoa fala.
//
// O reconhecimento devolve, a cada evento, a lista de resultados da SESSÃO: os já
// fechados (`isFinal`) e o pedaço que ainda está sendo ouvido (provisório). O campo
// mostra `base + provisório`; quando um resultado fecha, ele entra na `base` e não é
// lido de novo.
//
// ⚠️ Por que existe: com `interimResults = false` o texto só aparecia quando a frase
// terminava — para quem dita, parecia que nada estava sendo ouvido.
//
// ⚠️ Chrome do ANDROID repete no resultado novo o texto dos anteriores da mesma sessão
// ("olá" → "olá tudo bem"). Sem cortar o prefixo repetido, cada frase entraria duas
// vezes no campo.

export interface ResultadoFala {
  transcript: string;
  isFinal:    boolean;
}

export interface EstadoDitado {
  /** Texto já fechado: o que havia no campo + os resultados finais desta sessão. */
  base:        string;
  /** Resultados da sessão já incorporados à `base` (índices abaixo disto são ignorados). */
  consumidos:  number;
  /** Quantos resultados a sessão já tinha no último evento. */
  vistos:      number;
  /** Último resultado final da sessão, como veio — para cortar a repetição do Android. */
  ultimoFinal: string;
}

export function juntarTexto(a: string, b: string): string {
  const esq = a.replace(/\s+$/, '');
  const dir = b.trim();
  if (!dir) return a;
  if (!esq) return dir;
  return `${esq} ${dir}`;
}

/** Sessão nova (início do ditado ou reinício do reconhecimento) sobre o texto atual. */
export function novaSessaoDitado(textoAtual: string): EstadoDitado {
  return { base: textoAtual, consumidos: 0, vistos: 0, ultimoFinal: '' };
}

function semRepeticao(anterior: string, atual: string): string {
  const a = anterior.trim().toLowerCase();
  const t = atual.trim();
  if (a && t.toLowerCase().startsWith(a)) return t.slice(a.length).trim();
  return t;
}

/** Aplica um evento de resultados; devolve o estado novo e o texto a exibir no campo. */
export function aplicarResultadosDitado(
  estado: EstadoDitado,
  resultados: ResultadoFala[],
): { estado: EstadoDitado; exibido: string } {
  let { base, consumidos, ultimoFinal } = estado;
  let provisorio = '';

  for (let i = consumidos; i < resultados.length; i++) {
    const r = resultados[i];
    // Só fecha o resultado na ORDEM: um final depois de um provisório ainda aberto
    // fica para o próximo evento, senão a fala sairia fora de ordem.
    if (r.isFinal && i === consumidos) {
      base        = juntarTexto(base, semRepeticao(ultimoFinal, r.transcript));
      ultimoFinal = r.transcript;
      consumidos  = i + 1;
    } else {
      provisorio = juntarTexto(provisorio, semRepeticao(i === consumidos ? ultimoFinal : '', r.transcript));
    }
  }

  return {
    estado:  { base, consumidos, vistos: resultados.length, ultimoFinal },
    exibido: juntarTexto(base, provisorio),
  };
}

/** A pessoa digitou no campo durante o ditado: o que está escrito vira a base, e o
 *  que o reconhecimento já mostrou (inclusive o provisório) não volta a ser somado. */
export function editadoDuranteDitado(estado: EstadoDitado, texto: string): EstadoDitado {
  return { ...estado, base: texto, consumidos: estado.vistos };
}
