// frontend/src/pages/CadastroPrestador.tsx
//
// Cadastro de PRESTADORES de serviço — catálogo PRÓPRIO e independente de
// Fornecedor (2026-08-14): mesma forma de tela (CRUD, documento, contato,
// tipo de serviço, endereço), mas tabela/rota/permissão próprias
// (tb_prestadores, /api/cadastro/prestadores, cadastro.prestador.*).
// Ver CLAUDE.md §5.

import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  Pencil, Search, Loader2, X, HardHat,
  ToggleLeft, ToggleRight, Building2, User as UserIcon,
  Phone, MapPin, BadgeCheck, AlertCircle, Wallet, Clock3, Plus, Trash2,
} from 'lucide-react';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import { usePermissoes } from '../hooks/usePermissoes';
import { useAuth } from '../contexts/AuthContext';
import { isValidEmail } from '../utils/validators';
import InlineError from '../components/InlineError';
import TipoServicoSelect from '../components/TipoServicoSelect';
import { formatDate } from '../utils/dateUtils';
import {
  LocalizacaoCombobox, HoraInput, TIPOS_PAGAMENTO,
  mascaraValorPagamento, valorPagamentoNumero, formatarValorSalvo,
} from '../components/UsuarioFormModal';

// Dias da semana (0=Dom … 6=Sáb) — mesma convenção de UsuarioFormModal.
const DIAS_SEMANA_PREST = [
  { v: 0, l: 'Dom' }, { v: 1, l: 'Seg' }, { v: 2, l: 'Ter' }, { v: 3, l: 'Qua' },
  { v: 4, l: 'Qui' }, { v: 5, l: 'Sex' }, { v: 6, l: 'Sáb' },
];

// ─── Constants ────────────────────────────────────────────────────────────────

// Ponto de partida do combobox "criável" (TipoServicoSelect) — o catálogo
// tenant-scoped (tb_catalogo_tipo_servico) cresce por uso a partir daqui.
const TIPOS_SERVICO_PADRAO = [
  'Cardiologista',
  'Dermatologista',
  'Ferrador',
  'Fisioterapeuta',
  'Quiroprata',
  'Radiologista',
  'Secretária',
  'Veterinário',
] as const;

type TipoDoc = 'cpf' | 'cnpj';

// Local de trabalho do Prestador — sem especialidade/tempo de consulta (Prestador não
// entra na Agenda) e sem herança de expediente da empresa: em branco = sem horário
// definido, nunca "vale o da empresa".
interface LocalTrabalhoPrestador {
  id:                 number;
  localizacaoId:      number;
  localizacao:        { id: number; nome: string } | null;
  diasTrabalho:       string | null;
  horaInicioTrabalho: string | null;
  horaFimTrabalho:    string | null;
}

interface LocalTrabalhoDraft {
  localizacaoId:      number;
  localizacaoNome:    string;
  diasTrabalho:       number[];
  horaInicioTrabalho: string;
  horaFimTrabalho:    string;
}

const RASCUNHO_LOCAL_PREST: LocalTrabalhoDraft = {
  localizacaoId: 0, localizacaoNome: '', diasTrabalho: [], horaInicioTrabalho: '', horaFimTrabalho: '',
};

function resumoLocalPrestador(l: LocalTrabalhoDraft): string {
  const dias = [...l.diasTrabalho].sort((a, b) => a - b)
    .map(d => DIAS_SEMANA_PREST.find(x => x.v === d)?.l ?? d).join(', ');
  const hora = l.horaInicioTrabalho && l.horaFimTrabalho
    ? `${l.horaInicioTrabalho}–${l.horaFimTrabalho}` : '';
  return [l.localizacaoNome, dias || null, hora || null].filter(Boolean).join(' · ');
}

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
function mascaraTelefone(v: string) {
  const n = v.replace(/\D/g,'').slice(0,11);
  return n.length <= 10
    ? n.replace(/(\d{2})(\d{4})(\d{0,4})/,'($1) $2-$3')
    : n.replace(/(\d{2})(\d{5})(\d{0,4})/,'($1) $2-$3');
}
function mascaraCEP(v: string) {
  return v.replace(/\D/g,'').slice(0,8).replace(/(\d{5})(\d{1,3})$/,'$1-$2');
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Prestador {
  id:             number;
  nome:           string;
  cpf:            string | null;
  cnpj:           string | null;
  telefone:       string | null;
  email:          string | null;
  tipoServico:    string;
  tipoEntrada:    string;
  cep:            string | null;
  endereco:       string | null;
  complemento:    string | null;
  bairro:         string | null;
  cidade:         string | null;
  estado:         string | null;
  ativo:          boolean;
  userId:         number | null;
  tipoPagamento:  'SALARIO' | 'COMISSAO' | null;
  formaPagamento: 'VALOR' | 'PERCENTUAL' | null;
  valorPagamento: number | null;
  acessoSistema:  boolean;
  locaisTrabalho: LocalTrabalhoPrestador[];
  createdAt:      string;
  // Trilha de ativação/inativação (quem fez, quando) — ver lib/cadastroAtivacao.js
  ativoEm?:        string | null;
  ativoPorNome?:   string | null;
  inativoEm?:      string | null;
  inativoPorNome?: string | null;
}

interface FormPrest {
  nome:        string;
  tipoDoc:     TipoDoc;
  cpf:         string;
  cnpj:        string;
  telefone:    string;
  email:       string;
  tipoServico: string;
  cep:         string;
  endereco:    string;
  complemento: string;
  bairro:      string;
  cidade:      string;
  estado:      string;
  tipoPagamento:  'SALARIO' | 'COMISSAO' | '';
  formaPagamento: 'VALOR' | 'PERCENTUAL';
  valorPagamento: string;
  acessoSistema:  boolean;
  locaisTrabalho: LocalTrabalhoDraft[];
}

const FORM_INICIAL: FormPrest = {
  nome: '', tipoDoc: 'cnpj', cpf: '', cnpj: '', telefone: '', email: '',
  tipoServico: '',
  cep: '', endereco: '', complemento: '', bairro: '', cidade: '', estado: '',
  // Pagamento nasce em branco (é acordo com a pessoa, sem padrão a chutar).
  // Acesso nasce DESMARCADO — diferente do Incluir Membro: aqui a maioria é externa
  // e não deve ganhar login sem decisão explícita do gestor.
  tipoPagamento: '', formaPagamento: 'VALOR', valorPagamento: '', acessoSistema: false,
  locaisTrabalho: [],
};

// ─── Modal de confirmação para duplicata inativa ──────────────────────────────

function ModalDuplicataInativa({
  mensagem, onConfirmar, onCancelar,
}: { mensagem: string; onConfirmar: () => void; onCancelar: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <AlertCircle size={22} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-gray-900 text-sm mb-1">Cadastro já existente (inativo)</p>
            <p className="text-sm text-gray-600">{mensagem}</p>
            <p className="text-sm text-gray-500 mt-2">Deseja continuar e criar um novo cadastro mesmo assim?</p>
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={onCancelar}
            className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors">
            Cancelar
          </button>
          <button onClick={onConfirmar}
            className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-semibold transition-colors">
            Continuar mesmo assim
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function ModalPrestador({
  editando, form, saving, erro, togglingAtivo,
  onFormChange, onSalvar, onClose, onToggleAtivo,
}: {
  editando:    Prestador | null;
  form:        FormPrest;
  saving:      boolean;
  /** Erro da ação do MODAL — exibido abaixo do rodapé, junto do botão clicado. */
  erro:        string | null;
  /** Alternar Ativo/Inativo é assíncrono e independente do Salvar do formulário. */
  togglingAtivo: boolean;
  onFormChange:(updates: Partial<FormPrest>) => void;
  onSalvar:    () => void;
  onClose:     () => void;
  onToggleAtivo:() => void;
}) {
  const [buscandoCNPJ, setBuscandoCNPJ] = useState(false);
  const [buscandoCEP,  setBuscandoCEP]  = useState(false);
  const [docError,     setDocError]     = useState('');
  const cnpjTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Repetidor de "Local de trabalho" (rascunho + lista em form.locaisTrabalho) ──
  const [rascunhoLocal,   setRascunhoLocal]   = useState<LocalTrabalhoDraft>(RASCUNHO_LOCAL_PREST);
  const [mostrarFormLocal, setMostrarFormLocal] = useState(false);
  const [editIndexLocal,  setEditIndexLocal]  = useState<number | null>(null);
  const [erroLocal,       setErroLocal]       = useState('');

  const abrirNovoLocal = () => { setRascunhoLocal(RASCUNHO_LOCAL_PREST); setEditIndexLocal(null); setErroLocal(''); setMostrarFormLocal(true); };
  const editarLocal = (idx: number) => { setRascunhoLocal(form.locaisTrabalho[idx]); setEditIndexLocal(idx); setErroLocal(''); setMostrarFormLocal(true); };
  const removerLocal = (idx: number) => onFormChange({ locaisTrabalho: form.locaisTrabalho.filter((_, i) => i !== idx) });
  const confirmarLocal = () => {
    if (!rascunhoLocal.localizacaoId) { setErroLocal('Selecione um local'); return; }
    const lista = editIndexLocal === null
      ? [...form.locaisTrabalho, rascunhoLocal]
      : form.locaisTrabalho.map((l, i) => i === editIndexLocal ? rascunhoLocal : l);
    onFormChange({ locaisTrabalho: lista });
    setMostrarFormLocal(false);
    setErroLocal('');
  };

  const docNums  = (form.tipoDoc === 'cpf' ? form.cpf : form.cnpj).replace(/\D/g,'');
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
      const nums = raw.replace(/\D/g,'');
      if (nums.length === 14 && validarCNPJ(masked)) {
        if (cnpjTimer.current) clearTimeout(cnpjTimer.current);
        cnpjTimer.current = setTimeout(() => buscarCNPJ(nums), 300);
      } else if (nums.length === 14) setDocError('CNPJ inválido');
    }
  };

  const handleTipoDoc = (tipo: TipoDoc) => {
    setDocError('');
    onFormChange({ tipoDoc: tipo, cpf: '', cnpj: '' });
  };

  const buscarCNPJ = async (nums: string) => {
    setBuscandoCNPJ(true);
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${nums}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      onFormChange({
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
      if (!data.erro) onFormChange({
        endereco: data.logradouro ?? '',
        bairro:   data.bairro     ?? '',
        cidade:   data.localidade ?? '',
        estado:   data.uf         ?? '',
      });
    } catch { /* silencia */ }
    finally { setBuscandoCEP(false); }
  };

  // Mesmo padrão da tela de Tratador/Localização: rounded-2xl + anel emerald no foco.
  const inputCls = 'w-full border border-gray-200 rounded-2xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-400 transition-colors';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl shadow-xl w-full sm:max-w-2xl max-h-[90dvh] flex flex-col border border-gray-100">

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <HardHat size={18} className="text-emerald-600" />
            {editando ? 'Editar Prestador' : 'Novo Prestador'}
          </h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* ── Documento (primeiro — CNPJ preenche os demais campos via BrasilAPI) ── */}
          <section>
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <BadgeCheck size={12} /> Documento (CPF ou CNPJ)
            </h4>
            <div className="flex gap-2 mb-3">
              {(['cpf','cnpj'] as TipoDoc[]).map(tipo => (
                <button key={tipo} onClick={() => handleTipoDoc(tipo)}
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
                  className={`${inputCls} ${docValido === false ? 'border-red-300' : docValido === true ? 'border-emerald-400' : ''}`} />
              ) : (
                <input value={form.cnpj} onChange={e => handleDoc(e.target.value)}
                  placeholder="00.000.000/0000-00"
                  className={`${inputCls} pr-9 ${docValido === false ? 'border-red-300' : docValido === true ? 'border-emerald-400' : ''}`} />
              )}
              {buscandoCNPJ && <Loader2 size={14} className="animate-spin text-emerald-600 absolute right-3 top-1/2 -translate-y-1/2" />}
            </div>
            {docError && (
              <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle size={11} />{docError}</p>
            )}
            {docValido === false && !docError && (
              <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle size={11} />{form.tipoDoc.toUpperCase()} inválido</p>
            )}
            {docValido === true && (
              <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1"><BadgeCheck size={11} />{form.tipoDoc.toUpperCase()} válido</p>
            )}
          </section>

          {/* ── Identificação ── */}
          <section>
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <UserIcon size={12} /> Identificação
            </h4>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Nome / Razão Social *</label>
                <input value={form.nome} onChange={e => onFormChange({ nome: e.target.value })}
                  placeholder="Nome do profissional ou empresa" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Tipo de Serviço *</label>
                <TipoServicoSelect
                  categoria="PRESTADOR"
                  value={form.tipoServico}
                  onChange={tipoServico => onFormChange({ tipoServico })}
                  defaults={TIPOS_SERVICO_PADRAO}
                  className={inputCls}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">E-mail</label>
                  <input type="email" value={form.email}
                    onChange={e => onFormChange({ email: e.target.value })}
                    placeholder="email@exemplo.com" className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Telefone *</label>
                  <input value={form.telefone}
                    onChange={e => onFormChange({ telefone: mascaraTelefone(e.target.value) })}
                    placeholder="(00) 00000-0000" className={inputCls} />
                </div>
              </div>
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
                    onChange={e => {
                      const v = mascaraCEP(e.target.value);
                      onFormChange({ cep: v });
                      if (v.replace(/\D/g,'').length === 8) buscarCEP(v);
                    }}
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
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Cidade</label>
                  <input value={form.cidade} onChange={e => onFormChange({ cidade: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">UF</label>
                  <input value={form.estado}
                    onChange={e => onFormChange({ estado: e.target.value.toUpperCase().slice(0,2) })}
                    placeholder="SP" maxLength={2} className={inputCls} />
                </div>
              </div>
            </div>
          </section>

          {/* ── Local de trabalho ── sem especialidade/tempo de consulta (Prestador
              não entra na Agenda) e sem herança do expediente da empresa: em branco
              é só "sem horário definido". */}
          <section>
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <Clock3 size={12} /> Local de trabalho
            </h4>
            {form.locaisTrabalho.length > 0 && (
              <div className="space-y-1.5 mb-2">
                {form.locaisTrabalho.map((l, idx) => (
                  <div key={idx} className="flex items-center justify-between gap-2 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
                    <span className="text-xs text-gray-700 truncate">{resumoLocalPrestador(l)}</span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button type="button" onClick={() => editarLocal(idx)}
                        className="p-1 text-emerald-500 hover:text-emerald-700 transition-colors"><Pencil size={13} /></button>
                      <button type="button" onClick={() => removerLocal(idx)}
                        className="p-1 text-red-400 hover:text-red-600 transition-colors"><Trash2 size={13} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!mostrarFormLocal ? (
              <button type="button" onClick={abrirNovoLocal}
                className="flex items-center gap-1.5 px-3 py-2 border border-dashed border-gray-300 rounded-xl text-xs font-semibold text-gray-500 hover:border-emerald-400 hover:text-emerald-600 transition-colors">
                <Plus size={13} /> Adicionar local de trabalho
              </button>
            ) : (
              <div className="border border-gray-200 rounded-xl p-3 space-y-2.5 bg-gray-50">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Local</label>
                  <LocalizacaoCombobox
                    value={rascunhoLocal.localizacaoId || null}
                    nome={rascunhoLocal.localizacaoNome}
                    onSelect={(id, nome) => setRascunhoLocal(r => ({ ...r, localizacaoId: id, localizacaoNome: nome }))}
                  />
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="w-24">
                    <label className="block text-xs text-gray-500 mb-1">Entra às</label>
                    <HoraInput value={rascunhoLocal.horaInicioTrabalho}
                      onChange={v => setRascunhoLocal(r => ({ ...r, horaInicioTrabalho: v }))}
                      className={inputCls} />
                  </div>
                  <div className="w-24">
                    <label className="block text-xs text-gray-500 mb-1">Sai às</label>
                    <HoraInput value={rascunhoLocal.horaFimTrabalho}
                      onChange={v => setRascunhoLocal(r => ({ ...r, horaFimTrabalho: v }))}
                      className={inputCls} />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {DIAS_SEMANA_PREST.map(d => {
                      const on = rascunhoLocal.diasTrabalho.includes(d.v);
                      return (
                        <button key={d.v} type="button"
                          onClick={() => setRascunhoLocal(r => ({
                            ...r,
                            diasTrabalho: on ? r.diasTrabalho.filter(x => x !== d.v) : [...r.diasTrabalho, d.v].sort((a, b) => a - b),
                          }))}
                          className={`px-2 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                            on ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                          }`}>
                          {d.l}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {erroLocal && <p className="text-xs text-red-500">{erroLocal}</p>}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => { setMostrarFormLocal(false); setErroLocal(''); }}
                    className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-100 transition-colors">
                    Cancelar
                  </button>
                  <button type="button" onClick={confirmarLocal}
                    className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold transition-colors">
                    {editIndexLocal === null ? 'Adicionar' : 'Salvar'}
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* ── Forma de Pagamento ── opcional: prestador externo pode não ter
              remuneração fixa com a clínica. Mesma UI/máscara do Incluir Membro. */}
          <section>
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <Wallet size={12} /> Forma de Pagamento <span className="normal-case font-medium text-gray-400">(opcional)</span>
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Tipo de pagamento</label>
                <select value={form.tipoPagamento}
                  onChange={e => {
                    const tipo = e.target.value as 'SALARIO' | 'COMISSAO' | '';
                    const forma = tipo === 'COMISSAO' ? 'PERCENTUAL' : tipo === 'SALARIO' ? 'VALOR' : form.formaPagamento;
                    onFormChange({ tipoPagamento: tipo, formaPagamento: forma, valorPagamento: mascaraValorPagamento(form.valorPagamento, forma) });
                  }}
                  className={inputCls}>
                  <option value="">Selecionar…</option>
                  {TIPOS_PAGAMENTO.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Valor</label>
                <div className="flex items-stretch border border-gray-200 rounded-xl overflow-hidden focus-within:border-emerald-500">
                  <span className="px-3 flex items-center text-sm text-gray-400 bg-gray-50 border-r border-gray-200">
                    {form.formaPagamento === 'PERCENTUAL' ? '%' : 'R$'}
                  </span>
                  <input type="text" inputMode="numeric"
                    value={form.valorPagamento}
                    onChange={e => onFormChange({ valorPagamento: mascaraValorPagamento(e.target.value, form.formaPagamento) })}
                    placeholder={form.formaPagamento === 'PERCENTUAL' ? '00,00' : '000.000,00'}
                    className="flex-1 min-w-0 px-3 py-2.5 text-sm text-gray-900 focus:outline-none" />
                  <select value={form.formaPagamento}
                    onChange={e => {
                      const forma = e.target.value as 'VALOR' | 'PERCENTUAL';
                      onFormChange({ formaPagamento: forma, valorPagamento: mascaraValorPagamento(form.valorPagamento, forma) });
                    }}
                    className="px-2 text-sm text-gray-600 bg-gray-50 border-l border-gray-200 focus:outline-none cursor-pointer">
                    <option value="VALOR">R$</option>
                    <option value="PERCENTUAL">%</option>
                  </select>
                </div>
              </div>
            </div>
          </section>

          {/* ── Acesso ao sistema ── login SEM Membro de Equipe: entra, mas sem RBAC
              não vê nenhuma tela até ser incluído na equipe. */}
          <section>
            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input type="checkbox"
                checked={form.acessoSistema}
                onChange={e => onFormChange({ acessoSistema: e.target.checked })}
                className="w-4 h-4 mt-0.5 rounded border-gray-300 accent-emerald-600 cursor-pointer" />
              <span className="text-sm text-gray-700">
                Terá acesso ao sistema
              </span>
            </label>
          </section>

          {/* ── Ativo ── só na edição (registro novo já nasce ativo). Reusa o MESMO
              endpoint do toggle da listagem — não duplica a mutação. */}
          {editando && (
            <section className="flex items-center justify-between bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5">
              <span className="text-sm text-gray-700">
                Status: <span className={editando.ativo ? 'text-emerald-700 font-semibold' : 'text-red-600 font-semibold'}>
                  {editando.ativo ? 'Ativo' : 'Inativo'}
                </span>
              </span>
              <button type="button" onClick={onToggleAtivo} disabled={togglingAtivo}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-white disabled:opacity-50 transition-colors">
                {togglingAtivo
                  ? <Loader2 size={12} className="animate-spin" />
                  : editando.ativo ? <ToggleRight size={13} className="text-emerald-600" /> : <ToggleLeft size={13} />}
                {editando.ativo ? 'Inativar' : 'Ativar'}
              </button>
            </section>
          )}

        </div>

        {/* Rodapé no padrão da aplicação: ações à direita, tamanho padrão. */}
        <div className="flex items-center justify-end gap-3 px-5 pb-5 pt-3 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-semibold hover:bg-gray-50 disabled:opacity-50 transition-colors">
            Cancelar
          </button>
          <button onClick={onSalvar} disabled={saving}
            className="px-6 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-2">
            {saving && <Loader2 size={13} className="animate-spin" />}
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>

        {/* Erro ABAIXO do botão que o disparou (CLAUDE.md §6) — fora do corpo
            rolável, então nasce sempre à vista. */}
        {erro && (
          <div className="px-5 pb-5 flex-shrink-0">
            <InlineError message={erro} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function CadastroPrestador() {
  const { podeExecutar, loading: loadingPerms } = usePermissoes();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const podeCriar  = isAdmin || podeExecutar('cadastro.prestador.criar');
  const podeEditar = isAdmin || podeExecutar('cadastro.prestador.editar');
  const podeAtivar = isAdmin || podeExecutar('cadastro.prestador.ativar');

  const msgSemPermissao = (acao: string) =>
    `Sem permissão para ${acao}. Verifique com o responsável da equipe.`;

  // Erro fica na SUPERFÍCIE da ação que o disparou (CLAUDE.md §6).
  const [erroInline,      setErroInline]      = useState<string | null>(null);
  const [erroModal,       setErroModal]       = useState<string | null>(null);
  const [erroLista,       setErroLista]       = useState<string | null>(null);
  const [prestadores,     setPrestadores]     = useState<Prestador[]>([]);
  const [loading,         setLoading]         = useState(true);
  const [busca,           setBusca]           = useState('');
  const [filtroAtivo,     setFiltroAtivo]     = useState<'all' | 'ativo' | 'inativo'>('ativo');
  const [showModal,       setShowModal]       = useState(false);
  const [editando,        setEditando]        = useState<Prestador | null>(null);
  const [form,            setForm]            = useState<FormPrest>(FORM_INICIAL);
  const [saving,          setSaving]          = useState(false);
  const [dupInativoInfo,  setDupInativoInfo]  = useState<{ mensagem: string } | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (busca.trim()) params.set('busca', busca.trim());
      params.set('ativo', filtroAtivo === 'all' ? 'all' : filtroAtivo === 'ativo' ? 'true' : 'false');
      const res = await api.get(`/cadastro/prestadores?${params}`);
      if (!res.data) return;
      setPrestadores(res.data.dados ?? []);
    } catch { setErroInline('Erro ao carregar prestadores'); }
    finally { setLoading(false); }
  }, [busca, filtroAtivo]);

  useEffect(() => { if (!loadingPerms) carregar(); }, [carregar, loadingPerms]);

  const abrirNovo = () => { setEditando(null); setForm(FORM_INICIAL); setErroModal(null); setShowModal(true); };

  const abrirEdicao = (p: Prestador) => {
    setErroModal(null);
    setEditando(p);
    setForm({
      nome:        p.nome,
      tipoDoc:     p.cnpj ? 'cnpj' : 'cpf',
      cpf:         p.cpf  ? mascaraCPF(p.cpf.replace(/\D/g,''))   : '',
      cnpj:        p.cnpj ? mascaraCNPJ(p.cnpj.replace(/\D/g,'')) : '',
      telefone:    p.telefone ? mascaraTelefone(p.telefone.replace(/\D/g,'')) : '',
      email:       p.email ?? '',
      tipoServico: p.tipoServico?.trim() ?? '',
      cep:         p.cep         ? mascaraCEP(p.cep.replace(/\D/g,'')) : '',
      endereco:    p.endereco    ?? '',
      complemento: p.complemento ?? '',
      bairro:      p.bairro      ?? '',
      cidade:      p.cidade      ?? '',
      estado:      p.estado      ?? '',
      tipoPagamento:  p.tipoPagamento  ?? '',
      formaPagamento: p.formaPagamento ?? 'VALOR',
      valorPagamento: mascaraValorPagamento(formatarValorSalvo(p.valorPagamento), p.formaPagamento ?? 'VALOR'),
      acessoSistema:  p.acessoSistema === true,
      locaisTrabalho: p.locaisTrabalho.map(l => ({
        localizacaoId:      l.localizacaoId,
        localizacaoNome:    l.localizacao?.nome ?? '',
        diasTrabalho:       l.diasTrabalho ? l.diasTrabalho.split(',').map(Number).filter(Number.isInteger) : [],
        horaInicioTrabalho: l.horaInicioTrabalho ?? '',
        horaFimTrabalho:    l.horaFimTrabalho    ?? '',
      })),
    });
    setShowModal(true);
  };

  const fecharModal = () => { setShowModal(false); setEditando(null); setForm(FORM_INICIAL); setErroModal(null); };
  const handleFormChange = (updates: Partial<FormPrest>) => setForm(prev => ({ ...prev, ...updates }));

  const handleSalvar = async (force = false) => {
    setErroModal(null);
    if (editando && editando.tipoEntrada === 'SYSTEM' && !isAdmin) { setErroModal(msgSemPermissao('alterar prestador do catálogo global')); return; }
    if (editando && !podeEditar) { setErroModal(msgSemPermissao('alterar prestador')); return; }
    if (!editando && !podeCriar) { setErroModal(msgSemPermissao('criar prestador')); return; }
    if (!form.nome.trim())       { setErroModal('Nome é obrigatório'); return; }
    if (!form.tipoServico)       { setErroModal('Selecione o tipo de serviço'); return; }
    if (form.email.trim() && !isValidEmail(form.email)) { setErroModal('Informe um e-mail válido'); return; }
    if (form.acessoSistema && !form.email.trim()) { setErroModal('E-mail é obrigatório para conceder acesso ao sistema'); return; }
    if (!form.telefone.trim())   { setErroModal('Telefone é obrigatório'); return; }
    const docCPF  = form.cpf.replace(/\D/g,'');
    const docCNPJ = form.cnpj.replace(/\D/g,'');
    if (form.tipoDoc === 'cpf'  && docCPF  && !validarCPF(form.cpf)) {
      setErroModal('CPF inválido'); return;
    }
    if (form.tipoDoc === 'cnpj' && docCNPJ && !validarCNPJ(form.cnpj)) {
      setErroModal('CNPJ inválido'); return;
    }

    setSaving(true);
    const payload = {
      nome:        form.nome,
      cpf:         form.tipoDoc === 'cpf'  && docCPF  ? form.cpf  : null,
      cnpj:        form.tipoDoc === 'cnpj' && docCNPJ ? form.cnpj : null,
      telefone:    form.telefone,
      email:       form.email.trim() ? form.email.trim().toLowerCase() : null,
      tipoServico: form.tipoServico,
      cep:         form.cep         || null,
      endereco:    form.endereco    || null,
      complemento: form.complemento || null,
      bairro:      form.bairro      || null,
      cidade:      form.cidade      || null,
      estado:      form.estado      || null,
      tipoPagamento:  form.tipoPagamento  || undefined,
      formaPagamento: form.tipoPagamento  ? form.formaPagamento : undefined,
      valorPagamento: form.tipoPagamento  ? String(valorPagamentoNumero(form.valorPagamento)) : undefined,
      acessoSistema:  form.acessoSistema,
      locaisTrabalho: form.locaisTrabalho.map(l => ({
        localizacaoId:      l.localizacaoId,
        diasTrabalho:       l.diasTrabalho,
        horaInicioTrabalho: l.horaInicioTrabalho || null,
        horaFimTrabalho:    l.horaFimTrabalho    || null,
      })),
      ...(force ? { force: true } : {}),
    };

    try {
      if (editando) {
        await api.put(`/cadastro/prestadores/${editando.id}`, payload);
        toast.success('Prestador atualizado');
      } else {
        await api.post('/cadastro/prestadores', payload);
        toast.success('Prestador cadastrado');
      }
      fecharModal();
      setBusca('');
      carregar();
    } catch (err: unknown) {
      const errData = (err as { response?: { data?: { mensagem?: string; inativo?: boolean } } })?.response?.data;
      if (errData?.inativo) {
        setDupInativoInfo({ mensagem: errData.mensagem ?? '' });
        return;
      }
      setErroModal(errData?.mensagem ?? 'Erro ao salvar');
    } finally { setSaving(false); }
  };

  const handleToggle = async (p: Prestador) => {
    setErroLista(null);
    if (p.tipoEntrada === 'SYSTEM' && !isAdmin) { setErroLista(msgSemPermissao('alternar status de prestador do catálogo global')); return; }
    if (!podeAtivar) { setErroLista(msgSemPermissao('alternar status do prestador')); return; }
    try {
      await api.patch(`/cadastro/prestadores/${p.id}/toggle`);
      toast.success(p.ativo ? 'Prestador inativado' : 'Prestador ativado');
      carregar();
    } catch { setErroLista('Erro ao alternar status'); }
  };

  // Ativo/Inativo DENTRO do modal — mesmo endpoint do toggle da listagem, sem
  // duplicar a mutação. Atualiza `editando` no lugar (o modal continua aberto).
  const [togglingAtivo, setTogglingAtivo] = useState(false);
  const handleToggleAtivoModal = async () => {
    if (!editando) return;
    setErroModal(null);
    if (editando.tipoEntrada === 'SYSTEM' && !isAdmin) { setErroModal(msgSemPermissao('alternar status de prestador do catálogo global')); return; }
    if (!podeAtivar) { setErroModal(msgSemPermissao('alternar status do prestador')); return; }
    setTogglingAtivo(true);
    try {
      const res = await api.patch(`/cadastro/prestadores/${editando.id}/toggle`);
      const atualizado = res.data.dados as Prestador;
      setEditando(prev => prev ? { ...prev, ativo: atualizado.ativo } : prev);
      toast.success(atualizado.ativo ? 'Prestador ativado' : 'Prestador inativado');
      carregar();
    } catch { setErroModal('Erro ao alternar status'); }
    finally { setTogglingAtivo(false); }
  };

  if (loadingPerms) return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full" />
    </div>
  );

  if (!podeExecutar('cadastro.prestador.ler') && !isAdmin) return (
    <PageContainer maxWidth="7xl">
      <div className="text-center py-16">
        <h2 className="text-lg font-semibold text-gray-700 mb-2">Acesso não autorizado</h2>
        <p className="text-sm text-gray-500">Você não tem permissão para visualizar prestadores.</p>
      </div>
    </PageContainer>
  );

  return (
    <PageContainer maxWidth="7xl">
      {/* Header — mesma linha em qualquer largura (padrão do resto da aplicação):
          título à esquerda, botão pequeno à direita. */}
      <BotaoVoltar />

      <InlineError message={erroInline} className="mt-3" />

      <div className="flex items-center justify-between gap-3 mt-2 mb-4 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <HardHat size={24} className="text-emerald-600" /> Prestadores
        </h1>
        {podeCriar && (
          <button onClick={abrirNovo}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-2xl shadow-sm transition-colors">
            Novo Cadastro
          </button>
        )}
      </div>

      {/* Busca + Filtro */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input type="text" placeholder="Buscar por nome, CPF, CNPJ, telefone..."
            value={busca} onChange={e => setBusca(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 bg-white transition-colors" />
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

      <InlineError message={erroLista} className="mb-3" />

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-emerald-600" />
        </div>
      ) : prestadores.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <HardHat size={40} className="mb-3 text-gray-200" />
          <p className="text-sm text-gray-400">Nenhum prestador encontrado</p>
        </div>
      ) : (
        <>
          {/* Mobile */}
          <div className="md:hidden space-y-3">
            {prestadores.map(p => (
              <div key={p.id} className={`bg-white rounded-2xl border p-4 shadow-sm ${!p.ativo ? 'opacity-60' : 'border-gray-100'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{p.nome}</p>
                    {p.telefone && (
                      <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                        <Phone size={10} />{p.telefone}
                      </p>
                    )}
                    {p.email && (
                      <p className="text-xs text-gray-500 mt-0.5 truncate">{p.email}</p>
                    )}
                    {p.cidade && (
                      <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                        <MapPin size={10} />{p.cidade}{p.estado ? ` — ${p.estado}` : ''}
                      </p>
                    )}
                    <p className="text-xs text-gray-400 mt-0.5">{p.cnpj ?? p.cpf ?? '—'}</p>
                    {p.tipoServico && (
                      <span className="inline-block text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium mt-1">
                        {p.tipoServico}
                      </span>
                    )}
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${p.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                    {p.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                </div>
                {filtroAtivo === 'ativo' && (
                  <p className="text-[11px] text-gray-400 mt-1">
                    Criado em {formatDate(p.createdAt)}
                    {p.ativoEm ? ` · Ativado em ${formatDate(p.ativoEm)}${p.ativoPorNome ? ` por ${p.ativoPorNome}` : ''}` : ''}
                  </p>
                )}
                {filtroAtivo === 'inativo' && (
                  <p className="text-[11px] text-gray-400 mt-1">
                    Inativado em {formatDate(p.inativoEm)}
                    {p.inativoPorNome ? ` por ${p.inativoPorNome}` : ''}
                  </p>
                )}
                {(p.tipoEntrada !== 'SYSTEM' || isAdmin) && (podeEditar || podeAtivar) && (
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-50">
                    {podeEditar && (
                      <button onClick={() => abrirEdicao(p)}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 border border-emerald-200 rounded-lg text-xs text-emerald-600 hover:bg-emerald-50 transition-colors">
                        <Pencil size={11} /> Editar
                      </button>
                    )}
                    {podeAtivar && (
                      <button onClick={() => handleToggle(p)}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 border border-blue-200 rounded-lg text-xs text-blue-600 hover:bg-blue-50 transition-colors">
                        {p.ativo ? <ToggleRight size={11} className="text-emerald-600" /> : <ToggleLeft size={11} />}
                        {p.ativo ? 'Inativar' : 'Ativar'}
                      </button>
                    )}
                  </div>
                )}
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
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Tipo de Serviço</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  {filtroAtivo === 'ativo' && (
                    <>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Criado em</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Ativado em</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Ativado por</th>
                    </>
                  )}
                  {filtroAtivo === 'inativo' && (
                    <>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Inativado em</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Inativado por</th>
                    </>
                  )}
                  {(podeEditar || podeAtivar) && <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Ações</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {prestadores.map(p => (
                  <tr key={p.id} className={`hover:bg-gray-50 transition-colors ${!p.ativo ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{p.nome}</p>
                      {p.email && <p className="text-xs text-gray-400 truncate">{p.email}</p>}
                      {p.cidade && (
                        <p className="text-xs text-gray-400 flex items-center gap-0.5">
                          <MapPin size={9} />{p.cidade}{p.estado ? ` — ${p.estado}` : ''}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap text-xs">
                      {p.cnpj ?? p.cpf ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap text-xs">
                      {p.telefone
                        ? <span className="flex items-center gap-1"><Phone size={10} />{p.telefone}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {p.tipoServico ? (
                        <span className="text-[11px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">
                          {p.tipoServico}
                        </span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${p.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                        {p.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    {filtroAtivo === 'ativo' && (
                      <>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-600">{formatDate(p.createdAt)}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-600">{formatDate(p.ativoEm)}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-600">{p.ativoPorNome ?? '—'}</td>
                      </>
                    )}
                    {filtroAtivo === 'inativo' && (
                      <>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-600">{formatDate(p.inativoEm)}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-600">{p.inativoPorNome ?? '—'}</td>
                      </>
                    )}
                    {(podeEditar || podeAtivar) && (
                      <td className="px-4 py-3">
                        {p.tipoEntrada === 'SYSTEM' && !isAdmin ? (
                          <span className="text-xs text-gray-300 italic block text-right">Catálogo global</span>
                        ) : (
                          <div className="flex items-center justify-end gap-1">
                            {podeEditar && (
                              <button onClick={() => abrirEdicao(p)} title="Editar"
                                className="p-1.5 text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors">
                                <Pencil size={14} />
                              </button>
                            )}
                            {podeAtivar && (
                              <button onClick={() => handleToggle(p)} title={p.ativo ? 'Inativar' : 'Ativar'}
                                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">
                                {p.ativo ? <ToggleRight size={14} className="text-emerald-600" /> : <ToggleLeft size={14} />}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showModal && (
        <ModalPrestador
          editando={editando}
          form={form}
          saving={saving}
          erro={erroModal}
          togglingAtivo={togglingAtivo}
          onFormChange={handleFormChange}
          onSalvar={handleSalvar}
          onClose={fecharModal}
          onToggleAtivo={handleToggleAtivoModal}
        />
      )}

      {dupInativoInfo && (
        <ModalDuplicataInativa
          mensagem={dupInativoInfo.mensagem}
          onConfirmar={() => { setDupInativoInfo(null); handleSalvar(true); }}
          onCancelar={() => setDupInativoInfo(null)}
        />
      )}
    </PageContainer>
  );
}
