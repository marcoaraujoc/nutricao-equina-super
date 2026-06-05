// frontend/src/pages/CadastroFornecedor.tsx

import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  Pencil, Trash2, Search, Loader2, X, Truck,
  ToggleLeft, ToggleRight, Building2, User as UserIcon,
  Phone, MapPin, BadgeCheck, AlertCircle,
} from 'lucide-react';
import PageContainer from '../components/PageContainer';
import { usePermissoes } from '../hooks/usePermissoes';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function validarCPF(cpf: string): boolean {
  const n = cpf.replace(/\D/g, '');
  if (n.length !== 11 || /^(\d)\1+$/.test(n)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += parseInt(n[i]) * (10 - i);
  let r = (s * 10) % 11; if (r >= 10) r = 0;
  if (r !== parseInt(n[9])) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += parseInt(n[i]) * (11 - i);
  r = (s * 10) % 11; if (r >= 10) r = 0;
  return r === parseInt(n[10]);
}

function validarCNPJ(cnpj: string): boolean {
  const n = cnpj.replace(/\D/g, '');
  if (n.length !== 14 || /^(\d)\1+$/.test(n)) return false;
  const calc = (s: string, w: number[]) => {
    let soma = 0;
    for (let i = 0; i < w.length; i++) soma += parseInt(s[i]) * w[i];
    const r = soma % 11; return r < 2 ? 0 : 11 - r;
  };
  return calc(n, [5,4,3,2,9,8,7,6,5,4,3,2]) === parseInt(n[12]) &&
         calc(n, [6,5,4,3,2,9,8,7,6,5,4,3,2]) === parseInt(n[13]);
}

function mascaraCPF(v: string) {
  return v.replace(/\D/g,'').slice(0,11).replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d{1,2})$/,'$1-$2');
}
function mascaraCNPJ(v: string) {
  return v.replace(/\D/g,'').slice(0,14).replace(/(\d{2})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1/$2').replace(/(\d{4})(\d{1,2})$/,'$1-$2');
}
function mascaraTelefone(v: string) {
  const n = v.replace(/\D/g,'').slice(0,11);
  return n.length <= 10 ? n.replace(/(\d{2})(\d{4})(\d{0,4})/,'($1) $2-$3') : n.replace(/(\d{2})(\d{5})(\d{0,4})/,'($1) $2-$3');
}
function mascaraCEP(v: string) {
  return v.replace(/\D/g,'').slice(0,8).replace(/(\d{5})(\d{1,3})$/,'$1-$2');
}

// ─── Types ────────────────────────────────────────────────────────────────────

type TipoDoc        = 'cpf' | 'cnpj';
type TipoFornecedor = 'MEDICAMENTO' | 'PRESTACAO_SERVICO' | 'ALMOXARIFADO';

// frequenciaVisitas = 1→MEDICAMENTO, 2→PRESTACAO_SERVICO, 3→ALMOXARIFADO
const TIPO_MAP: Record<number, TipoFornecedor> = { 1: 'MEDICAMENTO', 2: 'PRESTACAO_SERVICO', 3: 'ALMOXARIFADO' };
const TIPO_LABEL: Record<TipoFornecedor, string> = {
  MEDICAMENTO:      'Medicamento',
  PRESTACAO_SERVICO:'Prestação de Serviço',
  ALMOXARIFADO:     'Almoxarifado',
};

interface Fornecedor {
  id:               number;
  fullName:         string;
  email:            string;
  phone:            string | null;
  cpf:              string | null;
  cnpj:             string | null;
  frequenciaVisitas: number | null;
  complemento:      string | null;
  cep:              string | null;
  endereco:         string | null;
  bairro:           string | null;
  cidade:           string | null;
  estado:           string | null;
  ativo:            boolean;
  createdAt:        string;
}

interface FormForn {
  fullName:       string;
  email:          string;
  phone:          string;
  tipoDoc:        TipoDoc;
  cpf:            string;
  cnpj:           string;
  tipoFornecedor: TipoFornecedor | '';
  tipoServico:    string;
  cep:            string;
  endereco:       string;
  complemento:    string;
  bairro:         string;
  cidade:         string;
  estado:         string;
}

const FORM_INICIAL: FormForn = {
  fullName: '', email: '', phone: '',
  tipoDoc: 'cnpj', cpf: '', cnpj: '',
  tipoFornecedor: '', tipoServico: '',
  cep: '', endereco: '', complemento: '', bairro: '', cidade: '', estado: '',
};

// ─── Modal ────────────────────────────────────────────────────────────────────

function ModalFornecedor({
  editando, form, saving,
  onFormChange, onSalvar, onClose,
}: {
  editando:    Fornecedor | null;
  form:        FormForn;
  saving:      boolean;
  onFormChange:(updates: Partial<FormForn>) => void;
  onSalvar:    () => void;
  onClose:     () => void;
}) {
  const [buscandoCNPJ, setBuscandoCNPJ] = useState(false);
  const [buscandoCEP,  setBuscandoCEP]  = useState(false);
  const [docError,     setDocError]     = useState('');
  const cnpjTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const docNums  = (form.tipoDoc === 'cpf' ? form.cpf : form.cnpj).replace(/\D/g,'');
  const docValido= form.tipoDoc === 'cpf'
    ? docNums.length === 11 ? validarCPF(form.cpf) : null
    : docNums.length === 14 ? validarCNPJ(form.cnpj) : null;

  const handleDoc = (raw: string) => {
    setDocError('');
    if (form.tipoDoc === 'cpf') {
      onFormChange({ cpf: mascaraCPF(raw) });
    } else {
      const masked = mascaraCNPJ(raw);
      onFormChange({ cnpj: masked });
      const nums = raw.replace(/\D/g,'');
      if (nums.length === 14 && validarCNPJ(masked)) {
        if (cnpjTimer.current) clearTimeout(cnpjTimer.current);
        cnpjTimer.current = setTimeout(() => buscarCNPJ(nums), 300);
      } else if (nums.length === 14) setDocError('CNPJ inválido');
    }
  };

  const buscarCNPJ = async (nums: string) => {
    setBuscandoCNPJ(true);
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${nums}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      onFormChange({
        fullName:  data.razao_social ?? form.fullName,
        cep:       data.cep ? mascaraCEP(data.cep.replace(/\D/g,'')) : form.cep,
        endereco:  data.logradouro ? `${data.logradouro}${data.numero ? ', '+data.numero : ''}` : form.endereco,
        bairro:    data.bairro    ?? form.bairro,
        cidade:    data.municipio ?? form.cidade,
        estado:    data.uf        ?? form.estado,
      });
      toast.success('Dados do CNPJ preenchidos');
    } catch { toast('Não foi possível buscar dados do CNPJ.', { icon: 'ℹ️' }); }
    finally { setBuscandoCNPJ(false); }
  };

  const buscarCEP = async (cep: string) => {
    const nums = cep.replace(/\D/g,'');
    if (nums.length !== 8) return;
    setBuscandoCEP(true);
    try {
      const res  = await fetch(`https://viacep.com.br/ws/${nums}/json/`);
      const data = await res.json();
      if (!data.erro) onFormChange({ endereco: data.logradouro ?? '', bairro: data.bairro ?? '', cidade: data.localidade ?? '', estado: data.uf ?? '' });
    } catch { /* silencia */ }
    finally { setBuscandoCEP(false); }
  };

  const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500 transition-colors';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-2xl max-h-[92vh] flex flex-col border border-gray-100">

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <Truck size={18} className="text-emerald-600" />
            {editando ? 'Editar Fornecedor' : 'Novo Fornecedor'}
          </h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* ── Documento ── */}
          <section>
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <BadgeCheck size={12} /> Documento
            </h4>
            <div className="flex gap-2 mb-3">
              {(['cpf','cnpj'] as TipoDoc[]).map(tipo => (
                <button key={tipo} onClick={() => onFormChange({ tipoDoc: tipo, cpf: '', cnpj: '' })}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                    form.tipoDoc === tipo ? 'bg-emerald-700 text-white border-emerald-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}>
                  {tipo === 'cpf' ? <UserIcon size={13} /> : <Building2 size={13} />}
                  {tipo.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="relative">
              {form.tipoDoc === 'cpf' ? (
                <input value={form.cpf} onChange={e => handleDoc(e.target.value)} placeholder="000.000.000-00"
                  className={`${inputCls} ${docValido === false ? 'border-red-300' : docValido === true ? 'border-emerald-400' : ''}`} />
              ) : (
                <input value={form.cnpj} onChange={e => handleDoc(e.target.value)} placeholder="00.000.000/0000-00"
                  className={`${inputCls} pr-9 ${docValido === false ? 'border-red-300' : docValido === true ? 'border-emerald-400' : ''}`} />
              )}
              {buscandoCNPJ && <Loader2 size={14} className="animate-spin text-emerald-600 absolute right-3 top-1/2 -translate-y-1/2" />}
            </div>
            {docError && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle size={11} />{docError}</p>}
            {docValido === false && !docError && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle size={11} />{form.tipoDoc.toUpperCase()} inválido</p>}
            {docValido === true  && <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1"><BadgeCheck size={11} />{form.tipoDoc.toUpperCase()} válido</p>}
          </section>

          {/* ── Dados ── */}
          <section>
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <UserIcon size={12} /> Dados do Fornecedor
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Nome / Razão Social *</label>
                <input value={form.fullName} onChange={e => onFormChange({ fullName: e.target.value })}
                  placeholder="Nome do fornecedor" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">E-mail *</label>
                <input type="email" value={form.email} onChange={e => onFormChange({ email: e.target.value })}
                  placeholder="email@fornecedor.com" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Telefone</label>
                <input value={form.phone} onChange={e => onFormChange({ phone: mascaraTelefone(e.target.value) })}
                  placeholder="(00) 00000-0000" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Tipo de Fornecedor *</label>
                <select value={form.tipoFornecedor} onChange={e => onFormChange({ tipoFornecedor: e.target.value as TipoFornecedor, tipoServico: '' })}
                  className={`${inputCls} ${!form.tipoFornecedor ? 'border-red-200 focus:border-red-400' : ''}`}>
                  <option value="">Selecione...</option>
                  <option value="MEDICAMENTO">Medicamento</option>
                  <option value="PRESTACAO_SERVICO">Prestação de Serviço</option>
                  <option value="ALMOXARIFADO">Almoxarifado</option>
                </select>
              </div>
              {form.tipoFornecedor === 'PRESTACAO_SERVICO' && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Tipo de Serviço *</label>
                  <input value={form.tipoServico} onChange={e => onFormChange({ tipoServico: e.target.value })}
                    placeholder="Ex: Ferrageamento, Transporte..." className={inputCls} />
                </div>
              )}
            </div>
          </section>

          {/* ── Endereço ── */}
          <section>
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <MapPin size={12} /> Endereço
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">CEP</label>
                <div className="relative">
                  <input value={form.cep} placeholder="00000-000"
                    onChange={e => { const v = mascaraCEP(e.target.value); onFormChange({ cep: v }); if (v.replace(/\D/g,'').length === 8) buscarCEP(v); }}
                    className={`${inputCls} pr-8`} />
                  {buscandoCEP && <Loader2 size={12} className="animate-spin text-emerald-600 absolute right-3 top-1/2 -translate-y-1/2" />}
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Endereço</label>
                <input value={form.endereco} onChange={e => onFormChange({ endereco: e.target.value })}
                  placeholder="Rua, av., rodovia..." className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Complemento</label>
                <input value={form.complemento} onChange={e => onFormChange({ complemento: e.target.value })}
                  placeholder="Apto, sala..." className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Bairro</label>
                <input value={form.bairro} onChange={e => onFormChange({ bairro: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Cidade</label>
                <input value={form.cidade} onChange={e => onFormChange({ cidade: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Estado</label>
                <input value={form.estado} onChange={e => onFormChange({ estado: e.target.value.toUpperCase().slice(0,2) })}
                  placeholder="SP" maxLength={2} className={inputCls} />
              </div>
            </div>
          </section>

        </div>

        <div className="flex gap-3 px-5 pb-5 pt-3 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose} disabled={saving}
            className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors">
            Cancelar
          </button>
          <button onClick={onSalvar} disabled={saving}
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

export default function CadastroFornecedor() {
  const { podeExecutar, isSocio } = usePermissoes();

  const podeCriar   = isSocio || podeExecutar('cadastro.fornecedor.criar');
  const podeEditar  = isSocio || podeExecutar('cadastro.fornecedor.editar');
  const podeDeletar = isSocio || podeExecutar('cadastro.fornecedor.deletar');

  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [busca,        setBusca]        = useState('');
  const [showModal,    setShowModal]    = useState(false);
  const [editando,     setEditando]     = useState<Fornecedor | null>(null);
  const [form,         setForm]         = useState<FormForn>(FORM_INICIAL);
  const [saving,       setSaving]       = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (busca.trim()) params.set('busca', busca.trim());
      params.set('ativo', 'all');
      const res = await api.get(`/cadastro/fornecedores?${params}`);
      setFornecedores(res.data.dados ?? []);
    } catch { toast.error('Erro ao carregar fornecedores'); }
    finally { setLoading(false); }
  }, [busca]);

  useEffect(() => { carregar(); }, [carregar]);

  const tipoLabel = (f: Fornecedor): string => {
    const t = f.frequenciaVisitas ? TIPO_MAP[f.frequenciaVisitas] : undefined;
    if (!t) return '—';
    if (t === 'PRESTACAO_SERVICO' && f.complemento) return `Prestação: ${f.complemento}`;
    return TIPO_LABEL[t];
  };

  const abrirNovo = () => { setEditando(null); setForm(FORM_INICIAL); setShowModal(true); };

  const abrirEdicao = (f: Fornecedor) => {
    const tipo = f.frequenciaVisitas ? TIPO_MAP[f.frequenciaVisitas] : '';
    setEditando(f);
    setForm({
      fullName:       f.fullName,
      email:          f.email,
      phone:          f.phone ? mascaraTelefone(f.phone.replace(/\D/g,'')) : '',
      tipoDoc:        f.cnpj ? 'cnpj' : 'cpf',
      cpf:            f.cpf  ? mascaraCPF(f.cpf.replace(/\D/g,''))  : '',
      cnpj:           f.cnpj ? mascaraCNPJ(f.cnpj.replace(/\D/g,'')): '',
      tipoFornecedor: tipo || '',
      tipoServico:    tipo === 'PRESTACAO_SERVICO' ? (f.complemento ?? '') : '',
      cep:            f.cep      ? mascaraCEP(f.cep.replace(/\D/g,'')) : '',
      endereco:       f.endereco    ?? '',
      complemento:    tipo === 'PRESTACAO_SERVICO' ? '' : (f.complemento ?? ''),
      bairro:         f.bairro      ?? '',
      cidade:         f.cidade      ?? '',
      estado:         f.estado      ?? '',
    });
    setShowModal(true);
  };

  const fecharModal = () => { setShowModal(false); setEditando(null); setForm(FORM_INICIAL); };
  const handleFormChange = (updates: Partial<FormForn>) => setForm(prev => ({ ...prev, ...updates }));

  const handleSalvar = async () => {
    if (!form.fullName.trim())    { toast.error('Nome é obrigatório'); return; }
    if (!form.email.trim())       { toast.error('E-mail é obrigatório'); return; }
    if (!form.tipoFornecedor)     { toast.error('Tipo de fornecedor é obrigatório'); return; }
    if (form.tipoFornecedor === 'PRESTACAO_SERVICO' && !form.tipoServico.trim()) {
      toast.error('Informe o tipo de serviço'); return;
    }

    setSaving(true);
    const payload = {
      fullName:       form.fullName,
      email:          form.email,
      phone:          form.phone   || null,
      cpf:            form.tipoDoc === 'cpf'  && form.cpf.trim()  ? form.cpf  : null,
      cnpj:           form.tipoDoc === 'cnpj' && form.cnpj.trim() ? form.cnpj : null,
      tipoFornecedor: form.tipoFornecedor,
      tipoServico:    form.tipoFornecedor === 'PRESTACAO_SERVICO' ? form.tipoServico : null,
      cep:            form.cep         || null,
      endereco:       form.endereco    || null,
      complemento:    form.complemento || null,
      bairro:         form.bairro      || null,
      cidade:         form.cidade      || null,
      estado:         form.estado      || null,
    };

    try {
      if (editando) {
        await api.put(`/cadastro/fornecedores/${editando.id}`, payload);
        toast.success('Fornecedor atualizado');
      } else {
        await api.post('/cadastro/fornecedores', payload);
        toast.success('Fornecedor cadastrado');
      }
      fecharModal();
      carregar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } })?.response?.data?.mensagem;
      toast.error(msg ?? 'Erro ao salvar');
    } finally { setSaving(false); }
  };

  const handleToggle = async (f: Fornecedor) => {
    try {
      await api.patch(`/cadastro/fornecedores/${f.id}/toggle`);
      toast.success(f.ativo ? 'Fornecedor inativado' : 'Fornecedor ativado');
      carregar();
    } catch { toast.error('Erro ao alternar status'); }
  };

  const handleExcluir = async (f: Fornecedor) => {
    if (!confirm(`Inativar o fornecedor "${f.fullName}"?`)) return;
    try {
      await api.delete(`/cadastro/fornecedores/${f.id}`);
      toast.success('Fornecedor inativado');
      carregar();
    } catch { toast.error('Erro ao inativar'); }
  };

  return (
    <PageContainer maxWidth="7xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Truck size={24} className="text-emerald-600" /> Fornecedores
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Cadastro de fornecedores</p>
        </div>
        {podeCriar && (
          <button onClick={abrirNovo}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-2xl shadow-sm transition-colors">
            Novo Fornecedor
          </button>
        )}
      </div>

      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input type="text" placeholder="Buscar por nome, CPF, CNPJ..."
          value={busca} onChange={e => setBusca(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 bg-white transition-colors" />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={24} className="animate-spin text-emerald-600" /></div>
      ) : fornecedores.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Truck size={40} className="mb-3 text-gray-200" />
          <p className="text-sm text-gray-400">Nenhum fornecedor encontrado</p>
          {podeCriar && (
            <button onClick={abrirNovo}
              className="mt-4 px-4 py-2 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 transition-colors">
              Novo Fornecedor
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Mobile */}
          <div className="md:hidden space-y-3">
            {fornecedores.map(f => (
              <div key={f.id} className={`bg-white rounded-2xl border p-4 shadow-sm ${!f.ativo ? 'opacity-60' : 'border-gray-100'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{f.fullName}</p>
                    <p className="text-xs text-gray-500 truncate">{f.email}</p>
                    {f.phone && <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5"><Phone size={10} />{f.phone}</p>}
                    {f.cidade && <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5"><MapPin size={10} />{f.cidade}{f.estado ? ` — ${f.estado}` : ''}</p>}
                    <span className="inline-block mt-1 text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">{tipoLabel(f)}</span>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${f.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                    {f.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-50">
                  {podeEditar && (
                    <>
                      <button onClick={() => abrirEdicao(f)}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 transition-colors">
                        <Pencil size={11} /> Editar
                      </button>
                      <button onClick={() => handleToggle(f)}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 transition-colors">
                        {f.ativo ? <ToggleRight size={11} className="text-emerald-600" /> : <ToggleLeft size={11} />}
                        {f.ativo ? 'Inativar' : 'Ativar'}
                      </button>
                    </>
                  )}
                  {podeDeletar && f.ativo && (
                    <button onClick={() => handleExcluir(f)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop */}
          <div className="hidden md:block bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Nome</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Documento</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Telefone</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Tipo</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {fornecedores.map(f => (
                  <tr key={f.id} className={`hover:bg-gray-50 transition-colors ${!f.ativo ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{f.fullName}</p>
                      <p className="text-xs text-gray-400 truncate max-w-[200px]">{f.email}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {f.cnpj ?? f.cpf ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {f.phone ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[11px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">{tipoLabel(f)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${f.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                        {f.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {podeEditar && (
                          <>
                            <button onClick={() => abrirEdicao(f)} title="Editar"
                              className="p-1.5 text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors">
                              <Pencil size={14} />
                            </button>
                            <button onClick={() => handleToggle(f)} title={f.ativo ? 'Inativar' : 'Ativar'}
                              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">
                              {f.ativo ? <ToggleRight size={14} className="text-emerald-600" /> : <ToggleLeft size={14} />}
                            </button>
                          </>
                        )}
                        {podeDeletar && f.ativo && (
                          <button onClick={() => handleExcluir(f)} title="Inativar"
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
        <ModalFornecedor
          editando={editando}
          form={form}
          saving={saving}
          onFormChange={handleFormChange}
          onSalvar={handleSalvar}
          onClose={fecharModal}
        />
      )}
    </PageContainer>
  );
}
