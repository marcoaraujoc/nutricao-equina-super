// frontend/src/pages/CadastroTratador.tsx

import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  Pencil, Trash2, Search, Loader2, X, UserCog,
  Phone, MapPin, ToggleLeft, ToggleRight, ChevronDown,
} from 'lucide-react';
import PageContainer from '../components/PageContainer';
import { usePermissoes } from '../hooks/usePermissoes';

function mascaraTelefone(v: string): string {
  const n = v.replace(/\D/g, '').slice(0, 11);
  if (n.length <= 10) return n.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
  return n.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Tratador {
  id:            number;
  nome:          string;
  telefone:      string | null;
  localTrabalho: string | null;
  ativo:         boolean;
  createdAt:     string;
}

interface FormTratador {
  nome:          string;
  telefone:      string;
  localTrabalho: string;
}

const FORM_INICIAL: FormTratador = { nome: '', telefone: '', localTrabalho: '' };

// ─── LocalSelector — campo com sugestões existentes + criação inline ──────────

function LocalSelector({
  value,
  onChange,
  locais,
  className,
}: {
  value:     string;
  onChange:  (v: string) => void;
  locais:    string[];
  className: string;
}) {
  const [aberto,  setAberto]  = useState(false);
  const [filtro,  setFiltro]  = useState(value);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setFiltro(value); }, [value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const opcoesFiltradas = locais.filter(l =>
    l.toLowerCase().includes(filtro.toLowerCase())
  );

  const selecionar = (v: string) => {
    onChange(v);
    setFiltro(v);
    setAberto(false);
  };

  const handleInput = (v: string) => {
    setFiltro(v);
    onChange(v);
    setAberto(true);
  };

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <input
          value={filtro}
          onChange={e => handleInput(e.target.value)}
          onFocus={() => setAberto(true)}
          placeholder="Haras, fazenda ou estábulo..."
          className={className}
        />
        <button type="button" onClick={() => setAberto(p => !p)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
          <ChevronDown size={14} />
        </button>
      </div>
      {aberto && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-30 max-h-48 overflow-y-auto">
          {opcoesFiltradas.length > 0 ? (
            opcoesFiltradas.map(l => (
              <button key={l} type="button"
                onClick={() => selecionar(l)}
                className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50 transition-colors">
                {l}
              </button>
            ))
          ) : (
            filtro.trim() ? (
              <button type="button"
                onClick={() => selecionar(filtro.trim())}
                className="w-full text-left px-4 py-2.5 text-sm text-emerald-700 font-medium hover:bg-emerald-50 transition-colors">
                Cadastrar "{filtro.trim()}"
              </button>
            ) : (
              <p className="px-4 py-3 text-xs text-gray-400">Nenhum local cadastrado</p>
            )
          )}
        </div>
      )}
    </div>
  );
}

// ─── Modal Formulário ─────────────────────────────────────────────────────────

function ModalTratador({
  editando, form, saving, locais,
  onFormChange, onSalvar, onClose,
}: {
  editando:    Tratador | null;
  form:        FormTratador;
  saving:      boolean;
  locais:      string[];
  onFormChange: (f: keyof FormTratador, v: string) => void;
  onSalvar:    () => void;
  onClose:     () => void;
}) {
  const inputCls    = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500';
  const inputReqCls = (v: string) => `${inputCls} ${!v.trim() ? 'border-red-200 focus:border-red-400' : ''}`;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-md border border-gray-100">

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <UserCog size={18} className="text-emerald-600" />
            {editando ? 'Editar Tratador' : 'Novo Tratador'}
          </h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Nome *</label>
            <input
              value={form.nome}
              onChange={e => onFormChange('nome', e.target.value)}
              placeholder="Nome completo do tratador"
              className={inputReqCls(form.nome)}
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">
              <span className="flex items-center gap-1"><Phone size={11} /> Telefone *</span>
            </label>
            <input
              value={form.telefone}
              onChange={e => onFormChange('telefone', mascaraTelefone(e.target.value))}
              placeholder="(00) 00000-0000"
              className={inputReqCls(form.telefone)}
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">
              <span className="flex items-center gap-1"><MapPin size={11} /> Local de Trabalho *</span>
            </label>
            <LocalSelector
              value={form.localTrabalho}
              onChange={v => onFormChange('localTrabalho', v)}
              locais={locais}
              className={inputReqCls(form.localTrabalho)}
            />
          </div>
        </div>

        <div className="flex gap-3 px-5 pb-5 pt-2 border-t border-gray-100">
          <button onClick={onClose} disabled={saving}
            className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={onSalvar} disabled={saving || !form.nome.trim()}
            className="flex-1 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2">
            {saving && <Loader2 size={13} className="animate-spin" />}
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function CadastroTratador() {
  const { podeExecutar, isSocio } = usePermissoes();

  const podeCriar   = isSocio || podeExecutar('cadastro.tratador.criar');
  const podeEditar  = isSocio || podeExecutar('cadastro.tratador.editar');
  const podeDeletar = isSocio || podeExecutar('cadastro.tratador.deletar');

  const [tratadores, setTratadores] = useState<Tratador[]>([]);
  const [locais,     setLocais]     = useState<string[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [busca,      setBusca]      = useState('');
  const [showModal,  setShowModal]  = useState(false);
  const [editando,   setEditando]   = useState<Tratador | null>(null);
  const [form,       setForm]       = useState<FormTratador>(FORM_INICIAL);
  const [saving,     setSaving]     = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (busca.trim()) params.set('busca', busca.trim());
      // Inclui inativos para que possam ser reativados
      params.set('ativo', 'all');
      const [resT, resL] = await Promise.all([
        api.get(`/cadastro/tratadores?${params}`),
        api.get('/cadastro/tratadores/locais'),
      ]);
      setTratadores(resT.data.dados ?? []);
      setLocais(resL.data.dados ?? []);
    } catch { toast.error('Erro ao carregar tratadores'); }
    finally { setLoading(false); }
  }, [busca]);

  useEffect(() => { carregar(); }, [carregar]);

  const abrirNovo = () => {
    setEditando(null);
    setForm(FORM_INICIAL);
    setShowModal(true);
  };

  const abrirEdicao = (t: Tratador) => {
    setEditando(t);
    setForm({
      nome:          t.nome,
      telefone:      t.telefone ? mascaraTelefone(t.telefone.replace(/\D/g, '')) : '',
      localTrabalho: t.localTrabalho ?? '',
    });
    setShowModal(true);
  };

  const fecharModal = () => { setShowModal(false); setEditando(null); setForm(FORM_INICIAL); };

  const handleFormChange = (field: keyof FormTratador, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const handleSalvar = async () => {
    if (!form.nome.trim())          { toast.error('Nome é obrigatório'); return; }
    if (!form.telefone.trim())      { toast.error('Telefone é obrigatório'); return; }
    if (!form.localTrabalho.trim()) { toast.error('Local de trabalho é obrigatório'); return; }

    setSaving(true);
    try {
      if (editando) {
        await api.put(`/cadastro/tratadores/${editando.id}`, form);
        toast.success('Tratador atualizado');
      } else {
        await api.post('/cadastro/tratadores', form);
        toast.success('Tratador cadastrado');
      }
      fecharModal();
      carregar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } })?.response?.data?.mensagem;
      toast.error(msg ?? 'Erro ao salvar');
    } finally { setSaving(false); }
  };

  const handleToggle = async (t: Tratador) => {
    try {
      await api.patch(`/cadastro/tratadores/${t.id}/toggle`);
      toast.success(t.ativo ? 'Tratador inativado' : 'Tratador ativado');
      carregar();
    } catch { toast.error('Erro ao alternar status'); }
  };

  const handleExcluir = async (t: Tratador) => {
    if (!confirm(`Inativar o tratador "${t.nome}"?`)) return;
    try {
      await api.delete(`/cadastro/tratadores/${t.id}`);
      toast.success('Tratador inativado');
      carregar();
    } catch { toast.error('Erro ao inativar'); }
  };

  return (
    <PageContainer maxWidth="5xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <UserCog size={24} className="text-emerald-600" /> Tratadores
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Cadastro de tratadores e responsáveis pelos animais</p>
        </div>
        {podeCriar && (
          <button onClick={abrirNovo}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-2xl shadow-sm transition-colors">
            Novo Tratador
          </button>
        )}
      </div>

      {/* Busca */}
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          placeholder="Buscar por nome ou local de trabalho..."
          value={busca}
          onChange={e => setBusca(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 bg-white transition-colors"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-emerald-600" />
        </div>
      ) : tratadores.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-300">
          <UserCog size={40} className="mb-3" />
          <p className="text-sm text-gray-400">Nenhum tratador encontrado</p>
          {podeCriar && (
            <button onClick={abrirNovo}
              className="mt-4 px-4 py-2 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 transition-colors">
              Novo Tratador
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Mobile — cards */}
          <div className="md:hidden space-y-3">
            {tratadores.map(t => (
              <div key={t.id} className={`bg-white rounded-2xl border p-4 shadow-sm ${!t.ativo ? 'opacity-60' : 'border-gray-100'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{t.nome}</p>
                    {t.telefone && (
                      <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                        <Phone size={10} /> {t.telefone}
                      </p>
                    )}
                    {t.localTrabalho && (
                      <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                        <MapPin size={10} /> {t.localTrabalho}
                      </p>
                    )}
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${t.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                    {t.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-50">
                  {podeEditar && (
                    <>
                      <button onClick={() => abrirEdicao(t)}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 transition-colors">
                        <Pencil size={11} /> Editar
                      </button>
                      <button onClick={() => handleToggle(t)}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 transition-colors">
                        {t.ativo ? <ToggleRight size={11} className="text-emerald-600" /> : <ToggleLeft size={11} />}
                        {t.ativo ? 'Inativar' : 'Ativar'}
                      </button>
                    </>
                  )}
                  {podeDeletar && t.ativo && (
                    <button onClick={() => handleExcluir(t)}
                      className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop — tabela */}
          <div className="hidden md:block bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Nome</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Telefone</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Local de Trabalho</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {tratadores.map(t => (
                  <tr key={t.id} className={`hover:bg-gray-50 transition-colors ${!t.ativo ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3 font-medium text-gray-900">{t.nome}</td>
                    <td className="px-4 py-3 text-gray-600">{t.telefone ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3 text-gray-600">{t.localTrabalho ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${t.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                        {t.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {podeEditar && (
                          <>
                            <button onClick={() => abrirEdicao(t)} title="Editar"
                              className="p-1.5 text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors">
                              <Pencil size={14} />
                            </button>
                            <button onClick={() => handleToggle(t)} title={t.ativo ? 'Inativar' : 'Ativar'}
                              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">
                              {t.ativo ? <ToggleRight size={14} className="text-emerald-600" /> : <ToggleLeft size={14} />}
                            </button>
                          </>
                        )}
                        {podeDeletar && t.ativo && (
                          <button onClick={() => handleExcluir(t)} title="Inativar"
                            className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showModal && (
        <ModalTratador
          editando={editando}
          form={form}
          saving={saving}
          locais={locais}
          onFormChange={handleFormChange}
          onSalvar={handleSalvar}
          onClose={fecharModal}
        />
      )}
    </PageContainer>
  );
}
