// frontend/src/pages/CadastroVacina.tsx

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Syringe, Plus, Pencil, Trash2, ChevronDown, ChevronRight,
  X, Check, Loader2, Package, AlertTriangle, ToggleLeft, ToggleRight,
  Building2, FlaskConical,
} from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';
import PageContainer from '../components/PageContainer';
import { useAuth } from '../contexts/AuthContext';
import ConfirmModal from '../components/ConfirmModal';
import ModalJustificativa from '../components/ModalJustificativa';
import InlineError from '../components/InlineError';
import ErroAcao, { type ErroAcaoDados } from '../components/ErroAcao';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Lote {
  id:            number;
  vacinaId:      number;
  empresaId:     number | null;
  empresa:       { id: number; nome: string } | null;
  lote:          string;
  validade:      string;
  qtdTotal:      number;
  qtdDisponivel: number;
  ativo:         boolean;
}

interface VacinaLegada {
  id:         number;
  nome:       string;
  fabricante: string | null;
  via:        string;
  ativo:      boolean;
  lotes:      Lote[];
  _count:     { aplicacoes: number };
}

interface Especie { id: number; nome: string }

interface MedVacina {
  id:                number;
  nome:              string;
  fabricante:        string | null;
  formaFarmaceutica: string;
  apresentacao:      string;
  unidade:           string;
  ativo:             boolean;
  vias:              { id: number; via: string }[];
  especies:          { id: number; especie: Especie }[];
}

interface Empresa { id: number; nome: string }

// ─── Constants ────────────────────────────────────────────────────────────────

const VIAS = [
  'Subcutânea (SC)',
  'Intramuscular (IM)',
  'Intranasal (IN)',
  'Intravenosa (IV)',
  'Oral',
];

// Mapeia qualquer variação de via para o valor canônico usado nos botões rápidos.
// Suporta abreviações simples ("SC"), prefixos com descrição ("IM Profunda ..."),
// e nomes completos ("Subcutânea (SC)").
const VIA_PREFIXES: [string, string][] = [
  ['SUBCUTÂNEA',    'Subcutânea (SC)'],
  ['SC',            'Subcutânea (SC)'],
  ['INTRAMUSCULAR', 'Intramuscular (IM)'],
  ['IM',            'Intramuscular (IM)'],
  ['INTRANASAL',    'Intranasal (IN)'],
  ['IN',            'Intranasal (IN)'],
  ['INTRAVENOSA',   'Intravenosa (IV)'],
  ['IV',            'Intravenosa (IV)'],
  ['ORAL',          'Oral'],
];

const normalizeVia = (via: string): string => {
  const u = via.trim().toUpperCase();
  for (const [prefix, canonical] of VIA_PREFIXES) {
    if (u === prefix || u.startsWith(prefix + ' ') || u.startsWith(prefix + '(') || u.startsWith(prefix + ',')) {
      return canonical;
    }
  }
  return via;
};

const FORMAS = [
  'Suspensão Injetável',
  'Solução Injetável',
  'Emulsão Injetável',
  'Liofilizado + Diluente',
  'Oral',
  'Intranasal',
];

const formatDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');
const isVencido  = (iso: string) => new Date(iso) < new Date();

// ─── MedVacinaModal ───────────────────────────────────────────────────────────

interface MedVacinaPayload {
  nome: string; fabricante: string; formaFarmaceutica: string;
  apresentacao: string; unidade: string; vias: string[]; especieIds: number[];
}

function MedVacinaModal({ vacina, especies, onSalvar, onFechar, saving, erroAcao }: {
  vacina:   MedVacina | null;
  especies: Especie[];
  onSalvar: (data: MedVacinaPayload) => void;
  /** Erro do salvar — exibido no rodapé do modal, não no topo da página */
  erroAcao?: ErroAcaoDados | null;
  onFechar: () => void;
  saving:   boolean;
}) {
  const [nome,       setNome]       = useState(vacina?.nome              ?? '');
  const [fabricante, setFabricante] = useState(vacina?.fabricante        ?? '');
  const [forma,      setForma]      = useState(vacina?.formaFarmaceutica ?? FORMAS[0]);
  const [apresent,   setApresent]   = useState(vacina?.apresentacao      ?? '');
  const [unidade,    setUnidade]    = useState(vacina?.unidade           ?? 'dose');
  const [vias,       setVias]       = useState<string[]>(
    vacina?.vias ? [...new Set(vacina.vias.map(v => normalizeVia(v.via)))] : ['Subcutânea (SC)']
  );
  const [specIds, setSpecIds] = useState<number[]>(
    vacina?.especies?.map(e => e.especie.id) ?? []
  );

  const vacinaIdRef = useRef(vacina?.id);

  useEffect(() => {
    if (vacina?.id === vacinaIdRef.current) return;
    vacinaIdRef.current = vacina?.id;
    setNome(vacina?.nome ?? '');
    setFabricante(vacina?.fabricante ?? '');
    setForma(vacina?.formaFarmaceutica ?? FORMAS[0]);
    setApresent(vacina?.apresentacao ?? '');
    setUnidade(vacina?.unidade ?? 'dose');
    setVias(vacina?.vias ? [...new Set(vacina.vias.map(v => normalizeVia(v.via)))] : ['Subcutânea (SC)']);
    setSpecIds(vacina?.especies?.map(e => e.especie.id) ?? []);
  }, [vacina]);

  const addVia    = (v: string) => setVias(p => p.includes(v) ? p : [...p, v]);
  const removeVia = (v: string) => setVias(p => p.filter(x => x !== v));
  const toggleSpec = (id: number) => setSpecIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const valid = nome.trim() && forma && apresent.trim() && unidade.trim() && vias.length > 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md border border-gray-100 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900">{vacina ? 'Editar Vacina' : 'Nova Vacina'}</h3>
          <button onClick={onFechar} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Nome *</label>
            <input value={nome} onChange={e => setNome(e.target.value)}
              placeholder="Ex: Equi Flu"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-500" />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Laboratório</label>
            <input value={fabricante} onChange={e => setFabricante(e.target.value)}
              placeholder="Ex: Zoetis"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-500" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Forma Farmacêutica *</label>
              <select value={forma} onChange={e => setForma(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-500">
                {FORMAS.map(f => <option key={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Unidade *</label>
              <input value={unidade} onChange={e => setUnidade(e.target.value)}
                placeholder="dose"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-500" />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Apresentação *</label>
            <input value={apresent} onChange={e => setApresent(e.target.value)}
              placeholder="Ex: frasco 10 doses"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-teal-500" />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Vias de Aplicação *</label>

            {/* Vias selecionadas como chips removíveis — preserva o texto exato do banco */}
            {vias.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {vias.map(via => (
                  <span key={via}
                    className="flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-xl text-xs font-medium bg-teal-600 text-white">
                    <span>{via}</span>
                    <button type="button" onClick={() => removeVia(via)}
                      className="flex-shrink-0 hover:text-teal-200 transition-colors">
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Botões de adição rápida — vias canônicas ainda não representadas */}
            {VIAS.filter(v => !vias.some(via => normalizeVia(via) === v)).length > 0 && (
              <div className="flex flex-wrap gap-2">
                {VIAS.filter(v => !vias.some(via => normalizeVia(via) === v)).map(v => (
                  <button key={v} type="button" onClick={() => addVia(v)}
                    className="px-3 py-1.5 rounded-xl text-xs font-medium border border-dashed border-gray-300 text-gray-500 hover:border-teal-500 hover:text-teal-600 transition-colors">
                    + {v}
                  </button>
                ))}
              </div>
            )}
          </div>

          {especies.length > 0 && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Espécies</label>
              <div className="flex flex-wrap gap-2">
                {especies.map(e => (
                  <button key={e.id} type="button" onClick={() => toggleSpec(e.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors
                      ${specIds.includes(e.id) ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-500 border-gray-200 hover:border-emerald-400'}`}>
                    {e.nome}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 pb-5 pt-3 border-t border-gray-100">
          <ErroAcao erro={erroAcao ?? null} className="mb-3" />
          <div className="flex gap-3">
          <button onClick={onFechar} disabled={saving}
            className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => onSalvar({ nome, fabricante, formaFarmaceutica: forma, apresentacao: apresent, unidade, vias, especieIds: specIds })}
            disabled={saving || !valid}
            className="flex-1 py-2.5 bg-teal-700 hover:bg-teal-800 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── CatalogoVacinasTab ───────────────────────────────────────────────────────

function CatalogoVacinasTab() {
  const [vacinas,       setVacinas]       = useState<MedVacina[]>([]);
  const [especies,      setEspecies]      = useState<Especie[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [busca,         setBusca]         = useState('');
  const [filtroEspecie, setFiltroEspecie] = useState<number | ''>('');
  const [modal,         setModal]         = useState(false);
  const [editando,      setEditando]      = useState<MedVacina | null>(null);
  const [saving,        setSaving]        = useState(false);
  const [confirmVacina, setConfirmVacina] = useState<MedVacina | null>(null);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline,    setErroInline]    = useState<string | null>(null);
  // Erro do SALVAR do modal — no topo da página ele ficaria atrás do overlay
  const [erroAcao,      setErroAcao]      = useState<ErroAcaoDados | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const [resV, resE] = await Promise.all([
        api.get('/medicamentos/vacinas'),
        api.get('/medicamentos/especies').catch(() => ({ data: { dados: [] } })),
      ]);
      setVacinas(resV.data?.dados ?? []);
      setEspecies(resE.data?.dados ?? []);
    } catch {
      setErroInline('Erro ao carregar catálogo de vacinas');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const filtradas = vacinas.filter(v => {
    const matchBusca = !busca ||
      v.nome.toLowerCase().includes(busca.toLowerCase()) ||
      (v.fabricante ?? '').toLowerCase().includes(busca.toLowerCase());
    const matchEspecie = !filtroEspecie ||
      v.especies.some(e => e.especie.id === filtroEspecie);
    return matchBusca && matchEspecie;
  });

  const abrirEdicao = (v: MedVacina) => {
    setEditando(v);
    setModal(true);
  };

  const handleSalvar = async (data: MedVacinaPayload) => {
    setErroAcao(null);
    setSaving(true);
    try {
      if (editando) {
        await api.put(`/medicamentos/${editando.id}`, { ...data, classificacao: 'Vacina' });
        toast.success('Vacina atualizada');
      } else {
        await api.post('/medicamentos', { ...data, classificacao: 'Vacina' });
        toast.success('Vacina criada');
      }
      setModal(false);
      setEditando(null);
      carregar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErroAcao({ mensagem: msg ?? 'Erro ao salvar vacina' });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (v: MedVacina) => {
    try {
      await api.put(`/medicamentos/${v.id}`, { ativo: !v.ativo });
      toast.success(v.ativo ? 'Vacina inativada' : 'Vacina reativada');
      carregar();
    } catch {
      setErroInline('Erro ao alterar status');
    }
  };

  const handleExcluir = (v: MedVacina) => setConfirmVacina(v);

  const handleExcluirConfirmado = async (motivo: string) => {
    if (!confirmVacina) return;
    const v = confirmVacina;
    setConfirmVacina(null);
    try {
      await api.delete(`/medicamentos/${v.id}`, { data: { motivo } });
      toast.success('Vacina excluída');
      carregar();
    } catch {
      setErroInline('Erro ao excluir vacina');
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 size={24} className="animate-spin text-teal-600" />
    </div>
  );

  return (
    <>
      <InlineError message={erroInline} className="mb-4" />

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <input value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por nome ou laboratório…"
            className="w-full sm:w-64 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-teal-500" />
          <select
            value={filtroEspecie}
            onChange={e => setFiltroEspecie(e.target.value ? Number(e.target.value) : '')}
            className="w-full sm:w-44 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-teal-500 text-gray-600 bg-white">
            <option value="">Todas as espécies</option>
            {especies.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </div>
        <button
          onClick={() => { setEditando(null); setModal(true); }}
          className="px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold rounded-xl shadow-sm transition-colors">
          Nova Vacina
        </button>
      </div>

      {filtradas.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-300">
          <FlaskConical size={36} className="mb-3" />
          <p className="text-sm text-gray-400 mb-4">
            {busca || filtroEspecie ? 'Nenhuma vacina encontrada' : 'Nenhuma vacina no catálogo'}
          </p>
          {!busca && !filtroEspecie && (
            <button
              onClick={() => { setEditando(null); setModal(true); }}
              className="px-4 py-2 bg-teal-700 text-white text-sm font-medium rounded-xl hover:bg-teal-800 transition-colors">
              Cadastrar vacina
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Mobile — cards */}
          <div className="md:hidden space-y-3">
            {filtradas.map(v => (
              <div key={v.id} className={`bg-white rounded-2xl border shadow-sm p-4 ${!v.ativo ? 'opacity-60' : ''}`}>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 bg-teal-100 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Syringe size={14} className="text-teal-700" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm">{v.nome}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {v.fabricante ?? 'Laboratório não informado'} · {v.formaFarmaceutica}
                    </p>
                    {v.especies.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {v.especies.map(e => (
                          <span key={e.id} className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] rounded-full font-medium">
                            {e.especie.nome}
                          </span>
                        ))}
                      </div>
                    )}
                    {v.vias.length > 0 && (
                      <p className="text-[11px] text-gray-400 mt-1">{v.vias.map(vv => normalizeVia(vv.via)).join(' · ')}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => { abrirEdicao(v); }}
                      className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => handleToggle(v)}
                      className={`p-1.5 rounded-lg transition-colors ${v.ativo ? 'text-emerald-500 hover:text-gray-400 hover:bg-gray-50' : 'text-gray-300 hover:text-emerald-600 hover:bg-emerald-50'}`}>
                      {v.ativo ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                    </button>
                    <button onClick={() => handleExcluir(v)}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop — tabela */}
          <div className="hidden md:block bg-white rounded-2xl border shadow-sm overflow-hidden">
            <div className="overflow-x-auto rounded-2xl">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Vacina</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Laboratório</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Espécies</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Via</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 w-24"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtradas.map(v => (
                  <tr key={v.id} className={`hover:bg-gray-50/50 transition-colors ${!v.ativo ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{v.nome}</p>
                      <p className="text-xs text-gray-400">{v.formaFarmaceutica} · {v.apresentacao}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {v.fabricante ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {v.especies.length === 0
                          ? <span className="text-gray-300 text-xs">—</span>
                          : v.especies.map(e => (
                              <span key={e.id} className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] rounded-full font-medium">
                                {e.especie.nome}
                              </span>
                            ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {v.vias.length > 0 ? v.vias.map(vv => normalizeVia(vv.via)).join(', ') : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {v.ativo
                        ? <span className="px-2 py-0.5 bg-teal-50 text-teal-700 text-[10px] rounded-full font-medium inline-flex items-center gap-1"><Check size={9} />Ativo</span>
                        : <span className="px-2 py-0.5 bg-gray-100 text-gray-400 text-[10px] rounded-full font-medium">Inativo</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => { abrirEdicao(v); }}
                          className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors" title="Editar">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => handleToggle(v)}
                          className={`p-1.5 rounded-lg transition-colors ${v.ativo ? 'text-emerald-500 hover:text-gray-400 hover:bg-gray-50' : 'text-gray-300 hover:text-emerald-600 hover:bg-emerald-50'}`}
                          title={v.ativo ? 'Inativar' : 'Reativar'}>
                          {v.ativo ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                        </button>
                        <button onClick={() => handleExcluir(v)}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Excluir">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </>
      )}

      {modal && (
        <MedVacinaModal
          erroAcao={erroAcao}
          key={editando?.id ?? 'new'}
          vacina={editando}
          especies={especies}
          onSalvar={handleSalvar}
          onFechar={() => { setModal(false); setEditando(null); }}
          saving={saving}
        />
      )}

      <ModalJustificativa
        aberto={confirmVacina != null}
        titulo="Excluir vacina"
        descricao={`Excluir a vacina "${confirmVacina?.nome}"? Esta ação não pode ser desfeita.`}
        acaoLabel="Excluir"
        onConfirmar={handleExcluirConfirmado}
        onFechar={() => setConfirmVacina(null)}
      />
    </>
  );
}

// ─── VacinaModal (legado) ─────────────────────────────────────────────────────

function VacinaModal({ vacina, onSalvar, onFechar, saving, erroAcao }: {
  vacina:   VacinaLegada | null;
  onSalvar: (data: { nome: string; fabricante: string; via: string }) => void;
  erroAcao?: ErroAcaoDados | null;
  onFechar: () => void;
  saving:   boolean;
}) {
  const [nome,       setNome]       = useState(vacina?.nome       ?? '');
  const [fabricante, setFabricante] = useState(vacina?.fabricante ?? '');
  const [via,        setVia]        = useState(vacina?.via        ?? 'Subcutânea (SC)');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm border border-gray-100">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900">{vacina ? 'Editar Vacina' : 'Nova Vacina'}</h3>
          <button onClick={onFechar} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Nome *</label>
            <input value={nome} onChange={e => setNome(e.target.value)}
              placeholder="Ex: Múltipla Canina V10"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Fabricante</label>
            <input value={fabricante} onChange={e => setFabricante(e.target.value)}
              placeholder="Ex: Zoetis"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Via de Aplicação</label>
            <select value={via} onChange={e => setVia(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500">
              {VIAS.map(v => <option key={v}>{v}</option>)}
            </select>
          </div>
        </div>
        <div className="px-5 pb-5 pt-2 border-t border-gray-100">
          <ErroAcao erro={erroAcao ?? null} className="mb-3" />
          <div className="flex gap-3">
          <button onClick={onFechar} disabled={saving}
            className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => onSalvar({ nome, fabricante, via })}
            disabled={saving || !nome.trim()}
            className="flex-1 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── LoteModal (legado) ───────────────────────────────────────────────────────

function LoteModal({ vacinaId, lote, empresas, onSalvar, onFechar, saving, erroAcao }: {
  vacinaId:  number;
  lote:      Lote | null;
  empresas:  Empresa[];
  onSalvar:  (data: { empresaId: number | null; lote: string; validade: string; qtdTotal: number }) => void;
  erroAcao?: ErroAcaoDados | null;
  onFechar:  () => void;
  saving:    boolean;
}) {
  const [empresaId, setEmpresaId] = useState<number | ''>(lote?.empresaId ?? '');
  const [numLote,   setNumLote]   = useState(lote?.lote ?? '');
  const [validade,  setValidade]  = useState(lote ? lote.validade.slice(0, 10) : '');
  const [qtd,       setQtd]       = useState(lote ? String(lote.qtdTotal) : '');

  void vacinaId;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm border border-gray-100">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900">{lote ? 'Editar Lote' : 'Novo Lote'}</h3>
          <button onClick={onFechar} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Empresa</label>
            <select value={empresaId} onChange={e => setEmpresaId(e.target.value ? Number(e.target.value) : '')}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500">
              <option value="">Global (todas as empresas)</option>
              {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Número do Lote *</label>
            <input value={numLote} onChange={e => setNumLote(e.target.value)}
              placeholder="Ex: 1234"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Validade *</label>
              <input type="date" value={validade} onChange={e => setValidade(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Qtd. Total *</label>
              <input type="number" min="1" value={qtd} onChange={e => setQtd(e.target.value)}
                placeholder="0"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500" />
            </div>
          </div>
        </div>
        <div className="px-5 pb-5 pt-2 border-t border-gray-100">
          <ErroAcao erro={erroAcao ?? null} className="mb-3" />
          <div className="flex gap-3">
          <button onClick={onFechar} disabled={saving}
            className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => onSalvar({ empresaId: empresaId || null, lote: numLote, validade, qtdTotal: Number(qtd) })}
            disabled={saving || !numLote.trim() || !validade || !qtd || Number(qtd) < 1}
            className="flex-1 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── CadastroVacina ───────────────────────────────────────────────────────────

export default function CadastroVacina() {
  const { user, loading: authLoading } = useAuth();
  const isAdmin = (user?.role ?? '').toUpperCase() === 'ADMIN';

  const [tab, setTab] = useState<'catalogo' | 'legado'>('catalogo');

  // Estado da aba legada
  const [vacinas,         setVacinas]         = useState<VacinaLegada[]>([]);
  const [empresas,        setEmpresas]        = useState<Empresa[]>([]);
  const [loadingLegado,   setLoadingLegado]   = useState(false);
  const [buscaLegado,     setBuscaLegado]     = useState('');
  const [expandido,       setExpandido]       = useState<number | null>(null);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline,      setErroInline]      = useState<string | null>(null);
  const [erroAcao,        setErroAcao]        = useState<ErroAcaoDados | null>(null);
  const [showVacinaModal, setShowVacinaModal] = useState(false);
  const [editandoVacina,  setEditandoVacina]  = useState<VacinaLegada | null>(null);
  const [showLoteModal,   setShowLoteModal]   = useState(false);
  const [editandoLote,    setEditandoLote]    = useState<Lote | null>(null);
  const [confirmLoteId,   setConfirmLoteId]   = useState<number | null>(null);
  const [vacinaIdLote,    setVacinaIdLote]    = useState<number | null>(null);
  const [savingLegado,    setSavingLegado]    = useState(false);

  const carregarLegado = useCallback(async () => {
    setLoadingLegado(true);
    try {
      const [resVacinas, resEmpresas] = await Promise.all([
        api.get('/admin/vacinas'),
        api.get('/equipes/empresas').catch(() => ({ data: { dados: [] } })),
      ]);
      setVacinas(resVacinas.data?.dados ?? []);
      setEmpresas(resEmpresas.data?.dados ?? []);
    } catch {
      setErroInline('Erro ao carregar vacinas');
    } finally {
      setLoadingLegado(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'legado') carregarLegado();
  }, [tab, carregarLegado]);

  if (authLoading) return null;

  if (!isAdmin) {
    return (
      <PageContainer>
        <div className="text-center py-16">
          <h2 className="text-lg font-semibold text-gray-700 mb-2">Acesso restrito</h2>
          <p className="text-sm text-gray-500">Esta página é exclusiva para administradores.</p>
        </div>
      </PageContainer>
    );
  }

  // ── Handlers legado vacina ─────────────────────────────────────────────────

  const handleSalvarVacina = async (data: { nome: string; fabricante: string; via: string }) => {
    setSavingLegado(true);
    try {
      if (editandoVacina) {
        await api.put(`/admin/vacinas/${editandoVacina.id}`, data);
        toast.success('Vacina atualizada');
      } else {
        await api.post('/admin/vacinas', data);
        toast.success('Vacina criada');
      }
      setShowVacinaModal(false);
      setEditandoVacina(null);
      carregarLegado();
    } catch {
      setErroAcao({ mensagem: 'Erro ao salvar vacina' });
    } finally {
      setSavingLegado(false);
    }
  };

  const handleToggleVacina = async (v: VacinaLegada) => {
    try {
      await api.patch(`/admin/vacinas/${v.id}/toggle`);
      toast.success(v.ativo ? 'Vacina inativada' : 'Vacina reativada');
      carregarLegado();
    } catch {
      setErroInline('Erro ao alterar status');
    }
  };

  // ── Handlers legado lote ───────────────────────────────────────────────────

  const abrirNovoLote = (vacinaId: number) => {
    setVacinaIdLote(vacinaId);
    setEditandoLote(null);
    setShowLoteModal(true);
  };

  const handleSalvarLote = async (data: { empresaId: number | null; lote: string; validade: string; qtdTotal: number }) => {
    setErroAcao(null);
    if (!vacinaIdLote) return;
    setSavingLegado(true);
    try {
      if (editandoLote) {
        await api.put(`/admin/vacinas/lotes/${editandoLote.id}`, data);
        toast.success('Lote atualizado');
      } else {
        await api.post(`/admin/vacinas/${vacinaIdLote}/lotes`, data);
        toast.success('Lote adicionado');
      }
      setShowLoteModal(false);
      setEditandoLote(null);
      carregarLegado();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErroAcao({ mensagem: msg ?? 'Erro ao salvar lote' });
    } finally {
      setSavingLegado(false);
    }
  };

  const handleInativarLote = (loteId: number) => setConfirmLoteId(loteId);

  const handleInativarLoteConfirmado = async () => {
    if (confirmLoteId == null) return;
    const loteId = confirmLoteId;
    setConfirmLoteId(null);
    try {
      await api.patch(`/admin/vacinas/lotes/${loteId}/inativar`);
      toast.success('Lote inativado');
      carregarLegado();
    } catch {
      setErroInline('Erro ao inativar lote');
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <PageContainer maxWidth="7xl">
      <InlineError message={erroInline} className="mb-4" />

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-teal-100 rounded-2xl flex items-center justify-center">
          <Syringe size={20} className="text-teal-700" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Vacinas</h1>
          <p className="text-sm text-gray-400">Catálogo global de vacinas</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-2xl w-fit mb-6">
        <button
          onClick={() => setTab('catalogo')}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${tab === 'catalogo' ? 'bg-white text-teal-700 shadow-sm font-semibold' : 'text-gray-500 hover:text-gray-700'}`}>
          Catálogo de Vacinas
        </button>
        <button
          onClick={() => setTab('legado')}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${tab === 'legado' ? 'bg-white text-teal-700 shadow-sm font-semibold' : 'text-gray-500 hover:text-gray-700'}`}>
          Vacinas Legadas
        </button>
      </div>

      {/* ── Aba Catálogo ────────────────────────────────────────────────────── */}
      {tab === 'catalogo' && <CatalogoVacinasTab />}

      {/* ── Aba Legado ──────────────────────────────────────────────────────── */}
      {tab === 'legado' && (
        <>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
              <input value={buscaLegado} onChange={e => setBuscaLegado(e.target.value)}
                placeholder="Buscar por nome ou laboratório…"
                className="w-full sm:w-64 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-teal-500" />
            </div>
            <button
              onClick={() => { setEditandoVacina(null); setShowVacinaModal(true); }}
              className="px-4 py-2.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold rounded-2xl shadow-sm transition-colors">
              Nova Vacina
            </button>
          </div>

          {loadingLegado ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={24} className="animate-spin text-teal-600" />
            </div>
          ) : vacinas.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-300">
              <Syringe size={40} className="mb-3" />
              <p className="text-sm text-gray-400 mb-4">Nenhuma vacina cadastrada</p>
              <button
                onClick={() => { setEditandoVacina(null); setShowVacinaModal(true); }}
                className="px-4 py-2 bg-teal-700 text-white text-sm font-medium rounded-xl hover:bg-teal-800 transition-colors">
                Cadastrar vacina
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {vacinas
                .filter(v =>
                  !buscaLegado ||
                  v.nome.toLowerCase().includes(buscaLegado.toLowerCase()) ||
                  (v.fabricante ?? '').toLowerCase().includes(buscaLegado.toLowerCase())
                )
                .map(v => {
                const aberto      = expandido === v.id;
                const lotesAtivos = v.lotes.filter(l => l.ativo);
                const saldoTotal  = lotesAtivos.reduce((s, l) => s + l.qtdDisponivel, 0);

                return (
                  <div key={v.id} className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-all ${!v.ativo ? 'opacity-60' : ''}`}>
                    <div className="flex items-center gap-3 px-5 py-4">
                      <button onClick={() => setExpandido(aberto ? null : v.id)}
                        className="flex-1 flex items-center gap-3 text-left">
                        <div className="w-9 h-9 bg-teal-100 rounded-xl flex items-center justify-center flex-shrink-0">
                          <Syringe size={16} className="text-teal-700" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-900 text-sm">{v.nome}</p>
                          <p className="text-xs text-gray-400">
                            {v.fabricante ?? 'Fabricante não informado'} · {v.via}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <div className="flex items-center gap-1.5 text-xs text-gray-500">
                            <Package size={13} className="text-teal-500" />
                            <span className="font-medium text-teal-700">{saldoTotal} ds</span>
                            <span className="text-gray-300">·</span>
                            <span>{lotesAtivos.length} lote{lotesAtivos.length !== 1 ? 's' : ''}</span>
                          </div>
                          {aberto ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                        </div>
                      </button>

                      <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                        <button onClick={() => { setEditandoVacina(v); setShowVacinaModal(true); }}
                          className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors" title="Editar">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => handleToggleVacina(v)}
                          className={`p-1.5 rounded-lg transition-colors ${v.ativo ? 'text-emerald-500 hover:text-gray-400 hover:bg-gray-50' : 'text-gray-300 hover:text-emerald-600 hover:bg-emerald-50'}`}
                          title={v.ativo ? 'Inativar' : 'Reativar'}>
                          {v.ativo ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                        </button>
                      </div>
                    </div>

                    {aberto && (
                      <div className="border-t border-gray-100 px-5 py-4">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Lotes</p>
                          <button onClick={() => abrirNovoLote(v.id)}
                            className="flex items-center gap-1 px-3 py-1.5 bg-teal-50 text-teal-700 text-xs font-semibold rounded-xl hover:bg-teal-100 transition-colors">
                            <Plus size={12} /> Novo Lote
                          </button>
                        </div>

                        {v.lotes.length === 0 ? (
                          <p className="text-xs text-gray-400 py-4 text-center">Nenhum lote cadastrado</p>
                        ) : (
                          <>
                            {/* Mobile lotes */}
                            <div className="md:hidden space-y-2">
                              {v.lotes.map(l => (
                                <div key={l.id} className={`p-3 rounded-xl border ${!l.ativo ? 'opacity-50' : isVencido(l.validade) ? 'border-red-200 bg-red-50/30' : 'border-gray-100 bg-gray-50'}`}>
                                  <div className="flex items-start justify-between">
                                    <div>
                                      <p className="text-xs font-semibold text-gray-800">Lote {l.lote}</p>
                                      {l.empresa && (
                                        <p className="text-[11px] text-gray-400 flex items-center gap-1 mt-0.5">
                                          <Building2 size={10} /> {l.empresa.nome}
                                        </p>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <button onClick={() => { setVacinaIdLote(v.id); setEditandoLote(l); setShowLoteModal(true); }}
                                        className="p-1 text-gray-400 hover:text-emerald-600"><Pencil size={12} /></button>
                                      {l.ativo && <button onClick={() => handleInativarLote(l.id)}
                                        className="p-1 text-gray-400 hover:text-red-500"><Trash2 size={12} /></button>}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-500">
                                    <span>Val: {formatDate(l.validade)}</span>
                                    <span className={`font-semibold ${l.qtdDisponivel === 0 ? 'text-red-500' : 'text-teal-700'}`}>
                                      Saldo: {l.qtdDisponivel}/{l.qtdTotal}
                                    </span>
                                    {!l.ativo && <span className="text-gray-400 italic">inativo</span>}
                                    {isVencido(l.validade) && <span className="text-red-500 font-medium flex items-center gap-1"><AlertTriangle size={10} />Vencido</span>}
                                  </div>
                                </div>
                              ))}
                            </div>

                            {/* Desktop lotes */}
                            <div className="hidden md:block overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b border-gray-100">
                                    <th className="pb-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Lote</th>
                                    <th className="pb-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Empresa</th>
                                    <th className="pb-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Validade</th>
                                    <th className="pb-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Saldo</th>
                                    <th className="pb-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Status</th>
                                    <th className="pb-2"></th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                  {v.lotes.map(l => (
                                    <tr key={l.id} className={!l.ativo ? 'opacity-50' : ''}>
                                      <td className="py-2.5 text-xs font-medium text-gray-800">{l.lote}</td>
                                      <td className="py-2.5 text-xs text-gray-500">
                                        {l.empresa
                                          ? <span className="flex items-center gap-1"><Building2 size={11} />{l.empresa.nome}</span>
                                          : <span className="text-gray-300">Global</span>}
                                      </td>
                                      <td className={`py-2.5 text-xs ${isVencido(l.validade) ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                                        {formatDate(l.validade)}
                                        {isVencido(l.validade) && <AlertTriangle size={11} className="inline ml-1 text-red-500" />}
                                      </td>
                                      <td className="py-2.5">
                                        <span className={`text-xs font-semibold ${l.qtdDisponivel === 0 ? 'text-red-500' : 'text-teal-700'}`}>
                                          {l.qtdDisponivel}
                                        </span>
                                        <span className="text-xs text-gray-400">/{l.qtdTotal} ds</span>
                                      </td>
                                      <td className="py-2.5">
                                        {!l.ativo
                                          ? <span className="text-[10px] bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full">Inativo</span>
                                          : isVencido(l.validade)
                                          ? <span className="text-[10px] bg-red-100 text-red-600 px-2 py-0.5 rounded-full">Vencido</span>
                                          : l.qtdDisponivel === 0
                                          ? <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Sem saldo</span>
                                          : <span className="text-[10px] bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full flex items-center gap-1 w-fit"><Check size={9} />OK</span>}
                                      </td>
                                      <td className="py-2.5">
                                        <div className="flex items-center gap-1">
                                          <button onClick={() => { setVacinaIdLote(v.id); setEditandoLote(l); setShowLoteModal(true); }}
                                            className="p-1 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors">
                                            <Pencil size={13} />
                                          </button>
                                          {l.ativo && (
                                            <button onClick={() => handleInativarLote(l.id)}
                                              className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                                              <Trash2 size={13} />
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
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {showVacinaModal && (
            <VacinaModal
              erroAcao={erroAcao}
              vacina={editandoVacina}
              onSalvar={handleSalvarVacina}
              onFechar={() => { setShowVacinaModal(false); setEditandoVacina(null); }}
              saving={savingLegado}
            />
          )}

          {showLoteModal && vacinaIdLote && (
            <LoteModal
              erroAcao={erroAcao}
              vacinaId={vacinaIdLote}
              lote={editandoLote}
              empresas={empresas}
              onSalvar={handleSalvarLote}
              onFechar={() => { setShowLoteModal(false); setEditandoLote(null); }}
              saving={savingLegado}
            />
          )}
        </>
      )}

      <ConfirmModal
        open={confirmLoteId != null}
        titulo="Inativar lote"
        mensagem="Inativar este lote? Ele não estará mais disponível para aplicações."
        labelConfirmar="Inativar"
        variante="aviso"
        onConfirmar={handleInativarLoteConfirmado}
        onCancelar={() => setConfirmLoteId(null)}
      />
    </PageContainer>
  );
}
