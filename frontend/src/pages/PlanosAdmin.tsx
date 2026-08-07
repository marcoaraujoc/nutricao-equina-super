// src/pages/PlanosAdmin.tsx
//
// CADASTRO DE PLANOS DO SaaS — só ADMIN da plataforma. O plano define o VALOR, o LIMITE
// de acessos e a VALIDADE. Nome + valor aparecem, em leitura, na tela da empresa do
// gestor. Criação/edição de empresa (que consome estes planos) é em EquipeManager.
import { useState, useEffect, useCallback } from 'react';
import { Layers, Loader2, Plus, Pencil, Power, X } from 'lucide-react';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import InlineError from '../components/InlineError';
import ErroAcao, { type ErroAcaoDados } from '../components/ErroAcao';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';

interface Plano {
  id:             number;
  nome:           string;
  precoMensal:    number | null;
  limiteUsuarios: number | null;
  validadeDias:   number | null;
  ativo:          boolean;
}

type FormPlano = { nome: string; valor: string; limiteUsuarios: string; validadeDias: string };
const FORM_VAZIO: FormPlano = { nome: '', valor: '', limiteUsuarios: '', validadeDias: '' };

const moedaBR = (v: number | null) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const limiteLabel = (n: number | null) => (n == null ? 'Ilimitado' : `Até ${n}`);
const validadeLabel = (d: number | null) => (d == null ? 'Sem validade' : `${d} dia${d > 1 ? 's' : ''}`);

const INPUT = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500';

export default function PlanosAdmin() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN' || user?.userType === 'ADMIN';

  const [planos,     setPlanos]     = useState<Plano[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [erroInline, setErroInline] = useState<string | null>(null);

  const [modalAberto, setModalAberto] = useState(false);
  const [editId,      setEditId]      = useState<number | null>(null);
  const [form,        setForm]        = useState<FormPlano>(FORM_VAZIO);
  const [salvando,    setSalvando]    = useState(false);
  const [erroModal,   setErroModal]   = useState<ErroAcaoDados | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/planos');
      if (!res.data) return;                 // GET 403 → data null
      setPlanos(res.data.dados ?? []);
      setErroInline(null);
    } catch {
      setErroInline('Erro ao carregar os planos.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (isAdmin) carregar(); else setLoading(false); }, [isAdmin, carregar]);

  const abrirNovo = () => { setEditId(null); setForm(FORM_VAZIO); setErroModal(null); setModalAberto(true); };
  const abrirEdicao = (p: Plano) => {
    setEditId(p.id);
    setForm({
      nome:           p.nome,
      valor:          p.precoMensal != null ? String(p.precoMensal).replace('.', ',') : '',
      limiteUsuarios: p.limiteUsuarios != null ? String(p.limiteUsuarios) : '',
      validadeDias:   p.validadeDias != null ? String(p.validadeDias) : '',
    });
    setErroModal(null);
    setModalAberto(true);
  };

  const salvar = async () => {
    setErroModal(null);
    if (!form.nome.trim()) { setErroModal({ mensagem: 'Informe o nome do plano.', campos: ['nome'] }); return; }
    const payload = {
      nome:           form.nome.trim(),
      valor:          form.valor.trim() ? Number(form.valor.replace(/\./g, '').replace(',', '.')) : null,
      limiteUsuarios: form.limiteUsuarios.trim() ? Number(form.limiteUsuarios) : null,
      validadeDias:   form.validadeDias.trim() ? Number(form.validadeDias) : null,
    };
    setSalvando(true);
    try {
      if (editId) await api.put(`/planos/${editId}`, payload);
      else        await api.post('/planos', payload);
      toast.success(editId ? 'Plano atualizado' : 'Plano criado');
      setModalAberto(false);
      carregar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } })?.response?.data?.mensagem;
      setErroModal({ mensagem: msg ?? 'Erro ao salvar o plano.' });
    } finally { setSalvando(false); }
  };

  const toggle = async (p: Plano) => {
    try {
      await api.patch(`/planos/${p.id}/toggle`);
      carregar();
    } catch { toast.error('Não foi possível alterar o plano.'); }
  };

  if (!isAdmin) {
    return (
      <PageContainer>
        <div className="text-center py-16">
          <h2 className="text-lg font-semibold text-gray-700 mb-2">Acesso não autorizado</h2>
          <p className="text-sm text-gray-500">Apenas o administrador da plataforma gerencia os planos.</p>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer maxWidth="5xl">
      <BotaoVoltar />
      <InlineError message={erroInline} className="mt-3" />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-2 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Layers size={24} className="text-emerald-600 flex-shrink-0" />
            Planos
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Valor, limite de acessos e validade de cada plano.</p>
        </div>
        <button onClick={abrirNovo}
          className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2.5 rounded-2xl font-semibold text-sm transition-colors self-start">
          <Plus size={16} /> Novo Plano
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-emerald-600" /></div>
      ) : planos.length === 0 ? (
        <div className="text-center py-16 text-sm text-gray-500">Nenhum plano cadastrado ainda.</div>
      ) : (
        <>
          {/* Cards no mobile */}
          <div className="md:hidden space-y-3">
            {planos.map(p => (
              <div key={p.id} className={`bg-white rounded-2xl border shadow-sm p-4 ${p.ativo ? 'border-gray-100' : 'border-gray-200 opacity-60'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900">{p.nome}</p>
                    <p className="text-sm text-gray-500">{moedaBR(p.precoMensal)}{p.precoMensal != null && ' /mês'}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => abrirEdicao(p)} title="Editar" className="p-2 rounded-lg text-orange-500 hover:bg-orange-50"><Pencil size={16} /></button>
                    <button onClick={() => toggle(p)} title={p.ativo ? 'Inativar' : 'Ativar'} className={`p-2 rounded-lg ${p.ativo ? 'text-red-500 hover:bg-red-50' : 'text-emerald-600 hover:bg-emerald-50'}`}><Power size={16} /></button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                  <span>Acessos: <b className="text-gray-700">{limiteLabel(p.limiteUsuarios)}</b></span>
                  <span>Validade: <b className="text-gray-700">{validadeLabel(p.validadeDias)}</b></span>
                  {!p.ativo && <span className="text-red-500 font-semibold">Inativo</span>}
                </div>
              </div>
            ))}
          </div>

          {/* Tabela no desktop */}
          <div className="hidden md:block bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest border-b border-gray-100">
                  <th className="px-5 py-3">Plano</th>
                  <th className="px-5 py-3">Valor / mês</th>
                  <th className="px-5 py-3">Acessos</th>
                  <th className="px-5 py-3">Validade</th>
                  <th className="px-5 py-3">Situação</th>
                  <th className="px-5 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {planos.map(p => (
                  <tr key={p.id} className={`border-b border-gray-50 last:border-0 ${p.ativo ? '' : 'opacity-55'}`}>
                    <td className="px-5 py-3 font-semibold text-gray-900">{p.nome}</td>
                    <td className="px-5 py-3 text-gray-700">{moedaBR(p.precoMensal)}</td>
                    <td className="px-5 py-3 text-gray-700">{limiteLabel(p.limiteUsuarios)}</td>
                    <td className="px-5 py-3 text-gray-700">{validadeLabel(p.validadeDias)}</td>
                    <td className="px-5 py-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${p.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-600'}`}>
                        {p.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => abrirEdicao(p)} title="Editar" className="p-2 rounded-lg text-orange-500 hover:bg-orange-50"><Pencil size={16} /></button>
                        <button onClick={() => toggle(p)} title={p.ativo ? 'Inativar' : 'Ativar'} className={`p-2 rounded-lg ${p.ativo ? 'text-red-500 hover:bg-red-50' : 'text-emerald-600 hover:bg-emerald-50'}`}><Power size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Modal criar/editar */}
      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setModalAberto(false)}>
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 rounded-t-3xl">
              <h2 className="text-lg font-bold text-gray-900">{editId ? 'Editar plano' : 'Novo plano'}</h2>
              <button onClick={() => setModalAberto(false)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Nome do plano</label>
                <input className={INPUT} value={form.nome} placeholder="Ex.: Até 10 pessoas"
                  onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Valor / mês (R$)</label>
                  <input className={INPUT} value={form.valor} placeholder="0,00" inputMode="decimal"
                    onChange={e => setForm(f => ({ ...f, valor: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Validade (dias)</label>
                  <input className={INPUT} value={form.validadeDias} placeholder="Sem validade" inputMode="numeric"
                    onChange={e => setForm(f => ({ ...f, validadeDias: e.target.value.replace(/\D/g, '') }))} />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Limite de acessos</label>
                <input className={INPUT} value={form.limiteUsuarios} placeholder="Vazio = ilimitado (mais que 10)" inputMode="numeric"
                  onChange={e => setForm(f => ({ ...f, limiteUsuarios: e.target.value.replace(/\D/g, '') }))} />
                <p className="text-[11px] text-gray-400 mt-1">Nº de pessoas que podem acessar a empresa. Vazio = sem limite.</p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
              <button onClick={() => setModalAberto(false)} className="px-4 py-2.5 rounded-2xl text-sm font-semibold text-gray-600 hover:bg-gray-100">Cancelar</button>
              <button onClick={salvar} disabled={salvando}
                className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white px-5 py-2.5 rounded-2xl font-semibold text-sm">
                {salvando ? <Loader2 size={16} className="animate-spin" /> : null}
                Salvar
              </button>
            </div>
            <ErroAcao erro={erroModal} className="px-5 pb-4" />
          </div>
        </div>
      )}
    </PageContainer>
  );
}
