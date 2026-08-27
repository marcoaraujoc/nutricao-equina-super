// frontend/src/components/relatorios/RelatorioUI.tsx
// Blocos de UI reutilizados pelas páginas de Relatórios (Gestão, Financeiro,
// Atendimento, Cadastro, Farmácia). Extraídos da Relatorios.tsx original.

import { Children, cloneElement, isValidElement, type ReactNode, type ReactElement } from 'react';
import { Link } from 'react-router-dom';

// ─── Navegação a partir do relatório ──────────────────────────────────
//
// Número de relatório é pergunta pela metade: "1 orçamento em rascunho" só serve
// quando dá para ver QUAL. Todo indicador que tem uma tela capaz de listá-lo recebe
// um `to` e vira link para ELA JÁ FILTRADA (`/orcamento?status=RASCUNHO`).
//
// ⚠️ `to` é OPCIONAL e fica de fora quando a tela de destino não consegue mostrar
// aquele recorte — link que cai numa lista sem o filtro correspondente promete uma
// resposta que a página não dá, e é pior que texto simples (armadilha 28-d).
// ⚠️ Tudo aqui é `<Link>` do react-router, nunca `<a href>`: a aplicação usa
// HashRouter, e âncora comum recarregaria o app inteiro (CLAUDE.md §14).

/** Envolve o conteúdo num link quando há destino; devolve o próprio conteúdo quando não há. */
function TalvezLink({ to, className, children }: { to?: string; className?: string; children: ReactNode }) {
  if (!to) return <>{children}</>;
  return <Link to={to} className={className}>{children}</Link>;
}

// ─── Formatação ────────────────────────────────────────────────────────────────

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export function formatBRL(v: number) {
  return (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatNum(v: number) {
  return (v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

export function formatMesRef(ref: string | null) {
  if (!ref) return '—';
  const [ano, mes] = ref.split('-');
  return `${MESES[Number(mes) - 1]}/${ano}`;
}

export function formatData(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ─── Componentes ───────────────────────────────────────────────────────────────

export function Card({ icon, titulo, tituloTo, subtitulo, children }: {
  icon:       ReactNode;
  titulo:     string;
  /** Tela que lista o que este card resume. Sem ele o título é texto simples. */
  tituloTo?:  string;
  subtitulo?: string;
  children:   ReactNode;
}) {
  return (
    <div className="min-w-0 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col">
      <div className="flex items-start gap-2.5 px-5 py-4 border-b border-gray-100">
        <span className="text-emerald-600 mt-0.5">{icon}</span>
        <div>
          <h2 className="font-bold text-gray-900 text-sm">
            {tituloTo
              ? <Link to={tituloTo} className="text-emerald-800 hover:text-emerald-900 hover:underline underline-offset-2">{titulo}</Link>
              : titulo}
          </h2>
          {subtitulo && <p className="text-[11px] text-gray-400 mt-0.5">{subtitulo}</p>}
        </div>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

export function EmptyState({ texto }: { texto: string }) {
  return <p className="text-center text-xs text-gray-400 py-8">{texto}</p>;
}

// Tabela responsiva: no desktop é tabela; no mobile vira cards empilhados
// (rótulo da coluna via `data-label`, estilizado em index.css → `table.rel-table`).
// Cada <td> recebe o rótulo da coluna correspondente automaticamente (sem alterar
// os call sites) clonando as linhas/células.
export function Tabela({ colunas, children }: { colunas: string[]; children: ReactNode }) {
  const linhas = Children.map(children, (linha) => {
    if (!isValidElement(linha)) return linha;
    const tr = linha as ReactElement<{ children?: ReactNode }>;
    const celulas = Children.toArray(tr.props.children).map((cel, i) => {
      if (!isValidElement(cel)) return cel;
      const td = cel as ReactElement<{ colSpan?: number }>;
      const label = td.props.colSpan ? '' : (colunas[i] ?? '');
      return cloneElement(td as ReactElement<Record<string, unknown>>, { 'data-label': label });
    });
    return cloneElement(tr, {}, celulas);
  });

  return (
    <div className="overflow-x-auto max-h-80 overflow-y-auto">
      <table className="rel-table w-full text-sm">
        <thead className="sticky top-0 bg-gray-50">
          <tr className="border-b border-gray-100">
            {colunas.map((c, i) => (
              <th key={c + i} className={`px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap ${i === 0 ? 'text-left' : 'text-right'}`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">{linhas}</tbody>
      </table>
    </div>
  );
}

/** Link dentro de uma célula de tabela do relatório — leva à tela que lista aquela
 *  linha. Sem `to`, renderiza o texto simples: linha sem destino não finge ser link. */
export function CelulaLink({ to, children }: { to?: string; children: ReactNode }) {
  if (!to) return <>{children}</>;
  return (
    <Link to={to} className="text-emerald-800 font-medium hover:text-emerald-900 hover:underline underline-offset-2">
      {children}
    </Link>
  );
}

export function BigNumber({ valor, label }: { valor: number | string; label: string }) {
  return (
    <div className="px-5 py-4 flex items-baseline gap-2 border-b border-gray-50">
      <span className="text-3xl font-bold text-gray-900">{valor}</span>
      <span className="text-xs text-gray-400">{label}</span>
    </div>
  );
}

// Grade de números-resumo (tiles). Cada tile: label + valor (+ tom opcional).
export interface StatTile {
  label:  string;
  valor:  string | number;
  tom?:   'emerald' | 'red' | 'amber' | 'gray';
  hint?:  string;
  /** Tela que lista o que este número conta, já filtrada. Sem `to`, o tile não é
   *  clicável — e não ganha nenhuma pista visual de que seria. */
  to?:    string;
}

const TOM_CLS: Record<NonNullable<StatTile['tom']>, string> = {
  emerald: 'text-emerald-700',
  red:     'text-red-600',
  amber:   'text-amber-600',
  gray:    'text-gray-900',
};

export function StatTiles({ tiles, cols = 4 }: { tiles: StatTile[]; cols?: 2 | 3 | 4 }) {
  const gridCls = cols === 2 ? 'grid-cols-2' : cols === 3 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 lg:grid-cols-4';
  return (
    <div className={`grid ${gridCls} gap-3`}>
      {tiles.map((t) => (
        <TalvezLink key={t.label} to={t.to}
          className="block rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
          <div className={`h-full bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3.5 ${
            t.to ? 'transition-colors hover:border-emerald-300 hover:bg-emerald-50/40 cursor-pointer' : ''
          }`}>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{t.label}</p>
            <p className={`text-2xl font-bold mt-1 ${TOM_CLS[t.tom ?? 'gray']}`}>{t.valor}</p>
            {t.hint && <p className="text-[10px] text-gray-400 mt-0.5">{t.hint}</p>}
          </div>
        </TalvezLink>
      ))}
    </div>
  );
}

// Ranking com barra horizontal proporcional ao maior valor.
export function RankBars({ itens, formato = 'num' }: {
  itens:   { nome: string; valor: number; to?: string }[];
  formato?: 'num' | 'brl';
}) {
  if (itens.length === 0) return <EmptyState texto="Sem dados no período" />;
  const max = Math.max(...itens.map(i => i.valor), 1);
  const fmt = formato === 'brl' ? formatBRL : formatNum;
  return (
    <div className="px-5 py-4 space-y-2.5">
      {itens.map((i) => (
        <TalvezLink key={i.nome} to={i.to}
          className={`block rounded-lg -mx-1.5 px-1.5 py-0.5 ${i.to ? 'transition-colors hover:bg-emerald-50' : ''}`}>
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className={`truncate pr-2 ${i.to ? 'text-emerald-800 font-medium' : 'text-gray-700'}`}>{i.nome}</span>
              <span className="font-semibold text-gray-900 whitespace-nowrap">{fmt(i.valor)}</span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.max((i.valor / max) * 100, 2)}%` }} />
            </div>
          </div>
        </TalvezLink>
      ))}
    </div>
  );
}

// Estados de página (carregando / erro) — padrão comum às páginas de relatório.
export function CarregandoRelatorio() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="animate-spin w-6 h-6 border-4 border-emerald-600 border-t-transparent rounded-full" />
    </div>
  );
}

export function ErroRelatorio() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-gray-400">
      <p className="text-sm">Não foi possível carregar o relatório.</p>
    </div>
  );
}
