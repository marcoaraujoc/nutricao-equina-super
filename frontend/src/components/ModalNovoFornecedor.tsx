// Formulário de criação de novo fornecedor/profissional — mesmo layout do Novo Cadastro
// em CadastroFornecedor.tsx, mas como modal autônomo que chama a API internamente.
// Usado em UsuarioFormModal quando "Incluir novo fornecedor" é clicado.

import { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import {
  X, Loader2, Truck, User as UserIcon,
  MapPin, BadgeCheck, AlertCircle, Building2,
} from 'lucide-react';
import api from '../services/api';
import { isValidEmail } from '../utils/validators';
import EspecialidadeSelector from './EspecialidadeSelector';
import InlineError from './InlineError';

// ─── Constants ────────────────────────────────────────────────────────────────

export const TIPOS_SERVICO = [
  'Cardiologista',
  'Dermatologista',
  'Farmácia',
  'Ferrador',
  'Fisioterapeuta',
  'Laboratório',
  'Loja',
  'Quiroprata',
  'Radiologista',
] as const;

type TipoServico = typeof TIPOS_SERVICO[number];
type TipoDoc     = 'cpf' | 'cnpj';

// Tipo de fornecedor — especialidades só se aplicam a Veterinário
const TIPOS_FORNECEDOR = ['Veterinário', 'Farmácia', 'Laboratório'] as const;
type TipoFornecedor = typeof TIPOS_FORNECEDOR[number];

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
  return v.replace(/\D/g,'').slice(0,11)
    .replace(/(\d{3})(\d)/,'$1.$2')
    .replace(/(\d{3})(\d)/,'$1.$2')
    .replace(/(\d{3})(\d{1,2})$/,'$1-$2');
}
function mascaraCNPJ(v: string) {
  return v.replace(/\D/g,'').slice(0,14)
    .replace(/(\d{2})(\d)/,'$1.$2')
    .replace(/(\d{3})(\d)/,'$1.$2')
    .replace(/(\d{3})(\d)/,'$1/$2')
    .replace(/(\d{4})(\d{1,2})$/,'$1-$2');
}
function mascaraTel(v: string) {
  const n = v.replace(/\D/g,'').slice(0,11);
  return n.length <= 10
    ? n.replace(/(\d{2})(\d{4})(\d{0,4})/,'($1) $2-$3')
    : n.replace(/(\d{2})(\d{5})(\d{0,4})/,'($1) $2-$3');
}
function mascaraCEP(v: string) {
  return v.replace(/\D/g,'').slice(0,8).replace(/(\d{5})(\d{1,3})$/,'$1-$2');
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface FormForn {
  nome:        string;
  tipoDoc:     TipoDoc;
  cpf:         string;
  cnpj:        string;
  telefone:    string;
  email:       string;
  tipoFornecedor: TipoFornecedor;
  especialidadeIds: number[];
  cep:         string;
  endereco:    string;
  complemento: string;
  bairro:      string;
  cidade:      string;
  estado:      string;
}

const FORM_INICIAL: FormForn = {
  nome: '', tipoDoc: 'cnpj', cpf: '', cnpj: '', telefone: '', email: '',
  tipoFornecedor: 'Veterinário', especialidadeIds: [],
  cep: '', endereco: '', complemento: '', bairro: '', cidade: '', estado: '',
};

export interface NovoFornecedorResult {
  id:       number;
  nome:     string;
  email:    string | null;
  telefone: string | null;
}

interface Props {
  onSalvo: (result: NovoFornecedorResult) => void;
  onClose: () => void;
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function ModalNovoFornecedor({ onSalvo, onClose }: Props) {
  const [form,           setForm]           = useState<FormForn>(FORM_INICIAL);
  const [saving,         setSaving]         = useState(false);
  const [buscandoCNPJ,   setBuscandoCNPJ]   = useState(false);
  const [buscandoCEP,    setBuscandoCEP]    = useState(false);
  const [docError,       setDocError]       = useState('');
  const [dupInativoInfo, setDupInativoInfo] = useState<{ mensagem: string } | null>(null);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);
  const cnpjTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Espécies atendidas pela empresa — filtram as especialidades oferecidas.
  const [especiesEmpresa, setEspeciesEmpresa] = useState<number[]>([]);
  useEffect(() => {
    api.get('/equipes/especies-atendidas')
      .then(res => {
        const lista = res.data?.dados?.especiesAtendidas ?? [];
        setEspeciesEmpresa(Array.isArray(lista) ? lista : []);
      })
      .catch(() => setEspeciesEmpresa([]));
  }, []);

  const upd = (updates: Partial<FormForn>) => setForm(prev => ({ ...prev, ...updates }));

  const docNums  = (form.tipoDoc === 'cpf' ? form.cpf : form.cnpj).replace(/\D/g,'');
  const docValido = form.tipoDoc === 'cpf'
    ? docNums.length === 11 ? validarCPF(form.cpf) : null
    : docNums.length === 14 ? validarCNPJ(form.cnpj) : null;

  const handleDoc = (raw: string) => {
    setDocError('');
    if (form.tipoDoc === 'cpf') {
      upd({ cpf: mascaraCPF(raw) });
    } else {
      const masked = mascaraCNPJ(raw);
      upd({ cnpj: masked });
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
      upd({
        nome:     data.razao_social ?? form.nome,
        cep:      data.cep ? mascaraCEP(data.cep.replace(/\D/g,'')) : form.cep,
        endereco: data.logradouro ? `${data.logradouro}${data.numero ? ', '+data.numero : ''}` : form.endereco,
        bairro:   data.bairro    ?? form.bairro,
        cidade:   data.municipio ?? form.cidade,
        estado:   data.uf        ?? form.estado,
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
      if (!data.erro) upd({
        endereco: data.logradouro ?? '',
        bairro:   data.bairro     ?? '',
        cidade:   data.localidade ?? '',
        estado:   data.uf         ?? '',
      });
    } catch { /* silencia */ }
    finally { setBuscandoCEP(false); }
  };

  const handleSalvar = async (force = false) => {
    if (!form.nome.trim())             { setErroInline('Nome é obrigatório'); return; }
    if (form.tipoFornecedor === 'Veterinário' && form.especialidadeIds.length === 0) {
      setErroInline('Selecione ao menos uma especialidade'); return;
    }
    if (!form.email.trim())            { setErroInline('E-mail é obrigatório'); return; }
    if (!isValidEmail(form.email))     { setErroInline('Informe um e-mail válido'); return; }
    if (!form.telefone.trim())         { setErroInline('Telefone é obrigatório'); return; }
    const docCPF  = form.cpf.replace(/\D/g,'');
    const docCNPJ = form.cnpj.replace(/\D/g,'');
    if (form.tipoDoc === 'cpf'  && docCPF  && !validarCPF(form.cpf))   { setErroInline('CPF inválido');  return; }
    if (form.tipoDoc === 'cnpj' && docCNPJ && !validarCNPJ(form.cnpj)) { setErroInline('CNPJ inválido'); return; }

    setSaving(true);
    try {
      const res = await api.post('/cadastro/fornecedores', {
        nome:        form.nome,
        cpf:         form.tipoDoc === 'cpf'  && docCPF  ? form.cpf  : null,
        cnpj:        form.tipoDoc === 'cnpj' && docCNPJ ? form.cnpj : null,
        telefone:    form.telefone,
        email:       form.email.trim() ? form.email.trim().toLowerCase() : null,
        // Veterinário → especialidades do catálogo; demais tipos → tipoServico é o próprio tipo
        especialidadeIds: form.tipoFornecedor === 'Veterinário' ? form.especialidadeIds : [],
        ...(form.tipoFornecedor !== 'Veterinário' ? { tipoServico: form.tipoFornecedor } : {}),
        cep:         form.cep         || null,
        endereco:    form.endereco    || null,
        complemento: form.complemento || null,
        bairro:      form.bairro      || null,
        cidade:      form.cidade      || null,
        estado:      form.estado      || null,
        ...(force ? { force: true } : {}),
      });
      const novo = res.data?.dados ?? res.data;
      toast.success('Fornecedor cadastrado');
      onSalvo({
        id:       novo.id,
        nome:     novo.nome ?? form.nome,
        email:    novo.email    ?? (form.email.trim() ? form.email.trim().toLowerCase() : null),
        telefone: novo.telefone ?? (form.telefone.trim() ? form.telefone.trim() : null),
      });
    } catch (err: unknown) {
      const errData = (err as { response?: { data?: { mensagem?: string; inativo?: boolean } } })?.response?.data;
      if (errData?.inativo) {
        setDupInativoInfo({ mensagem: errData.mensagem ?? '' });
        return;
      }
      setErroInline(errData?.mensagem ?? 'Erro ao salvar fornecedor');
    } finally { setSaving(false); }
  };

  const inp = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500 transition-colors';
  const lbl = 'block text-xs text-gray-500 mb-1';

  return (
    <>
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-[60] p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-2xl max-h-[92vh] flex flex-col border border-gray-100">

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <Truck size={18} className="text-emerald-600" />
            Novo Fornecedor / Profissional
          </h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Documento */}
          <section>
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <BadgeCheck size={12} /> Documento (CPF ou CNPJ)
            </h4>
            <div className="flex gap-2 mb-3">
              {(['cpf','cnpj'] as TipoDoc[]).map(tipo => (
                <button key={tipo} type="button"
                  onClick={() => { setDocError(''); upd({ tipoDoc: tipo, cpf: '', cnpj: '' }); }}
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
                <input value={form.cpf} onChange={e => handleDoc(e.target.value)}
                  placeholder="000.000.000-00"
                  className={`${inp} ${docValido === false ? 'border-red-300' : docValido === true ? 'border-emerald-400' : ''}`} />
              ) : (
                <input value={form.cnpj} onChange={e => handleDoc(e.target.value)}
                  placeholder="00.000.000/0000-00"
                  className={`${inp} pr-9 ${docValido === false ? 'border-red-300' : docValido === true ? 'border-emerald-400' : ''}`} />
              )}
              {buscandoCNPJ && <Loader2 size={14} className="animate-spin text-emerald-600 absolute right-3 top-1/2 -translate-y-1/2" />}
            </div>
            {docError && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle size={11}/>{docError}</p>}
            {docValido === false && !docError && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle size={11}/>{form.tipoDoc.toUpperCase()} inválido</p>}
            {docValido === true  && <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1"><BadgeCheck size={11}/>{form.tipoDoc.toUpperCase()} válido</p>}
          </section>

          {/* Identificação */}
          <section>
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <UserIcon size={12} /> Identificação
            </h4>
            <div className="space-y-3">
              <div>
                <label className={lbl}>Nome / Razão Social *</label>
                <input value={form.nome} onChange={e => upd({ nome: e.target.value })}
                  placeholder="Nome do profissional ou empresa" className={inp} />
              </div>
              <div>
                <label className={lbl}>Tipo de Fornecedor *</label>
                <select
                  value={form.tipoFornecedor}
                  onChange={e => upd({
                    tipoFornecedor: e.target.value as TipoFornecedor,
                    // Especialidades só se aplicam a Veterinário — limpa ao trocar
                    ...(e.target.value !== 'Veterinário' ? { especialidadeIds: [] } : {}),
                  })}
                  className={inp}
                >
                  {TIPOS_FORNECEDOR.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              {form.tipoFornecedor === 'Veterinário' && (
                <div>
                  <label className={lbl}>Especialidade *</label>
                  <EspecialidadeSelector
                    variant="dropdown"
                    value={form.especialidadeIds}
                    onChange={ids => upd({ especialidadeIds: ids })}
                    especieIds={especiesEmpresa}
                    emptyText="A empresa ainda não configurou as espécies atendidas (Configurações)."
                  />
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>E-mail *</label>
                  <input type="email" value={form.email}
                    onChange={e => upd({ email: e.target.value })}
                    placeholder="email@exemplo.com" className={inp} />
                </div>
                <div>
                  <label className={lbl}>Telefone *</label>
                  <input value={form.telefone}
                    onChange={e => upd({ telefone: mascaraTel(e.target.value) })}
                    placeholder="(00) 00000-0000" className={inp} />
                </div>
              </div>
            </div>
          </section>

          {/* Endereço */}
          <section>
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <MapPin size={12} /> Endereço
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={lbl}>CEP</label>
                <div className="relative">
                  <input value={form.cep} placeholder="00000-000"
                    onChange={e => {
                      const v = mascaraCEP(e.target.value);
                      upd({ cep: v });
                      if (v.replace(/\D/g,'').length === 8) buscarCEP(v);
                    }}
                    className={`${inp} pr-8`} />
                  {buscandoCEP && <Loader2 size={12} className="animate-spin text-emerald-600 absolute right-3 top-1/2 -translate-y-1/2" />}
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className={lbl}>Endereço</label>
                <input value={form.endereco} onChange={e => upd({ endereco: e.target.value })}
                  placeholder="Rua, av., rodovia..." className={inp} />
              </div>
              <div>
                <label className={lbl}>Complemento</label>
                <input value={form.complemento} onChange={e => upd({ complemento: e.target.value })}
                  placeholder="Apto, sala..." className={inp} />
              </div>
              <div>
                <label className={lbl}>Bairro</label>
                <input value={form.bairro} onChange={e => upd({ bairro: e.target.value })} className={inp} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={lbl}>Cidade</label>
                  <input value={form.cidade} onChange={e => upd({ cidade: e.target.value })} className={inp} />
                </div>
                <div>
                  <label className={lbl}>UF</label>
                  <input value={form.estado}
                    onChange={e => upd({ estado: e.target.value.toUpperCase().slice(0,2) })}
                    placeholder="SP" maxLength={2} className={inp} />
                </div>
              </div>
            </div>
          </section>

        </div>

        <InlineError message={erroInline} className="mx-5 mt-3 flex-shrink-0" />

        <div className="flex gap-3 px-5 pb-5 pt-3 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose} disabled={saving}
            className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors">
            Cancelar
          </button>
          <button onClick={handleSalvar} disabled={saving}
            className="flex-1 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2">
            {saving && <Loader2 size={13} className="animate-spin" />}
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>

      </div>
    </div>

    {dupInativoInfo && (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[70] p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <AlertCircle size={22} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-gray-900 text-sm mb-1">Cadastro já existente (inativo)</p>
              <p className="text-sm text-gray-600">{dupInativoInfo.mensagem}</p>
              <p className="text-sm text-gray-500 mt-2">Deseja continuar e criar um novo cadastro mesmo assim?</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setDupInativoInfo(null)}
              className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors">
              Cancelar
            </button>
            <button onClick={() => { setDupInativoInfo(null); handleSalvar(true); }}
              className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-semibold transition-colors">
              Continuar mesmo assim
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
