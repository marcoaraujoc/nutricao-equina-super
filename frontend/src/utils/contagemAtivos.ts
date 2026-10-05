/**
 * Quantidade das abas Todos / Ativos / Inativos das telas de cadastro (2026-10-02).
 *
 * Toda pílula de status da aplicação mostra a sua quantidade entre parênteses. Nos
 * cadastros a lista vem filtrada do SERVIDOR, então a contagem também vem de lá
 * (`?contagens=1` → `res.data.contagens`, ver `backend/src/lib/contagemAtivos.js`).
 */
export type AbaAtivo = 'all' | 'ativo' | 'inativo';

export interface ContagemAtivos {
  all:     number;
  ativo:   number;
  inativo: number;
}

/** " (N)" para a aba, ou vazio enquanto a contagem não chegou — nunca "(0)" falso. */
export function sufixoContagem(c: ContagemAtivos | null | undefined, aba: AbaAtivo): string {
  return c ? ` (${c[aba]})` : '';
}

/** Conta uma lista JÁ carregada inteira (telas que filtram no cliente). */
export function contarAtivos<T>(lista: T[], ehInativo: (item: T) => boolean): ContagemAtivos {
  const inativo = lista.filter(ehInativo).length;
  return { all: lista.length, ativo: lista.length - inativo, inativo };
}
