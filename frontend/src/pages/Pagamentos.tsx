// frontend/src/pages/Pagamentos.tsx
//
// FINANCEIRO > PAGAMENTOS (2026-09-10)
//
// 🔴 É O OUTRO LADO DO BALCÃO DA FATURA. `Faturamento.tsx` responde "quanto o cliente
// me deve"; esta tela responde "quanto eu devo ao fornecedor e ao prestador". Os dois
// nascem do MESMO evento — a execução — e por isso conferem entre si, mas são
// documentos diferentes, para pessoas diferentes, com totais diferentes.
//
// 🔴 UMA tela para os dois tipos, escolhidos por aba. FORNECEDOR e PRESTADOR têm o
// mesmo ciclo (abrir → fechar → pagar) e o mesmo formato de linha; duas telas
// divergiriam na primeira correção — e o que divergiria seria como a clínica apura o
// que paga.
//
// ⚠️ Cada linha traz o que o pedido exige: o ANIMAL, o valor, a DATA e QUEM SOLICITOU.
//
// ⚠️ Os lançamentos nascem SOZINHOS, na execução (prescrição, vacina, procedimento).
// O "Lançar" desta tela é para o que o automático não pegou — o item sem preço de
// compra cadastrado, por exemplo.
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Wallet, Truck, HardHat, Loader2, Plus, Check, Lock, Ban, Trash2, AlertTriangle, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import InlineError from '../components/InlineError';
import ErroAcao, { type ErroAcaoDados } from '../components/ErroAcao';
import AcaoRegistro, { AcoesRegistro } from '../components/AcaoRegistro';
import ModalJustificativa from '../components/ModalJustificativa';
import JanelaLista from '../components/JanelaLista';
import PeriodoSelector from '../components/relatorios/PeriodoSelector';
import { usePeriodo, periodoParams } from '../contexts/PeriodoContext';
import { usePermissoes } from '../hooks/usePermissoes';
import { useEmpresa } from '../contexts/EmpresaContext';
import { formatDataHora } from '../utils/dateUtils';

type TipoConta = 'FORNECEDOR' | 'PRESTADOR';

interface ItemConta {
  id:              number;
  animalId:        number | null;
  animalNome:      string;
  descricao:       string;
  quantidade:      number;
  valor:           number;
  solicitanteNome: string;
  ocorridoEm:      string;
  origemTipo:      string | null;
}

interface Conta {
  id:            number;
  tipo:          TipoConta;
  credorId:      number;
  credorNome:    string;
  mesReferencia: string | null;
  total:         number;
  status:        'ABERTA' | 'FECHADA' | 'PAGA' | 'CANCELADA';
  itens:         ItemConta[];
}

interface Credor { id: number; nome: string; tipoServico: string | null }

const brl = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Cores por SIGNIFICADO, na paleta da §6: aberta é o que ainda corre (âmbar),
 * fechada é o que foi conferido (azul), paga é o que terminou bem (emerald), e
 * cancelada é o vermelho de sempre.
 */
const STATUS: Record<Conta['status'], { label: string; cls: string }> = {
  ABERTA:    { label: 'Aberta',    cls: 'text-amber-700 bg-amber-50 border-amber-200' },
  FECHADA:   { label: 'Fechada',   cls: 'text-blue-700 bg-blue-50 border-blue-200' },
  PAGA:      { label: 'Paga',      cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  CANCELADA: { label: 'Cancelada', cls: 'text-red-700 bg-red-50 border-red-200' },
};

/** Rótulo da origem — é o que distingue o lançamento automático do manual. */
const ORIGEM_LABEL: Record<string, string> = {
  PRESCRICAO_ITEM:    'Prescrição',
  VACINA:             'Vacina',
  EXECUCAO_PRESTADOR: 'Procedimento',
  MANUAL:             'Lançado à mão',
};

export default function Pagamentos() {
  const { podeExecutar, loading: loadingPerms } = usePermissoes();
  const { loading: empresaLoading } = useEmpresa();
  const { granularidade, data: dataRef } = usePeriodo();

  const podeVer    = podeExecutar('financeiro.pagamentos.ler');
  const podeLancar = podeExecutar('financeiro.pagamentos.lancar');
  const podePagar  = podeExecutar('financeiro.pagamentos.pagar');

  const [tipo,     setTipo]     = useState<TipoConta>('FORNECEDOR');
  const [contas,   setContas]   = useState<Conta[]>([]);
  const [credores, setCredores] = useState<Credor[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [disponivel, setDisponivel] = useState(true);

  const [erroInline, setErroInline] = useState<string | null>(null);
  const [erroAcao,   setErroAcao]   = useState<ErroAcaoDados | null>(null);
  const [cancelando, setCancelando] = useState<Conta | null>(null);
  const [removendo,  setRemovendo]  = useState<ItemConta | null>(null);
  const [mostrarLancar, setMostrarLancar] = useState(false);
  const [novo, setNovo] = useState({ credorId: '', descricao: '', valor: '', quantidade: '1', animalNome: '' });
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const res = await api.get('/financeiro/contas-pagar', {
        params: { tipo, ...periodoParams(granularidade, dataRef) },
      });
      if (!res.data) return;                       // GET 403 resolve com data null
      setContas(res.data.dados ?? []);
      setDisponivel(res.data.recursos?.disponivel !== false);
    } catch { /* silencioso */ }
  }, [tipo, granularidade, dataRef]);

  const carregarCredores = useCallback(async () => {
    try {
      const res = await api.get('/financeiro/contas-pagar/credores', { params: { tipo } });
      if (res.data) setCredores(res.data.dados ?? []);
    } catch { /* silencioso */ }
  }, [tipo]);

  useEffect(() => {
    // ⚠️ Espera o contexto de empresa: chamada escopada antes disso cai no fallback
    // do backend e traz a conta de OUTRA clínica.
    if (loadingPerms || empresaLoading || !podeVer) return;
    setLoading(true);
    Promise.all([carregar(), carregarCredores()]).finally(() => setLoading(false));
  }, [loadingPerms, empresaLoading, podeVer, carregar, carregarCredores]);

  const total = useMemo(
    // ⚠️ CANCELADA fica FORA do total: ela é registro do que deixou de valer, e
    // somá-la afirmaria uma dívida que a clínica já desfez.
    () => contas.filter(c => c.status !== 'CANCELADA').reduce((s, c) => s + (c.total ?? 0), 0),
    [contas],
  );
  const totalAberto = useMemo(
    () => contas.filter(c => c.status === 'ABERTA' || c.status === 'FECHADA')
                .reduce((s, c) => s + (c.total ?? 0), 0),
    [contas],
  );

  const mudarStatus = async (conta: Conta, status: Conta['status'], motivo?: string) => {
    setErroAcao(null);
    try {
      await api.patch(`/financeiro/contas-pagar/${conta.id}/status`, { status, motivo });
      toast.success(status === 'PAGA' ? 'Conta marcada como paga' : `Conta ${STATUS[status].label.toLowerCase()}`);
      setCancelando(null);
      await carregar();
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErroAcao({ mensagem: e.response?.data?.error ?? 'Erro ao alterar a conta.' });
    }
  };

  const lancar = async () => {
    setErroAcao(null);
    if (!novo.credorId)          { setErroAcao({ mensagem: 'Selecione o credor.' }); return; }
    if (!novo.descricao.trim())  { setErroAcao({ mensagem: 'Informe a descrição.' }); return; }
    const credor = credores.find(c => String(c.id) === novo.credorId);
    setSalvando(true);
    try {
      await api.post('/financeiro/contas-pagar/lancar', {
        tipo,
        credorId:   Number(novo.credorId),
        credorNome: credor?.nome ?? '',
        descricao:  novo.descricao.trim(),
        quantidade: Number(novo.quantidade) || 1,
        valor:      Number(String(novo.valor).replace(/\./g, '').replace(',', '.')),
        animalNome: novo.animalNome.trim(),
      });
      toast.success('Lançamento registrado');
      setNovo({ credorId: '', descricao: '', valor: '', quantidade: '1', animalNome: '' });
      setMostrarLancar(false);
      await carregar();
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErroAcao({ mensagem: e.response?.data?.error ?? 'Erro ao lançar.' });
    } finally { setSalvando(false); }
  };

  const removerItem = async (motivo: string) => {
    if (!removendo) return;
    try {
      await api.delete(`/financeiro/contas-pagar/itens/${removendo.id}`, { data: { motivo } });
      toast.success('Item removido');
      setRemovendo(null);
      await carregar();
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErroInline(e.response?.data?.error ?? 'Erro ao remover o item.');
    }
  };

  if (!loadingPerms && !podeVer) {
    return (
      <PageContainer>
        <div className="text-center py-16">
          <h2 className="text-lg font-semibold text-gray-800">Acesso não autorizado</h2>
          <p className="text-sm text-gray-500 mt-1">Você não tem permissão para ver os pagamentos.</p>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <BotaoVoltar />
      {erroInline && <InlineError message={erroInline} />}

      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Wallet size={22} className="text-emerald-600" /> Pagamentos
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            O que a clínica deve a fornecedores e prestadores.
          </p>
        </div>
        {podeLancar && (
          <button onClick={() => setMostrarLancar(v => !v)}
            className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 rounded-xl text-sm font-semibold">
            <Plus size={15} /> Lançar
          </button>
        )}
      </div>

      <PeriodoSelector />

      {!disponivel && (
        <div className="my-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-2">
          <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 leading-snug">
            <strong>Pagamentos ainda não disponível nesta base.</strong> Falta aplicar a migration{' '}
            <code className="font-mono">20261006000000_produtos_contas_pagar</code>.
          </p>
        </div>
      )}

      {/* ── Abas Fornecedor × Prestador ────────────────────────────────────── */}
      <div className="flex items-center gap-2 my-4">
        {(['FORNECEDOR', 'PRESTADOR'] as TipoConta[]).map(t => {
          const ativo = tipo === t;
          const Icone = t === 'PRESTADOR' ? HardHat : Truck;
          return (
            <button key={t} onClick={() => setTipo(t)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                ativo ? 'bg-emerald-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}>
              <Icone size={15} /> {t === 'PRESTADOR' ? 'Prestadores' : 'Fornecedores'}
            </button>
          );
        })}
      </div>

      {/* Totais do período — o "quanto vou pagar" é a primeira pergunta da tela. */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Total no período</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{brl(total)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">A pagar</p>
          <p className="text-xl font-bold text-amber-700 mt-1">{brl(totalAberto)}</p>
        </div>
      </div>

      {mostrarLancar && podeLancar && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                {tipo === 'PRESTADOR' ? 'Prestador' : 'Fornecedor'} *
              </label>
              <select value={novo.credorId} onChange={e => setNovo(n => ({ ...n, credorId: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:border-emerald-400">
                <option value="">Selecione…</option>
                {credores.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Descrição *</label>
              <input value={novo.descricao} onChange={e => setNovo(n => ({ ...n, descricao: e.target.value }))}
                placeholder="O que está sendo pago"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-400" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Valor *</label>
              <input value={novo.valor} onChange={e => setNovo(n => ({ ...n, valor: e.target.value }))}
                inputMode="decimal" placeholder="0,00"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-right focus:outline-none focus:border-emerald-400" />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 mt-3">
            <button onClick={() => setMostrarLancar(false)}
              className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100">Cancelar</button>
            <button onClick={lancar} disabled={salvando}
              className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-60">
              {salvando ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Lançar
            </button>
          </div>
          <ErroAcao erro={erroAcao} />
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-14"><Loader2 size={22} className="animate-spin text-emerald-600" /></div>
      ) : contas.length === 0 ? (
        <div className="text-center py-14 text-gray-400 text-sm">
          Nenhuma conta de {tipo === 'PRESTADOR' ? 'prestador' : 'fornecedor'} no período.
        </div>
      ) : (
        <div className="space-y-3">
          {contas.map(conta => (
            <div key={conta.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-gray-50">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 text-sm truncate">{conta.credorNome}</p>
                  <p className="text-[11px] text-gray-400">
                    {conta.mesReferencia ?? '—'} · {conta.itens.length} lançamento(s)
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATUS[conta.status].cls}`}>
                    {STATUS[conta.status].label}
                  </span>
                  <span className="font-bold text-gray-900">{brl(conta.total)}</span>
                  <AcoesRegistro>
                    {/* Fechar → conferida. Pagar → quitada. Só quem tem `pagar` decide
                        isso: lançar a dívida e dar por paga são atos diferentes. */}
                    <AcaoRegistro tom="imprimir" icone={Lock} rotulo="Fechar"
                      visivel={podePagar && conta.status === 'ABERTA'}
                      onClick={() => mudarStatus(conta, 'FECHADA')} />
                    <AcaoRegistro tom="finalizar" icone={Check} rotulo="Marcar como paga"
                      visivel={podePagar && (conta.status === 'ABERTA' || conta.status === 'FECHADA')}
                      onClick={() => mudarStatus(conta, 'PAGA')} />
                    <AcaoRegistro tom="cancelar" icone={Ban} rotulo="Cancelar"
                      visivel={podePagar && conta.status !== 'CANCELADA' && conta.status !== 'PAGA'}
                      onClick={() => setCancelando(conta)} />
                  </AcoesRegistro>
                </div>
              </div>

              <JanelaLista maxItens={3}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-50">
                      <th className="px-4 py-2 font-semibold">Animal</th>
                      <th className="px-4 py-2 font-semibold">Item</th>
                      <th className="px-4 py-2 font-semibold">Solicitante</th>
                      <th className="px-4 py-2 font-semibold whitespace-nowrap">Data</th>
                      <th className="px-4 py-2 font-semibold text-right whitespace-nowrap">Valor</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {conta.itens.map(it => (
                      <tr key={it.id} className="border-b border-gray-50 last:border-0">
                        <td className="px-4 py-2 text-gray-700">{it.animalNome || '—'}</td>
                        <td className="px-4 py-2">
                          <span className="text-gray-900">{it.descricao}</span>
                          {it.origemTipo && (
                            <span className="ml-2 text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
                              {ORIGEM_LABEL[it.origemTipo] ?? it.origemTipo}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-gray-500 text-xs">{it.solicitanteNome || '—'}</td>
                        <td className="px-4 py-2 text-gray-500 text-xs whitespace-nowrap">
                          {/* INSTANTE — `formatDataHora`, nunca `formatDate` (§6): a
                              execução das 22h cairia no dia seguinte lida em UTC. */}
                          {formatDataHora(it.ocorridoEm)}
                        </td>
                        <td className="px-4 py-2 text-right font-semibold text-gray-800 whitespace-nowrap">
                          {brl(it.valor * (it.quantidade ?? 1))}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {/* Conta PAGA é somente leitura: remover item de um pagamento
                              já quitado mudaria um documento que o credor recebeu. */}
                          <AcoesRegistro>
                            <AcaoRegistro tom="cancelar" icone={Trash2} rotulo="Remover"
                              visivel={podeLancar && conta.status !== 'PAGA' && conta.status !== 'CANCELADA'}
                              onClick={() => setRemovendo(it)} />
                          </AcoesRegistro>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </JanelaLista>
            </div>
          ))}
        </div>
      )}

      <ErroAcao erro={erroAcao} />

      <ModalJustificativa
        aberto={!!cancelando}
        titulo="Cancelar conta a pagar"
        descricao={cancelando ? `Cancelar a conta de ${cancelando.credorNome} (${brl(cancelando.total)})?` : ''}
        acaoLabel="Cancelar conta"
        onConfirmar={async motivo => { if (cancelando) await mudarStatus(cancelando, 'CANCELADA', motivo); }}
        onFechar={() => setCancelando(null)}
      />

      <ModalJustificativa
        aberto={!!removendo}
        titulo="Remover lançamento"
        descricao={removendo ? `Remover "${removendo.descricao}" desta conta?` : ''}
        acaoLabel="Remover"
        onConfirmar={removerItem}
        onFechar={() => setRemovendo(null)}
      />

      {/* Fecha o formulário de lançamento com Esc — o X do cabeçalho não existe aqui. */}
      {mostrarLancar && (
        <button className="hidden" onClick={() => setMostrarLancar(false)} aria-hidden><X size={1} /></button>
      )}
    </PageContainer>
  );
}
