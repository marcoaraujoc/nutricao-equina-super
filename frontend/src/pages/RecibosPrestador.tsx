// frontend/src/pages/RecibosPrestador.tsx
//
// RECIBOS DE PRESTADOR — diário, semanal, mensal e anual (2026-09-08).
//
// 🔴 FUNCIONA COMO A FATURA, MAS É UM RECIBO. A fatura é o que a clínica COBRA do
// cliente; aqui está o que ela DEVE a quem executou o procedimento. Os dois nascem do
// MESMO evento (a execução do procedimento) e por isso conferem, mas são documentos
// diferentes, para pessoas diferentes, com totais diferentes — e é por isso que esta é
// uma tela própria, e não uma aba do Faturamento.
//
// Cada linha traz o que o recibo tem de dizer: NOME DO ANIMAL, PROCEDIMENTO EXECUTADO,
// VALOR e DATA DA EXECUÇÃO.
//
// ⚠️ Os valores NÃO são calculados aqui. Chegam do backend congelados no instante da
// execução, junto da forma de pagamento que valia então — recalcular na leitura faria
// o recibo de março mudar de valor quando o percentual fosse renegociado em setembro.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { usePermissoes } from '../hooks/usePermissoes';
import { useEmpresa } from '../contexts/EmpresaContext';
import { usePeriodo, periodoParams } from '../contexts/PeriodoContext';
import PeriodoSelector from '../components/relatorios/PeriodoSelector';
import api from '../services/api';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import InlineError from '../components/InlineError';
import AcaoRegistro, { AcoesRegistro } from '../components/AcaoRegistro';
import JanelaLista from '../components/JanelaLista';
import { imprimirRecibos } from '../utils/ReciboPrestadorPrint';
import type { ReciboPrestador, ReciboPeriodo, ReciboEmitente } from '../utils/ReciboPrestadorPrint';
import { Receipt, Printer, Loader2, Search, AlertTriangle } from 'lucide-react';

const brl = (v: number | null | undefined): string =>
  v === null || v === undefined
    ? '—'
    : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const dataHora = (iso: string): string =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

/** Como o prestador é pago — o cabeçalho do recibo explica de onde saiu o total. */
const rotuloPagamento = (r: ReciboPrestador): string => {
  if (r.tipoPagamento === 'POR_PROCEDIMENTO') return 'Por procedimento';
  if (r.tipoPagamento === 'SALARIO')          return 'Salário (remuneração fixa)';
  if (r.tipoPagamento === 'COMISSAO') {
    if (r.valorPagamento == null)             return 'Comissão sem valor cadastrado';
    return r.formaPagamento === 'PERCENTUAL'
      ? `Comissão de ${String(r.valorPagamento).replace('.', ',')}% do valor do cliente`
      : `Comissão fixa de ${brl(r.valorPagamento)}`;
  }
  return 'Sem forma de pagamento cadastrada';
};

interface Totais {
  prestadores:   number;
  procedimentos: number;
  totalCliente:  number;
  totalAPagar:   number;
  pendentes:     number;
}

export default function RecibosPrestador() {
  const { podeExecutar, loading: loadingPerms } = usePermissoes();
  const { marca, loading: empresaLoading } = useEmpresa();
  const { granularidade, data } = usePeriodo();

  const [recibos,  setRecibos]  = useState<ReciboPrestador[]>([]);
  const [periodo,  setPeriodo]  = useState<ReciboPeriodo | null>(null);
  const [totais,   setTotais]   = useState<Totais | null>(null);
  const [emitente, setEmitente] = useState<ReciboEmitente | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [erro,     setErro]     = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [busca,    setBusca]    = useState('');
  // Base ainda sem a migration do ledger: a tela avisa em vez de mostrar "nada a pagar",
  // que é uma afirmação diferente (e errada).
  const [indisponivel, setIndisponivel] = useState(false);

  const podeVer      = podeExecutar('financeiro.recibos.ler');
  const podeImprimir = podeExecutar('financeiro.recibos.imprimir');

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const res = await api.get('/recibos-prestador', { params: periodoParams(granularidade, data) });
      if (!res.data) { setRecibos([]); return; }
      setRecibos(res.data.dados ?? []);
      setPeriodo(res.data.periodo ?? null);
      setTotais(res.data.totais ?? null);
      setIndisponivel(res.data.indisponivel === true);
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErro(e.response?.data?.error ?? 'Erro ao carregar os recibos');
    } finally { setLoading(false); }
  }, [granularidade, data]);

  // Nenhuma chamada escopada por empresa antes de o contexto resolver (§12) — e nada
  // antes das permissões, senão a tela dispara 403 no primeiro render.
  useEffect(() => {
    if (loadingPerms || empresaLoading) return;
    if (!podeVer) { setLoading(false); return; }
    carregar();
  }, [loadingPerms, empresaLoading, podeVer, carregar]);

  useEffect(() => {
    if (loadingPerms || empresaLoading || !podeVer) return;
    api.get('/recibos-prestador/emitente')
      .then(r => { if (r.data) setEmitente(r.data.dados ?? null); })
      .catch(() => { /* silencioso — a folha sai sem o timbre do emitente */ });
  }, [loadingPerms, empresaLoading, podeVer]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return recibos;
    // Busca por prestador OU pelo conteúdo (animal/procedimento) — procurar pelo nome
    // do paciente é o caso mais comum na conferência ("o que pagamos pelo Zeus?").
    return recibos.filter(r =>
      r.prestadorNome.toLowerCase().includes(q) ||
      r.itens.some(i => i.animal.toLowerCase().includes(q) || i.procedimento.toLowerCase().includes(q)));
  }, [recibos, busca]);

  const imprimir = (lista: ReciboPrestador[]) => {
    setErroAcao(null);
    if (lista.length === 0) { setErroAcao('Nenhum recibo para imprimir neste período.'); return; }
    imprimirRecibos(lista, periodo, emitente, marca?.logoUrl ?? null);
  };

  if (loadingPerms || empresaLoading) return (
    <PageContainer>
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full" />
      </div>
    </PageContainer>
  );

  if (!podeVer) return (
    <PageContainer>
      <BotaoVoltar className="mb-4" />
      <div className="text-center py-16">
        <h2 className="text-lg font-bold text-gray-900">Acesso não autorizado</h2>
        <p className="text-sm text-gray-500 mt-1">Você não tem permissão para visualizar esta página.</p>
      </div>
    </PageContainer>
  );

  return (
    <PageContainer>
      <BotaoVoltar className="mb-4" />
      <InlineError message={erro} className="mb-4" />

      <div className="mt-2 mb-4 flex items-center gap-3">
        <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0">
          <Receipt size={20} className="text-emerald-700" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Recibos de Prestador</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            O que a clínica deve a cada prestador pelos procedimentos executados no período.
          </p>
        </div>
      </div>

      <div className="mb-4"><PeriodoSelector /></div>

      {/* Totais do período */}
      {totais && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          {[
            { label: 'Prestadores',            valor: String(totais.prestadores) },
            { label: 'Procedimentos',          valor: String(totais.procedimentos) },
            { label: 'Cobrado dos clientes',   valor: brl(totais.totalCliente) },
            { label: 'Total a pagar',          valor: brl(totais.totalAPagar), destaque: true },
          ].map(c => (
            <div key={c.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 min-w-0">
              <p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">{c.label}</p>
              <p className={`mt-1 text-xl font-bold ${c.destaque ? 'text-emerald-700' : 'text-gray-900'}`}>
                {c.valor}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* 🔴 O aviso de pendência fica NO TOPO, não escondido em cada recibo: um
          prestador sem forma de pagamento cadastrada faz o total do período sair MENOR
          do que a clínica realmente deve, e quem paga precisa saber disso antes de
          fechar o mês. */}
      {totais && totais.pendentes > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            {totais.pendentes} procedimento{totais.pendentes !== 1 ? 's' : ''} sem valor apurado —
            o prestador está sem forma de pagamento cadastrada. O serviço aparece no recibo, mas o
            valor não entra no total. Ajuste em <strong>Cadastro › Prestadores</strong>.
          </p>
        </div>
      )}

      {/* Busca + imprimir tudo */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Buscar</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
              <input type="text" value={busca} onChange={e => setBusca(e.target.value)}
                placeholder="Prestador, paciente ou procedimento..."
                className="w-full border border-gray-200 rounded-xl pl-8 pr-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-500" />
            </div>
          </div>
          {podeImprimir && filtrados.length > 0 && (
            <button onClick={() => imprimir(filtrados)}
              className="flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors flex-shrink-0">
              <Printer size={15} />
              Imprimir {filtrados.length > 1 ? `${filtrados.length} recibos` : 'recibo'}
            </button>
          )}
        </div>
        {/* Erro da AÇÃO abaixo do botão que a disparou, nunca no topo (§6). */}
        {erroAcao && <p className="mt-2 text-xs text-red-600">{erroAcao}</p>}
      </div>

      {loading ? (
        <div className="flex justify-center py-14"><Loader2 size={22} className="animate-spin text-emerald-600" /></div>
      ) : indisponivel ? (
        <div className="text-center py-14 text-sm text-gray-500">
          O registro de execuções por prestador ainda não está disponível nesta base
          <span className="block text-xs text-gray-400 mt-1">
            (a migration <code>20261001000000_procedimento_prestador</code> precisa ser aplicada)
          </span>
        </div>
      ) : filtrados.length === 0 ? (
        <div className="text-center py-14 text-gray-400 text-sm">
          {recibos.length === 0
            ? 'Nenhum procedimento executado por prestador neste período.'
            : 'Nenhum recibo corresponde à busca.'}
        </div>
      ) : (
        <div className="space-y-4">
          {filtrados.map(r => (
            <div key={r.prestadorId} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              {/* Cabeçalho do recibo */}
              <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-gray-900">{r.prestadorNome}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {[r.tipoServico, r.documento].filter(Boolean).join(' · ') || '—'}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{rotuloPagamento(r)}</p>
                </div>
                <div className="flex items-center gap-4 flex-shrink-0">
                  <div className="text-right">
                    <p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">A pagar</p>
                    <p className="text-lg font-bold text-emerald-700">{brl(r.totalAPagar)}</p>
                  </div>
                  <AcoesRegistro>
                    <AcaoRegistro tom="imprimir" icone={Printer} rotulo="Imprimir recibo"
                      visivel={podeImprimir} onClick={() => imprimir([r])} />
                  </AcoesRegistro>
                </div>
              </div>

              {/* Itens — janela de 3, como nos demais históricos do sistema.
                  ⚠️ UMA `JanelaLista` por breakpoint, com a classe do breakpoint NELA:
                  o seletor padrão casa linha de tabela E card, então uma janela só em
                  volta dos dois blocos contaria os itens em dobro e mediria a altura
                  errada. */}
              <JanelaLista className="hidden md:block overflow-x-auto">
                <div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                        <th className="px-5 py-2.5 font-semibold">Animal</th>
                        <th className="px-5 py-2.5 font-semibold">Procedimento executado</th>
                        <th className="px-5 py-2.5 font-semibold whitespace-nowrap">Data da execução</th>
                        <th className="px-5 py-2.5 font-semibold text-right whitespace-nowrap">Cobrado do cliente</th>
                        <th className="px-5 py-2.5 font-semibold text-right">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.itens.map(i => (
                        <tr key={i.id} className="border-b border-gray-50">
                          <td className="px-5 py-2.5 font-medium text-gray-900">{i.animal || '—'}</td>
                          <td className="px-5 py-2.5 text-gray-700">
                            {i.procedimento}{i.quantidade > 1 ? ` (${i.quantidade}×)` : ''}
                            {i.explicacao && <span className="block text-[11px] text-gray-400">{i.explicacao}</span>}
                          </td>
                          <td className="px-5 py-2.5 text-gray-500 whitespace-nowrap">{dataHora(i.executadoEm)}</td>
                          <td className="px-5 py-2.5 text-right text-gray-500">{brl(i.valorCliente)}</td>
                          <td className="px-5 py-2.5 text-right font-semibold text-emerald-700">{brl(i.valor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </JanelaLista>

              {/* Mobile */}
              <JanelaLista className="md:hidden divide-y divide-gray-50">
                {r.itens.map(i => (
                  <div key={i.id} data-item-lista className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900">{i.animal || '—'}</p>
                        <p className="text-xs text-gray-600">
                          {i.procedimento}{i.quantidade > 1 ? ` (${i.quantidade}×)` : ''}
                        </p>
                        <p className="text-[11px] text-gray-400 mt-0.5">{dataHora(i.executadoEm)}</p>
                        {i.explicacao && <p className="text-[11px] text-gray-400">{i.explicacao}</p>}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold text-emerald-700">{brl(i.valor)}</p>
                        <p className="text-[11px] text-gray-400">cliente {brl(i.valorCliente)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </JanelaLista>

              {/* Rodapé do recibo */}
              <div className="px-5 py-3 bg-gray-50/60 border-t border-gray-100 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-gray-500">
                  {r.itens.length} procedimento{r.itens.length !== 1 ? 's' : ''}
                  {r.pendentes > 0 && (
                    <span className="ml-2 text-amber-700 font-semibold">
                      {r.pendentes} sem valor apurado
                    </span>
                  )}
                </span>
                <span className="text-gray-500">
                  Cobrado dos clientes <strong className="text-gray-700">{brl(r.totalCliente)}</strong>
                  {' · '}
                  A pagar <strong className="text-emerald-700">{brl(r.totalAPagar)}</strong>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
