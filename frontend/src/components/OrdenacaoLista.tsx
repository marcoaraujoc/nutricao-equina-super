// frontend/src/components/OrdenacaoLista.tsx
// ORDENAÇÃO POR COLUNA nos históricos — FONTE ÚNICA da regra e da forma.
//
// POR QUE UM COMPONENTE, E NÃO UM `sort` em cada tela: são mais de uma dezena de
// históricos no sistema, e cada cópia própria divergiria no que mais importa aqui —
// o CICLO do clique, para onde vai o registro SEM valor e o que a seta significa.
// Duas telas ordenando "de um jeito parecido" é pior que duas telas sem ordenação.
//
// CICLO DO CLIQUE: 1º crescente · 2º decrescente · 3º volta à ORDEM NATURAL da lista
// (que é o mais recente primeiro, em todo histórico do sistema). O terceiro estado não
// é enfeite: sem ele, quem clica sem querer numa coluna não tem como devolver a lista
// ao padrão a não ser recarregando a tela.
//
// ⚠️ REGISTRO SEM VALOR VAI SEMPRE PARA O FIM, nos dois sentidos. Trocar "—" de ponta
// conforme a direção faz a lista parecer embaralhada: quem ordena por "Data Fim" quer
// ver as datas em ordem, não as vinte linhas em branco na frente delas.
//
// ⚠️ Ordena o que a tela TEM EM MÃOS. Onde a paginação é do servidor (Evolução e
// Prescrição), a ordem é pedida ao backend — senão a "ordenação" reorganizaria as 10
// linhas da página e mentiria sobre as outras 200.
import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';

export type Direcao = 'asc' | 'desc';

export interface Ordenacao<K extends string = string> {
  campo:   K;
  direcao: Direcao;
}

/** Valor comparável de uma célula. `null` = sem valor (vai para o fim). */
export type ValorOrdenavel = string | number | null | undefined;

export function useOrdenacao<K extends string>(inicial: Ordenacao<K> | null = null) {
  const [ordenacao, setOrdenacao] = useState<Ordenacao<K> | null>(inicial);

  const alternar = (campo: K) => {
    setOrdenacao(atual => {
      if (atual?.campo !== campo)      return { campo, direcao: 'asc' };
      if (atual.direcao === 'asc')     return { campo, direcao: 'desc' };
      return null; // 3º clique: ordem natural de volta
    });
  };

  return { ordenacao, alternar, setOrdenacao };
}

/**
 * Compara duas células. Texto por `localeCompare` pt-BR (sem isso "Ávila" cai depois
 * de "Zuza", porque o acento vem depois na tabela de caracteres) e sem diferenciar
 * maiúscula de minúscula — quem lê a coluna não vê essa diferença.
 * DATA e HORA entram como NÚMERO (timestamp), nunca como texto: "10/02" antes de
 * "9/02" é o que dá quando se ordena data escrita em pt-BR como string.
 */
function comparar(a: ValorOrdenavel, b: ValorOrdenavel): number {
  const vazioA = a === null || a === undefined || a === '';
  const vazioB = b === null || b === undefined || b === '';
  if (vazioA && vazioB) return 0;
  if (vazioA) return 1;   // sem valor sempre no fim…
  if (vazioB) return -1;  // …nos dois sentidos (a direção é aplicada só ao resto)

  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'pt-BR', { sensitivity: 'base', numeric: true });
}

/**
 * Devolve uma CÓPIA ordenada. `valorDe` diz o que cada coluna vale para efeito de
 * comparação — é onde a tela converte data em timestamp e status em rótulo.
 * Sem ordenação, devolve a lista como está (a ordem natural do histórico).
 */
export function ordenarLista<T, K extends string>(
  itens: T[],
  ordenacao: Ordenacao<K> | null,
  valorDe: (item: T, campo: K) => ValorOrdenavel,
): T[] {
  if (!ordenacao) return itens;
  const sinal = ordenacao.direcao === 'asc' ? 1 : -1;
  // `slice()`: `sort` ordena NO LUGAR, e a lista vem do estado do React — ordenar o
  // próprio array mutaria o estado sem passar pelo setter.
  return itens.slice().sort((x, y) => {
    const r = comparar(valorDe(x, ordenacao.campo), valorDe(y, ordenacao.campo));
    // Empate mantém a ordem natural, e o desempate NUNCA é invertido pelo sinal —
    // senão o 2º clique embaralharia as linhas de mesmo valor sem motivo visível.
    return r === 0 ? 0 : r * sinal;
  });
}

interface ThProps<K extends string> {
  campo:      K;
  ordenacao:  Ordenacao<K> | null;
  onOrdenar:  (campo: K) => void;
  children:   ReactNode;
  /** Classes do `<th>` original da tela — largura, alinhamento, `hidden lg:table-cell`. */
  className?: string;
  /** Alinhamento do conteúdo dentro do botão (segue o da coluna). */
  alinhar?:   'esquerda' | 'centro' | 'direita';
}

const JUSTIFICAR = {
  esquerda: 'justify-start',
  centro:   'justify-center',
  direita:  'justify-end',
} as const;

/**
 * Cabeçalho de coluna clicável. Mantém o `<th>` da tela (classes e tudo) e só troca o
 * conteúdo por um botão com a seta de estado.
 *
 * ⚠️ É `<button type="button">` dentro do `<th>`, não um `onClick` no `<th>`: a
 * ordenação precisa ser alcançável por TECLADO (Tab + Enter), e `<th onClick>` não é.
 * `type="button"` porque há históricos dentro de `<form>` — sem ele o clique submete.
 */
export function ThOrdenavel<K extends string>({
  campo, ordenacao, onOrdenar, children, className = '', alinhar = 'esquerda',
}: ThProps<K>) {
  const ativo = ordenacao?.campo === campo;
  const Icone = !ativo ? ChevronsUpDown : ordenacao.direcao === 'asc' ? ChevronUp : ChevronDown;

  return (
    <th className={className}>
      <button
        type="button"
        onClick={() => onOrdenar(campo)}
        title={ativo
          ? (ordenacao.direcao === 'asc' ? 'Ordenado do menor para o maior — clique para inverter' : 'Ordenado do maior para o menor — clique para voltar à ordem original')
          : 'Ordenar por esta coluna'}
        aria-label={`Ordenar por ${typeof children === 'string' ? children : campo}`}
        className={`group flex items-center gap-1 w-full ${JUSTIFICAR[alinhar]} hover:text-gray-700 transition-colors`}>
        {children}
        {/* Inativa, a seta só aparece no hover: catorze colunas com seta permanente
            viram ruído e escondem o que está de fato ordenado. */}
        <Icone size={11} className={ativo ? 'text-emerald-600 flex-shrink-0' : 'text-gray-300 opacity-0 group-hover:opacity-100 flex-shrink-0'} />
      </button>
    </th>
  );
}

/** Data ISO (ou `Date`) → timestamp comparável. Inválida/ausente = sem valor. */
export function valorData(v: string | Date | null | undefined): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Data pura "YYYY-MM-DD" comparada como TEXTO — nesse formato a ordem alfabética
 *  É a cronológica, e não passa por fuso nenhum (ver a regra de data em CLAUDE.md §6). */
export function valorDataPura(v: string | null | undefined): string | null {
  if (!v) return null;
  return String(v).slice(0, 10);
}
