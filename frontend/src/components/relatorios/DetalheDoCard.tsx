// frontend/src/components/relatorios/DetalheDoCard.tsx
//
// 🔴 O NÚMERO DO CARD MOSTRA DE ONDE VEIO (a pedido, 2026-09-08).
//
// Até aqui cada indicador dos relatórios era um LINK para outra tela filtrada. Isso
// muda de página, PERDE o período escolhido no seletor e obriga a pessoa a
// reconstruir o recorte do outro lado — quando a outra tela sequer sabe fazer aquele
// recorte (a fila do plantão é do DIA, não do período).
//
// Agora o card ABRE A LISTA logo abaixo, no mesmo lugar em que o card "Histórico" do
// Atendimento já faz isso. Um componente só, porque são TRÊS telas com a mesma
// necessidade (Indicadores de Atendimento, Relatórios de Cadastro e Orçamentos) e
// três cópias divergiriam na primeira correção.
//
// ⚠️ As COLUNAS variam por tela (o cadastro mostra motivo; a consulta, status; o
// orçamento, valor), então elas são declaradas por quem usa — o que este componente
// fixa é o COMPORTAMENTO: um card selecionado por vez, o título dizendo qual, a lista
// abaixo, o vazio explicado e a janela de rolagem.

import { useState } from 'react';
import { X, ChevronRight } from 'lucide-react';
import JanelaLista from '../JanelaLista';
import { EmptyState } from './RelatorioUI';

export interface ColunaDetalhe<T> {
  titulo:   string;
  /** Conteúdo da célula. Devolver `null` deixa o traço de "sem valor". */
  celula:   (linha: T) => React.ReactNode;
  /** Some abaixo de `md` — para a coluna que não cabe no celular. */
  somenteDesktop?: boolean;
  className?: string;
}

export interface DetalheDoCardProps<T> {
  /** Rótulo do card selecionado — vira o título da seção. `null` = nada aberto. */
  titulo:  string | null;
  linhas:  T[];
  colunas: ColunaDetalhe<T>[];
  onFechar: () => void;
  /** Texto do vazio — sempre específico, nunca "nenhum resultado". */
  vazio?:  string;
  /**
   * Painel que abre DENTRO da linha, quando ela tem uma camada a mais para mostrar —
   * o caso do orçamento "aprovado parcialmente", em que o número de cima só faz
   * sentido com a quebra item a item (quais caíram, quantos, e por quê).
   *
   * Devolver `null` para uma linha faz dela uma linha comum, sem seta. É o que evita
   * oferecer a expansão onde não há nada a expandir (armadilha 28-d).
   */
  detalheDaLinha?: (linha: T) => React.ReactNode;
}

export default function DetalheDoCard<T>({
  titulo, linhas, colunas, onFechar, vazio = 'Nenhum registro neste recorte', detalheDaLinha,
}: DetalheDoCardProps<T>) {
  // Índice da linha aberta. Uma por vez: duas abertas empurram a lista para fora da
  // janela de 3 itens e a pessoa perde de vista o que estava comparando.
  const [aberta, setAberta] = useState<number | null>(null);
  if (!titulo) return null;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-800 truncate">{titulo}</p>
          <p className="text-[11px] text-gray-400">
            {linhas.length} registro{linhas.length !== 1 ? 's' : ''}
          </p>
        </div>
        {/* Cromo, não ação de registro: cinza, como o X de todo modal (§6). */}
        <button type="button" onClick={onFechar} title="Fechar"
          className="p-1 text-gray-400 hover:text-gray-600 flex-shrink-0">
          <X size={16} />
        </button>
      </div>

      {linhas.length === 0 ? <EmptyState texto={vazio} /> : (
        // Mesma janela de 3 itens do resto do sistema: a lista não empurra o relatório
        // inteiro para fora da tela quando o card tem 200 linhas.
        <JanelaLista
          maxItens={3}
          // ⚠️ EXCLUI a linha do painel expandido: contada como item, a janela
          // encolheria de 3 registros para 2 assim que alguém expandisse um.
          seletor="tbody > tr:not([data-detalhe-linha])"
        >
          <table className="w-full text-xs">
            <thead className="bg-gray-50/70">
              <tr>
                {detalheDaLinha && <th className="w-8" />}
                {colunas.map(c => (
                  <th key={c.titulo}
                    className={`text-left font-semibold text-gray-500 px-4 py-2 whitespace-nowrap ${
                      c.somenteDesktop ? 'hidden md:table-cell' : ''} ${c.className ?? ''}`}>
                    {c.titulo}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {linhas.map((linha, i) => {
                const painel = detalheDaLinha?.(linha) ?? null;
                const expandida = aberta === i;
                return [
                  <tr key={`l${i}`} className="hover:bg-gray-50/60">
                    {detalheDaLinha && (
                      <td className="pl-3 align-top">
                        {painel && (
                          <button type="button" aria-expanded={expandida}
                            title={expandida ? 'Recolher' : 'Ver os itens'}
                            onClick={() => setAberta(a => (a === i ? null : i))}
                            className="p-1 text-gray-400 hover:text-emerald-700">
                            <ChevronRight size={13} className={`transition-transform ${expandida ? 'rotate-90' : ''}`} />
                          </button>
                        )}
                      </td>
                    )}
                    {colunas.map(c => (
                      <td key={c.titulo}
                        className={`px-4 py-2 text-gray-700 align-top ${
                          c.somenteDesktop ? 'hidden md:table-cell' : ''} ${c.className ?? ''}`}>
                        {c.celula(linha) ?? <span className="text-gray-300">—</span>}
                      </td>
                    ))}
                  </tr>,
                  // ⚠️ A linha do painel NÃO leva `data-item-lista` nem entra na conta
                  // da JanelaLista: ela é o detalhe de uma linha, não um item da lista.
                  // Contada, a janela encolheria de 3 registros para 2 ao expandir um.
                  expandida && painel ? (
                    <tr key={`d${i}`} data-detalhe-linha>
                      <td colSpan={colunas.length + 1} className="bg-gray-50/60 px-4 py-3">{painel}</td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        </JanelaLista>
      )}
    </div>
  );
}
