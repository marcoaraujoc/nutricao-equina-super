// src/components/ConsumoPorClienteIA.tsx
// Metering de IA por CLIENTE (empresa) — painel ADMIN em /ai-usage.
//
// Modelo "conta única + medição interna": a conta do Google é uma só e o consumo
// é atribuído a cada tenant aqui. Sem plano configurado a empresa fica só medida
// (sem limite) — é o default seguro. Com plano, a barra mostra o % consumido e o
// backend bloqueia a chamada ao estourar (429 IA_QUOTA_EXCEDIDA).

import { useCallback, useEffect, useState } from 'react';
import { Building2, Loader2, Settings2, X, AlertTriangle, Infinity as InfinityIcon } from 'lucide-react';
import api from '../services/api';

export interface ConsumoEmpresa {
  empresaId:         number | null;
  empresaNome:       string;
  cnpj:              string | null;
  chamadas:          number;
  tokens:            number;
  tokensEntrada:     number;
  tokensSaida:       number;
  custoUsd:          number;
  mediaTokens:       number;
  plano:             string | null;
  limiteTokensMes:   number | null;
  limiteChamadasMes: number | null;
  bloquearAoExceder: boolean | null;
  planoAtivo:        boolean | null;
  pctTokens:         number | null;
  pctChamadas:       number | null;
}

interface Props {
  periodo:      string;
  formatTokens: (v: number) => string;
  formatUsd:    (v: number) => string;
}

const corBarra = (pct: number) =>
  pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500';

function BarraUso({ pct }: { pct: number | null }) {
  if (pct === null) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
        <InfinityIcon size={12} /> sem limite
      </span>
    );
  }
  return (
    <div className="min-w-[110px]">
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${corBarra(pct)}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className={`text-[10px] font-medium ${pct >= 100 ? 'text-red-600' : 'text-gray-500'}`}>
        {pct.toFixed(1)}%
      </span>
    </div>
  );
}

// ─── Modal de plano ───────────────────────────────────────────────────────────

interface FormPlano {
  plano:             string;
  limiteTokensMes:   string;
  limiteChamadasMes: string;
  bloquearAoExceder: boolean;
  ativo:             boolean;
}

function ModalPlano({
  empresa, onFechar, onSalvo,
}: { empresa: ConsumoEmpresa; onFechar: () => void; onSalvo: () => void }) {
  const [form, setForm] = useState<FormPlano>({
    plano:             empresa.plano ?? 'PADRAO',
    limiteTokensMes:   empresa.limiteTokensMes   != null ? String(empresa.limiteTokensMes)   : '',
    limiteChamadasMes: empresa.limiteChamadasMes != null ? String(empresa.limiteChamadasMes) : '',
    bloquearAoExceder: empresa.bloquearAoExceder ?? true,
    ativo:             empresa.planoAtivo ?? true,
  });
  const [salvando, setSalvando] = useState(false);
  const [erro,     setErro]     = useState<string | null>(null);

  const salvar = async () => {
    if (!empresa.empresaId) return;
    setSalvando(true);
    setErro(null);
    try {
      await api.put(`/ai-usage/planos/${empresa.empresaId}`, {
        plano:             form.plano,
        limiteTokensMes:   form.limiteTokensMes   === '' ? null : Number(form.limiteTokensMes),
        limiteChamadasMes: form.limiteChamadasMes === '' ? null : Number(form.limiteChamadasMes),
        bloquearAoExceder: form.bloquearAoExceder,
        ativo:             form.ativo,
      });
      onSalvo();
      onFechar();
    } catch {
      setErro('Não foi possível salvar o plano.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 rounded-t-2xl">
          <h3 className="text-sm font-bold text-gray-900">Plano de IA — {empresa.empresaNome}</h3>
          <button type="button" onClick={onFechar} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Nome do plano</label>
            <input
              value={form.plano}
              onChange={e => setForm(f => ({ ...f, plano: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm"
              placeholder="PADRAO"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Tokens / mês</label>
              <input
                type="number" min={0}
                value={form.limiteTokensMes}
                onChange={e => setForm(f => ({ ...f, limiteTokensMes: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm"
                placeholder="sem limite"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Chamadas / mês</label>
              <input
                type="number" min={0}
                value={form.limiteChamadasMes}
                onChange={e => setForm(f => ({ ...f, limiteChamadasMes: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm"
                placeholder="sem limite"
              />
            </div>
          </div>
          <p className="text-[11px] text-gray-400 -mt-1">Campo vazio = sem limite naquela dimensão.</p>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.bloquearAoExceder}
              onChange={e => setForm(f => ({ ...f, bloquearAoExceder: e.target.checked }))}
              className="mt-0.5"
            />
            <span className="text-sm text-gray-700">
              Bloquear ao exceder
              <span className="block text-[11px] text-gray-400">
                Desmarcado = modo observação: deixa passar e apenas sinaliza aqui.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.ativo}
              onChange={e => setForm(f => ({ ...f, ativo: e.target.checked }))}
              className="mt-0.5"
            />
            <span className="text-sm text-gray-700">
              Plano ativo
              <span className="block text-[11px] text-gray-400">
                Desmarcado = recursos de IA desligados para esta empresa.
              </span>
            </span>
          </label>

          {erro && <p className="text-xs text-red-500">{erro}</p>}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button type="button" onClick={onFechar}
            className="px-4 py-2 text-xs font-semibold text-gray-500 hover:bg-gray-50 rounded-xl">
            Cancelar
          </button>
          <button type="button" onClick={salvar} disabled={salvando}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-emerald-700 text-white rounded-xl hover:bg-emerald-800 disabled:opacity-50">
            {salvando && <Loader2 size={13} className="animate-spin" />}
            Salvar plano
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Painel ───────────────────────────────────────────────────────────────────

export default function ConsumoPorClienteIA({ periodo, formatTokens, formatUsd }: Props) {
  const [dados,      setDados]      = useState<ConsumoEmpresa[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [editando,   setEditando]   = useState<ConsumoEmpresa | null>(null);
  const [apuraPlano, setApuraPlano] = useState(true);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const res = await api.get(`/ai-usage/por-empresa?periodo=${periodo}`);
      if (!res.data) return;
      setDados(res.data.dados ?? []);
      setApuraPlano(Boolean(res.data.meta?.apuracaoDoPlano));
    } catch {
      /* silencioso */
    } finally {
      setCarregando(false);
    }
  }, [periodo]);

  useEffect(() => { carregar(); }, [carregar]);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-6">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-50 rounded-xl flex items-center justify-center">
            <Building2 size={15} className="text-blue-600" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-800">Consumo por cliente</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Conta única no Google, custo atribuído por empresa
            </p>
          </div>
        </div>
        <span className="text-xs text-gray-400">{dados.length} clientes</span>
      </div>

      {!apuraPlano && dados.some(d => d.plano) && (
        <div className="px-5 py-2.5 bg-amber-50 border-b border-amber-100 flex items-start gap-2">
          <AlertTriangle size={13} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-700">
            O plano é apurado no mês corrente. Selecione <strong>Este mês</strong> para ver o
            percentual que o bloqueio realmente usa.
          </p>
        </div>
      )}

      {carregando ? (
        <p className="text-center py-10 text-gray-400 text-sm">Carregando...</p>
      ) : dados.length === 0 ? (
        <p className="text-center py-10 text-gray-300 text-sm">Nenhum consumo no período</p>
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="md:hidden divide-y divide-gray-50">
            {dados.map(d => (
              <div key={d.empresaId ?? 'sem'} className="px-5 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{d.empresaNome}</p>
                    <p className="text-[11px] text-gray-400">{d.plano ?? 'sem plano'}</p>
                  </div>
                  <span className="text-xs font-semibold text-emerald-700">{formatUsd(d.custoUsd)}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2 text-xs text-gray-500">
                  <span>{d.chamadas} chamadas</span>
                  <span>{formatTokens(d.tokens)} tokens</span>
                  <span>{formatTokens(d.mediaTokens)}/chamada</span>
                </div>
                <div className="mt-2 flex items-end justify-between gap-3">
                  <BarraUso pct={d.pctTokens} />
                  {d.empresaId && (
                    <button type="button" onClick={() => setEditando(d)}
                      className="text-[11px] font-medium text-emerald-700 hover:text-emerald-800">
                      Plano
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: tabela */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left  px-5 py-3 text-xs font-medium text-gray-400">Cliente</th>
                  <th className="text-left  px-5 py-3 text-xs font-medium text-gray-400">Plano</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-gray-400">Chamadas</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-gray-400">Tokens</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-gray-400">Média/chamada</th>
                  <th className="text-left  px-5 py-3 text-xs font-medium text-gray-400">Uso do limite</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-gray-400">Custo</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {dados.map(d => (
                  <tr key={d.empresaId ?? 'sem'} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-5 py-3">
                      <p className="text-xs font-medium text-gray-800">{d.empresaNome}</p>
                      {d.cnpj && <p className="text-[10px] text-gray-400">{d.cnpj}</p>}
                    </td>
                    <td className="px-5 py-3">
                      {d.plano ? (
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg ${
                          d.planoAtivo === false
                            ? 'bg-red-100 text-red-700'
                            : d.bloquearAoExceder ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {d.planoAtivo === false ? 'desativado' : d.plano}
                        </span>
                      ) : (
                        <span className="text-[11px] text-gray-400">só medição</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs text-gray-700 text-right font-medium">{d.chamadas}</td>
                    <td className="px-5 py-3 text-xs text-gray-700 text-right font-medium">{formatTokens(d.tokens)}</td>
                    <td className="px-5 py-3 text-xs text-gray-500 text-right">{formatTokens(d.mediaTokens)}</td>
                    <td className="px-5 py-3"><BarraUso pct={d.pctTokens} /></td>
                    <td className="px-5 py-3 text-xs text-emerald-700 text-right font-semibold">{formatUsd(d.custoUsd)}</td>
                    <td className="px-5 py-3 text-right">
                      {d.empresaId && (
                        <button type="button" onClick={() => setEditando(d)}
                          title="Configurar plano"
                          className="text-gray-400 hover:text-emerald-700">
                          <Settings2 size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editando && (
        <ModalPlano
          empresa={editando}
          onFechar={() => setEditando(null)}
          onSalvo={carregar}
        />
      )}
    </div>
  );
}
