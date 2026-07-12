// frontend/src/pages/CadastroProprietario.tsx

import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  Pencil, Trash2, Search, Loader2, X, Users,
  Building2, User as UserIcon,
  Phone, MapPin, BadgeCheck, AlertCircle, Info,
} from 'lucide-react';
import PageContainer from '../components/PageContainer';
import { usePermissoes } from '../hooks/usePermissoes';
import { useAuth } from '../contexts/AuthContext';
import ModalJustificativa from '../components/ModalJustificativa';
import BotaoVoltar from '../components/BotaoVoltar';

// ─── Validações CPF/CNPJ ──────────────────────────────────────────────────────

function validarCPF(cpf: string): boolean {
  const n = cpf.replace(/\D/g, '');
  if (n.length !== 11 || /^(\d)\1+$/.test(n)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += parseInt(n[i]) * (10 - i);
  let r = (s * 10) % 11;
  if (r === 10 || r === 11) r = 0;
  if (r !== parseInt(n[9])) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += parseInt(n[i]) * (11 - i);
  r = (s * 10) % 11;
  if (r === 10 || r === 11) r = 0;
  return r === parseInt(n[10]);
}

function validarCNPJ(cnpj: string): boolean {
  const n = cnpj.replace(/\D/g, '');
  if (n.length !== 14 || /^(\d)\1+$/.test(n)) return false;
  const calc = (s: string, w: number[]) => {
    let soma = 0;
    for (let i = 0; i < w.length; i++) soma += parseInt(s[i]) * w[i];
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return (
    calc(n, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === parseInt(n[12]) &&
    calc(n, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === parseInt(n[13])
  );
}

function mascaraCPF(v: string): string {
  return v.replace(/\D/g, '').slice(0, 11)
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

function mascaraCNPJ(v: string): string {
  return v.replace(/\D/g, '').slice(0, 14)
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

function mascaraTelefone(v: string): string {
  const n = v.replace(/\D/g, '').slice(0, 11);
  if (n.length <= 10) return n.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
  return n.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
}

function mascaraCEP(v: string): string {
  return v.replace(/\D/g, '').slice(0, 8).replace(/(\d{5})(\d{1,3})$/, '$1-$2');
}

// Senha padrão de novos cadastros — troca obrigatória no primeiro acesso
const SENHA_PADRAO_INICIAL = 'Inicial_001';

// Formata valor monetário sempre com decimais visíveis
function formatarMoeda(v: string): string {
  const nums = v.replace(/\D/g, '');
  if (!nums) return '';
  const n = parseInt(nums, 10) / 100;
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseMoeda(v: string): number {
  return parseFloat(v.replace(/\./g, '').replace(',', '.')) || 0;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type TipoDoc = 'cpf' | 'cnpj';

interface Proprietario {
  id:               number;
  fullName:         string;
  email:            string;
  phone:            string | null;
  cpf:              string | null;
  cnpj:             string | null;
  mensalista:       boolean;
  valorAssistencia: number | null;
  frequenciaVisitas: number | null;
  cep:              string | null;
  endereco:         string | null;
  complemento:      string | null;
  bairro:           string | null;
  cidade:           string | null;
  estado:           string | null;
  ativo:            boolean;
  createdAt:        string;
}

interface FormProp {
  fullName:          string;
  email:             string;
  phone:             string;
  tipoDoc:           TipoDoc;
  cpf:               string;
  cnpj:              string;
  mensalista:        boolean;
  valorAssistencia:  string;
  frequenciaVisitas: string;
  cep:               string;
  endereco:          string;
  complemento:       string;
  bairro:            string;
  cidade:            string;
  estado:            string;
}

const FORM_INICIAL: FormProp = {
  fullName: '', email: '', phone: '',
  tipoDoc: 'cpf', cpf: '', cnpj: '',
  mensalista: false, valorAssistencia: '', frequenciaVisitas: '',
  cep: '', endereco: '', complemento: '', bairro: '', cidade: '', estado: '',
};

const VISITAS_OPTIONS = [
  { value: '1', label: '1x na semana' },
  { value: '2', label: '2x na semana' },
  { value: '3', label: '3x na semana' },
  { value: '4', label: '4x na semana' },
  { value: '5', label: '5x na semana' },
  { value: '6', label: '6x na semana' },
  { value: '7', label: '7x na semana (diário)' },
];

// ─── Modal Formulário ─────────────────────────────────────────────────────────

function ModalProprietario({
  editando, form, saving,
  onFormChange, onSalvar, onClose,
}: {
  editando:    Proprietario | null;
  form:        FormProp;
  saving:      boolean;
  onFormChange: (updates: Partial<FormProp>) => void;
  onSalvar:    () => void;
  onClose:     () => void;
}) {
  const [buscandoCNPJ,  setBuscandoCNPJ]  = useState(false);
  const [docError,      setDocError]      = useState('');
  const [buscandoCEP,   setBuscandoCEP]   = useState(false);
  const cnpjTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTipoDoc = (tipo: TipoDoc) => {
    setDocError('');
    onFormChange({ tipoDoc: tipo, cpf: '', cnpj: '' });
  };

  const docNums = (form.tipoDoc === 'cpf' ? form.cpf : form.cnpj).replace(/\D/g, '');
  const docValido = form.tipoDoc === 'cpf'
    ? docNums.length === 11 ? validarCPF(form.cpf) : null
    : docNums.length === 14 ? validarCNPJ(form.cnpj) : null;

  const handleDoc = (raw: string) => {
    setDocError('');
    if (form.tipoDoc === 'cpf') {
      onFormChange({ cpf: mascaraCPF(raw) });
    } else {
      const masked = mascaraCNPJ(raw);
      onFormChange({ cnpj: masked });
      const nums = raw.replace(/\D/g, '');
      if (nums.length === 14) {
        if (validarCNPJ(masked)) {
          if (cnpjTimerRef.current) clearTimeout(cnpjTimerRef.current);
          cnpjTimerRef.current = setTimeout(() => buscarCNPJ(nums), 300);
        } else {
          setDocError('CNPJ inválido');
        }
      }
    }
  };

  const buscarCNPJ = async (nums: string) => {
    setBuscandoCNPJ(true);
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${nums}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const cepFormatado = data.cep ? mascaraCEP(data.cep.replace(/\D/g, '')) : '';
      const enderecoStr  = data.logradouro
        ? `${data.logradouro}${data.numero ? ', ' + data.numero : ''}`
        : '';
      onFormChange({
        fullName:    data.razao_social  ?? form.fullName,
        cep:         cepFormatado       || form.cep,
        endereco:    enderecoStr        || form.endereco,
        complemento: data.complemento  ?? form.complemento,
        bairro:      data.bairro       ?? form.bairro,
        cidade:      data.municipio    ?? form.cidade,
        estado:      data.uf           ?? form.estado,
      });
      toast.success('Dados do CNPJ preenchidos automaticamente');
    } catch {
      toast('CNPJ válido, mas não foi possível buscar os dados.', { icon: 'ℹ️' });
    } finally { setBuscandoCNPJ(false); }
  };

  const buscarCEP = async (cep: string) => {
    const nums = cep.replace(/\D/g, '');
    if (nums.length !== 8) return;
    setBuscandoCEP(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${nums}/json/`);
      const data = await res.json();
      if (!data.erro) {
        onFormChange({
          endereco: data.logradouro ?? '',
          bairro:   data.bairro     ?? '',
          cidade:   data.localidade ?? '',
          estado:   data.uf         ?? '',
        });
      }
    } catch { /* silencia */ }
    finally { setBuscandoCEP(false); }
  };

  const handleValorChange = (v: string) => {
    // Remove tudo que não for dígito
    const digits = v.replace(/\D/g, '');
    onFormChange({ valorAssistencia: digits ? formatarMoeda(digits) : '' });
  };

  const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500 transition-colors';
  const inputReqCls = (v: string) =>
    `${inputCls} ${!v.trim() ? 'border-red-200 focus:border-red-400' : ''}`;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-2xl max-h-[92vh] flex flex-col border border-gray-100">

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <Users size={18} className="text-emerald-600" />
            {editando ? 'Editar Proprietário' : 'Novo Proprietário'}
          </h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* ── Documento (PRIMEIRO) ── */}
          <section>
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <BadgeCheck size={12} /> Documento
            </h4>

            <div className="flex gap-2 mb-3">
              {(['cpf', 'cnpj'] as TipoDoc[]).map(tipo => (
                <button key={tipo}
                  onClick={() => handleTipoDoc(tipo)}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                    form.tipoDoc === tipo
                      ? 'bg-emerald-700 text-white border-emerald-700'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}>
                  {tipo === 'cpf' ? <UserIcon size={13} /> : <Building2 size={13} />}
                  {tipo.toUpperCase()}
                </button>
              ))}
            </div>

            <div className="relative">
              {form.tipoDoc === 'cpf' ? (
                <input value={form.cpf}
                  onChange={e => handleDoc(e.target.value)}
                  placeholder="000.000.000-00"
                  className={`${inputCls} ${docValido === false ? 'border-red-300 bg-red-50/30' : docValido === true ? 'border-emerald-400' : ''}`}
                />
              ) : (
                <input value={form.cnpj}
                  onChange={e => handleDoc(e.target.value)}
                  placeholder="00.000.000/0000-00"
                  className={`${inputCls} pr-9 ${docValido === false ? 'border-red-300 bg-red-50/30' : docValido === true ? 'border-emerald-400' : ''}`}
                />
              )}
              {buscandoCNPJ && (
                <Loader2 size={14} className="animate-spin text-emerald-600 absolute right-3 top-1/2 -translate-y-1/2" />
              )}
            </div>
            {docError && (
              <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                <AlertCircle size={11} /> {docError}
              </p>
            )}
            {docValido === false && !docError && (
              <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                <AlertCircle size={11} /> {form.tipoDoc.toUpperCase()} inválido
              </p>
            )}
            {docValido === true && (
              <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                <BadgeCheck size={11} /> {form.tipoDoc.toUpperCase()} válido
              </p>
            )}
            {form.tipoDoc === 'cnpj' && docValido === true && (
              <p className="text-[11px] text-gray-400 mt-1">Dados da empresa preenchidos automaticamente</p>
            )}
          </section>

          {/* ── Dados Pessoais ── */}
          <section>
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <UserIcon size={12} /> Dados Pessoais
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Nome completo *</label>
                <input value={form.fullName} onChange={e => onFormChange({ fullName: e.target.value })}
                  placeholder="Nome do proprietário" className={inputReqCls(form.fullName)} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">E-mail *</label>
                <input type="email" value={form.email} onChange={e => onFormChange({ email: e.target.value })}
                  placeholder="email@exemplo.com" className={inputReqCls(form.email)} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Telefone *</label>
                <input value={form.phone}
                  onChange={e => onFormChange({ phone: mascaraTelefone(e.target.value) })}
                  placeholder="(00) 00000-0000" className={inputReqCls(form.phone)} />
              </div>
              {!editando && (
                <div className="sm:col-span-2">
                  <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2.5 text-xs text-emerald-700">
                    <Info size={12} className="flex-shrink-0 mt-0.5" />
                    <span>
                      A senha inicial é a padrão <strong>{SENHA_PADRAO_INICIAL}</strong> —
                      o proprietário receberá um e-mail de boas-vindas e deverá
                      alterá-la no primeiro acesso.
                    </span>
                  </div>
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
                  <input value={form.cep}
                    onChange={e => {
                      const v = mascaraCEP(e.target.value);
                      onFormChange({ cep: v });
                      if (v.replace(/\D/g, '').length === 8) buscarCEP(v);
                    }}
                    placeholder="00000-000"
                    className={`${inputCls} pr-8`}
                  />
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
                <input value={form.bairro} onChange={e => onFormChange({ bairro: e.target.value })}
                  className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Cidade</label>
                <input value={form.cidade} onChange={e => onFormChange({ cidade: e.target.value })}
                  className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Estado</label>
                <input value={form.estado} onChange={e => onFormChange({ estado: e.target.value.toUpperCase().slice(0, 2) })}
                  placeholder="SP" maxLength={2} className={inputCls} />
              </div>
            </div>
          </section>

          {/* ── Configuração ── */}
          <section>
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Contrato / Visitas</h4>

            <div className="flex items-center justify-between p-3 border border-gray-200 rounded-xl mb-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">Mensalista</p>
                <p className="text-xs text-gray-500">Possui plano mensal de assistência veterinária</p>
              </div>
              <button
                onClick={() => onFormChange({ mensalista: !form.mensalista, valorAssistencia: '' })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.mensalista ? 'bg-emerald-600' : 'bg-gray-200'}`}>
                <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transform transition-transform ${form.mensalista ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            {form.mensalista && (
              <div className="mb-3">
                <label className="block text-xs text-gray-500 mb-1">Valor da Assistência Veterinária *</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">R$</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={form.valorAssistencia}
                    onChange={e => handleValorChange(e.target.value)}
                    placeholder="0,00"
                    className={`${inputCls} pl-9`}
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs text-gray-500 mb-1">Frequência de Visitas *</label>
              <select
                value={form.frequenciaVisitas}
                onChange={e => onFormChange({ frequenciaVisitas: e.target.value })}
                className={`${inputCls} ${!form.frequenciaVisitas ? 'border-red-200 focus:border-red-400' : ''}`}>
                <option value="">Selecione a frequência...</option>
                {VISITAS_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </section>

        </div>

        <div className="flex gap-3 px-5 pb-5 pt-3 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose} disabled={saving}
            className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors disabled:opacity-50">
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

export default function CadastroProprietario() {
  const { user }    = useAuth();
  const isAdmin     = user?.role === 'ADMIN';
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();

  const podeCriar   = isGestor || podeExecutar('cadastro.proprietario.criar');
  const podeEditar  = isGestor || podeExecutar('cadastro.proprietario.editar');
  const podeRemover = isGestor || podeExecutar('cadastro.proprietario.deletar');

  const semPermissao = (acao: string) =>
    toast.error(`Sem permissão para ${acao}. Verifique com o responsável da equipe.`);

  const [proprietarios, setProprietarios] = useState<Proprietario[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [busca,         setBusca]         = useState('');
  const [showModal,     setShowModal]     = useState(false);
  const [editando,      setEditando]      = useState<Proprietario | null>(null);
  const [form,          setForm]          = useState<FormProp>(FORM_INICIAL);
  const [saving,        setSaving]        = useState(false);
  const [confirmRemov,  setConfirmRemov]  = useState<Proprietario | null>(null);
  const [filtroAtivo,   setFiltroAtivo]   = useState<'ativo' | 'inativo' | 'all'>('ativo');
  const [showInfo,      setShowInfo]      = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/cadastro/proprietarios', {
        params: {
          busca: busca || undefined,
          ativo: filtroAtivo === 'all' ? 'all' : filtroAtivo === 'ativo' ? 'true' : 'false',
        },
      });
      if (!res.data) return;
      setProprietarios(res.data.dados ?? []);
    } catch { toast.error('Erro ao carregar proprietários'); }
    finally { setLoading(false); }
  }, [busca, filtroAtivo]);

  useEffect(() => { if (!loadingPerms) carregar(); }, [carregar, loadingPerms]);

  const abrirNovo = () => {
    setEditando(null);
    setForm(FORM_INICIAL);
    setShowModal(true);
  };

  const abrirEdicao = (p: Proprietario) => {
    setEditando(p);
    setForm({
      fullName:          p.fullName,
      email:             p.email,
      phone:             p.phone ? mascaraTelefone(p.phone.replace(/\D/g, '')) : '',
      tipoDoc:           p.cnpj ? 'cnpj' : 'cpf',
      cpf:               p.cpf  ? mascaraCPF(p.cpf.replace(/\D/g, ''))   : '',
      cnpj:              p.cnpj ? mascaraCNPJ(p.cnpj.replace(/\D/g, '')) : '',
      mensalista:        p.mensalista,
      valorAssistencia:  p.valorAssistencia
        ? formatarMoeda(String(Math.round(p.valorAssistencia * 100)))
        : '',
      frequenciaVisitas: p.frequenciaVisitas ? String(p.frequenciaVisitas) : '',
      cep:               p.cep         ? mascaraCEP(p.cep.replace(/\D/g, ''))  : '',
      endereco:          p.endereco    ?? '',
      complemento:       p.complemento ?? '',
      bairro:            p.bairro      ?? '',
      cidade:            p.cidade      ?? '',
      estado:            p.estado      ?? '',
    });
    setShowModal(true);
  };

  const fecharModal = () => { setShowModal(false); setEditando(null); setForm(FORM_INICIAL); };

  const handleFormChange = (updates: Partial<FormProp>) =>
    setForm(prev => ({ ...prev, ...updates }));

  const handleSalvar = async () => {
    if (editando && !podeEditar) { semPermissao('alterar proprietário'); return; }
    if (!editando && !podeCriar) { semPermissao('criar proprietário'); return; }
    if (!form.fullName.trim())      { toast.error('Nome é obrigatório'); return; }
    if (!form.email.trim())         { toast.error('E-mail é obrigatório'); return; }
    if (!form.phone.trim())         { toast.error('Telefone é obrigatório'); return; }
    if (!form.frequenciaVisitas)    { toast.error('Frequência de visitas é obrigatória'); return; }

    // Documento é opcional, mas se preenchido precisa ser válido
    if (form.tipoDoc === 'cpf'  && form.cpf.trim()  && !validarCPF(form.cpf))   { toast.error('CPF inválido'); return; }
    if (form.tipoDoc === 'cnpj' && form.cnpj.trim() && !validarCNPJ(form.cnpj)) { toast.error('CNPJ inválido'); return; }
    if (form.mensalista && !form.valorAssistencia) {
      toast.error('Informe o valor da assistência veterinária'); return;
    }

    setSaving(true);
    const payload = {
      fullName:          form.fullName,
      email:             form.email,
      phone:             form.phone  || null,
      cpf:               form.tipoDoc === 'cpf'  && form.cpf.trim()  ? form.cpf  : null,
      cnpj:              form.tipoDoc === 'cnpj' && form.cnpj.trim() ? form.cnpj : null,
      mensalista:        form.mensalista,
      valorAssistencia:  form.mensalista && form.valorAssistencia ? parseMoeda(form.valorAssistencia) : null,
      frequenciaVisitas: form.frequenciaVisitas ? Number(form.frequenciaVisitas) : null,
      cep:               form.cep         || null,
      endereco:          form.endereco    || null,
      complemento:       form.complemento || null,
      bairro:            form.bairro      || null,
      cidade:            form.cidade      || null,
      estado:            form.estado      || null,
    };

    try {
      if (editando) {
        await api.put(`/cadastro/proprietarios/${editando.id}`, payload);
        toast.success('Proprietário atualizado');
      } else {
        await api.post('/cadastro/proprietarios', payload);
        toast.success('Proprietário cadastrado — e-mail de boas-vindas enviado');
      }
      fecharModal();
      carregar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } })?.response?.data?.mensagem;
      toast.error(msg ?? 'Erro ao salvar');
    } finally { setSaving(false); }
  };

  const handleRemoverDaEmpresa = (p: Proprietario) => {
    if (!podeRemover) { semPermissao('remover proprietário da empresa'); return; }
    setConfirmRemov(p);
  };

  const handleRemoverConfirmado = async (motivo: string) => {
    if (!confirmRemov) return;
    const p = confirmRemov;
    setConfirmRemov(null);
    try {
      // Remoção exige justificativa (registrada na Auditoria)
      await api.delete(`/cadastro/proprietarios/${p.id}`, { data: { motivo } });
      toast.success(`Proprietário removido da empresa`);
      carregar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } })?.response?.data?.mensagem;
      toast.error(msg ?? 'Erro ao remover proprietário');
    }
  };

  const labelDoc = (p: Proprietario) => {
    if (p.cnpj) return p.cnpj;
    if (p.cpf)  return p.cpf;
    return <span className="text-gray-300">—</span>;
  };

  if (loadingPerms) return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full" />
    </div>
  );

  if (!podeExecutar('cadastro.proprietario.ler')) return (
    <PageContainer maxWidth="7xl">
      <div className="text-center py-16">
        <h2 className="text-lg font-semibold text-gray-700 mb-2">Acesso não autorizado</h2>
        <p className="text-sm text-gray-500">Você não tem permissão para visualizar proprietários.</p>
      </div>
    </PageContainer>
  );

  return (
    <PageContainer maxWidth="7xl">
      <BotaoVoltar />
      <div className="flex items-center justify-between gap-3 mt-2 mb-6 flex-wrap">
        <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold text-gray-900">
          <Users size={22} className="text-emerald-600" /> Proprietários
        </h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowInfo(v => !v)}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-xl"
            title="Informações sobre este cadastro">
            <Info size={18} />
          </button>
          {podeCriar && (
            <button onClick={abrirNovo}
              className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-2xl text-sm font-semibold hover:bg-emerald-700 transition-colors">
              Novo Proprietário
            </button>
          )}
        </div>
      </div>

      {/* ── Info banner ─────────────────────────────────────────────────────── */}
      {showInfo && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-2xl text-sm text-blue-800">
          <strong>Regras deste cadastro:</strong>
          <ul className="mt-1 list-disc pl-5 space-y-0.5">
            <li>Proprietários criados aqui recebem e-mail de boas-vindas com senha inicial.</li>
            <li>A senha padrão é <strong>Inicial_001</strong> — troca obrigatória no primeiro acesso.</li>
            <li>Proprietários são associados à empresa/equipe ativa no momento do cadastro.</li>
            <li>A remoção da empresa não exclui o proprietário do sistema.</li>
          </ul>
        </div>
      )}

      {/* ── Filtros ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por nome, CPF, CNPJ ou cidade…"
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
          />
          {busca && (
            <button onClick={() => setBusca('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex border border-gray-200 rounded-xl overflow-hidden text-sm flex-shrink-0">
          {(['all', 'ativo', 'inativo'] as const).map(v => (
            <button key={v} onClick={() => setFiltroAtivo(v)}
              className={`px-4 py-2.5 font-medium transition-colors border-r border-gray-200 last:border-r-0 ${
                filtroAtivo === v ? 'bg-emerald-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
              }`}>
              {v === 'all' ? 'Todos' : v === 'ativo' ? 'Ativos' : 'Inativos'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tabela desktop ────────────────────────────────────────────────────── */}
      <div className="hidden md:block">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 size={32} className="animate-spin text-emerald-500" /></div>
        ) : proprietarios.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Users size={48} className="mx-auto mb-3 opacity-30" />
            <p>Nenhum proprietário encontrado.</p>
          </div>
        ) : (
          <div className="bg-white rounded-3xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Nome</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Documento</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Telefone</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Cidade</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Contrato</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Status</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-600">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {proprietarios.map(p => (
                  <tr key={p.id} className={`hover:bg-gray-50 transition-colors ${!p.ativo ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800">{p.fullName}</p>
                      <p className="text-xs text-gray-400 truncate max-w-[200px]">{p.email}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{labelDoc(p)}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {p.phone ?? <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {p.cidade ? `${p.cidade}${p.estado ? `/${p.estado}` : ''}` : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        {p.mensalista && (
                          <span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium w-fit">Mensalista</span>
                        )}
                        {p.frequenciaVisitas && (
                          <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium w-fit">
                            {p.frequenciaVisitas}x/semana
                          </span>
                        )}
                        {!p.mensalista && !p.frequenciaVisitas && <span className="text-gray-400 text-xs">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-xl text-xs font-medium ${p.ativo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {p.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        {podeEditar ? (
                          <button onClick={() => abrirEdicao(p)} title="Editar"
                            className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-colors">
                            <Pencil size={15} />
                          </button>
                        ) : null}
                        {podeRemover ? (
                          <button onClick={() => handleRemoverDaEmpresa(p)} title="Remover da empresa"
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors">
                            <Trash2 size={15} />
                          </button>
                        ) : null}
                        {!podeEditar && !podeRemover && (
                          <span className="text-xs text-gray-400 italic">Somente leitura</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Cards mobile ──────────────────────────────────────────────────────── */}
      <div className="md:hidden space-y-3">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 size={32} className="animate-spin text-emerald-500" /></div>
        ) : proprietarios.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Users size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">Nenhum proprietário encontrado.</p>
          </div>
        ) : proprietarios.map(p => (
          <div key={p.id} className={`bg-white rounded-3xl border border-gray-200 p-4 ${!p.ativo ? 'opacity-50' : ''}`}>
            <div className="flex justify-between items-start gap-2 mb-2">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-800 truncate">{p.fullName}</p>
                <p className="text-xs text-gray-500 truncate">{p.email}</p>
              </div>
              <span className={`px-2 py-0.5 rounded-xl text-xs font-medium flex-shrink-0 ${p.ativo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {p.ativo ? 'Ativo' : 'Inativo'}
              </span>
            </div>

            {p.phone && (
              <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                <Phone size={12} /> {p.phone}
              </div>
            )}
            {p.cidade && (
              <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                <MapPin size={12} /> {p.cidade}{p.estado ? ` — ${p.estado}` : ''}
              </div>
            )}

            <div className="flex flex-wrap gap-1 mb-3">
              {p.mensalista && (
                <span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">Mensalista</span>
              )}
              {p.frequenciaVisitas && (
                <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                  {p.frequenciaVisitas}x/sem
                </span>
              )}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-gray-100">
              <span className="text-xs text-gray-400">{labelDoc(p)}</span>
              <div className="flex gap-2">
                {podeEditar && (
                  <button onClick={() => abrirEdicao(p)}
                    className="px-3 py-1.5 text-xs text-emerald-600 border border-emerald-200 rounded-xl hover:bg-emerald-50 transition-colors">
                    Editar
                  </button>
                )}
                {podeRemover && (
                  <button onClick={() => handleRemoverDaEmpresa(p)}
                    className="px-3 py-1.5 text-xs text-red-500 border border-red-200 rounded-xl hover:bg-red-50 transition-colors">
                    Remover
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <ModalProprietario
          editando={editando}
          form={form}
          saving={saving}
          onFormChange={handleFormChange}
          onSalvar={handleSalvar}
          onClose={fecharModal}
        />
      )}

      {/* Remoção exige justificativa (registrada na Auditoria) */}
      <ModalJustificativa
        aberto={confirmRemov != null}
        titulo="Remover proprietário da empresa"
        descricao={confirmRemov
          ? `${confirmRemov.fullName} — todos os animais deste proprietário cadastrados na empresa serão inativados e ele não aparecerá mais nesta lista. Ele continuará existindo no sistema e poderá ser re-associado via novos cadastros de animais.`
          : undefined}
        acaoLabel="Remover"
        onConfirmar={handleRemoverConfirmado}
        onFechar={() => setConfirmRemov(null)}
      />
    </PageContainer>
  );
}
