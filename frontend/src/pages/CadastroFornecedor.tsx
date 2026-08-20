// frontend/src/pages/CadastroFornecedor.tsx

import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  Pencil, Search, Loader2, X, Truck,
  ToggleLeft, ToggleRight, Building2, User as UserIcon,
  Phone, MapPin, BadgeCheck, AlertCircle,
} from 'lucide-react';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import { usePermissoes } from '../hooks/usePermissoes';
import { useAuth } from '../contexts/AuthContext';
import { isValidEmail } from '../utils/validators';
import InlineError from '../components/InlineError';
import TipoServicoSelect from '../components/TipoServicoSelect';
import ModalJustificativa from '../components/ModalJustificativa';
import JustificativaCancelamento from '../components/JustificativaCancelamento';
import { formatDate } from '../utils/dateUtils';

// ─── Constants ────────────────────────────────────────────────────────────────

// Tipo de fornecedor — "Veterinário" SAIU daqui (2026-08-25): virou cargo de
// equipe (Incluir Membro), não fornecedor contratado. A lista agora é só o
// ponto de partida do combobox "criável" (TipoServicoSelect) — o catálogo
// tenant-scoped (tb_catalogo_tipo_servico) cresce por uso, ver CLAUDE.md.
const TIPOS_FORNECEDOR_PADRAO = [
  'Farmácia',
  'Laboratório',
] as const;
type TipoDoc = 'cpf' | 'cnpj';

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

interface Fornecedor {
  id:          number;
  nome:        string;
  cpf:         string | null;
  cnpj:        string | null;
  telefone:    string | null;
  email:       string | null;
  tipoServico: string;
  tipoEntrada: string;
  cep:         string | null;
  endereco:    string | null;
  complemento: string | null;
  bairro:      string | null;
  cidade:      string | null;
  estado:      string | null;
  ativo:       boolean;
  createdAt:   string;
  // Trilha de ativação/inativação (quem fez, quando) — ver lib/cadastroAtivacao.js
  ativoEm?:        string | null;
  ativoPorNome?:   string | null;
  inativoEm?:      string | null;
  inativoPorNome?: string | null;
  inativoMotivo?:  string | null;
}

interface FormForn {
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
}

const FORM_INICIAL: FormForn = {
  nome: '', tipoDoc: 'cnpj', cpf: '', cnpj: '', telefone: '', email: '',
  tipoServico: '',
  cep: '', endereco: '', complemento: '', bairro: '', cidade: '', estado: '',
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

function ModalFornecedor({
  editando, form, saving, erro,
  onFormChange, onSalvar, onClose,
}: {
  editando:    Fornecedor | null;
  form:        FormForn;
  saving:      boolean;
  /** Erro da ação do MODAL — exibido abaixo do rodapé, junto do botão clicado. */
  erro:        string | null;
  onFormChange:(updates: Partial<FormForn>) => void;
  onSalvar:    () => void;
  onClose:     () => void;
}) {
  const [buscandoCNPJ, setBuscandoCNPJ] = useState(false);
  const [buscandoCEP,  setBuscandoCEP]  = useState(false);
  const [docError,     setDocError]     = useState('');
  const cnpjTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Clears both doc values AND the local error state when switching doc type
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
      {/* `dvh` (viewport dinâmico), não `vh`: no mobile, `92vh` fica preso à altura
          ANTES do teclado abrir — com o campo em foco, o rodapé (Salvar) e o fim do
          formulário ficavam atrás do teclado e o scroll não alcançava mais nada.
          `rounded-3xl` em toda largura — mesmo padrão de Tratador/Localização. */}
      <div className="bg-white rounded-3xl shadow-xl w-full sm:max-w-2xl max-h-[92dvh] flex flex-col border border-gray-100">

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <Truck size={18} className="text-emerald-600" />
            {editando ? 'Editar Fornecedor / Profissional' : 'Novo Fornecedor / Profissional'}
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
                <label className="block text-xs text-gray-500 mb-1">Tipo de fornecedor *</label>
                <TipoServicoSelect
                  categoria="FORNECEDOR"
                  value={form.tipoServico}
                  onChange={tipoServico => onFormChange({ tipoServico })}
                  defaults={TIPOS_FORNECEDOR_PADRAO}
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

        </div>

        {/* Rodapé no padrão da aplicação: ações à DIREITA e no tamanho padrão
            (`px-4/px-6 py-2.5`). Antes eram dois botões `flex-1`, ocupando a largura
            inteira do modal — o Cancelar ficava do mesmo tamanho visual do Salvar. */}
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

        {/* Erro ABAIXO do botão que o disparou — nunca na página atrás do overlay,
            onde ficava até agora (o `InlineError` do topo era invisível com o modal
            aberto: o usuário clicava em Salvar e nada parecia acontecer).
            Fica FORA do corpo rolável e é `flex-shrink-0`, então nasce sempre à vista —
            não precisa de `scrollIntoView` como nos formulários que rolam. */}
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

export default function CadastroFornecedor() {
  const location                                = useLocation();
  const { podeExecutar, loading: loadingPerms } = usePermissoes();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const podeCriar  = isAdmin || podeExecutar('cadastro.fornecedor.criar');
  const podeEditar = isAdmin || podeExecutar('cadastro.fornecedor.editar');
  const podeAtivar = isAdmin || podeExecutar('cadastro.fornecedor.ativar');

  const msgSemPermissao = (acao: string) =>
    `Sem permissão para ${acao}. Verifique com o responsável da equipe.`;

  // Erro fica na SUPERFÍCIE da ação que o disparou (CLAUDE.md §6). Três estados
  // porque a tela tem três lugares de onde se clica:
  //   erroInline → CARGA da tela (não veio de clique nenhum) → topo
  //   erroModal  → validação e falha do Salvar → abaixo do rodapé DO MODAL
  //   erroLista  → ações da linha (editar/ativar) → junto da lista
  // Um estado só mandava tudo para o topo da página — atrás do overlay do modal.
  const [erroInline,      setErroInline]      = useState<string | null>(null);
  const [erroModal,       setErroModal]       = useState<string | null>(null);
  const [erroLista,       setErroLista]       = useState<string | null>(null);
  const [fornecedores,    setFornecedores]    = useState<Fornecedor[]>([]);
  const [loading,         setLoading]         = useState(true);
  const [busca,           setBusca]           = useState('');
  const [filtroAtivo,     setFiltroAtivo]     = useState<'all' | 'ativo' | 'inativo'>('ativo');
  const [showModal,       setShowModal]       = useState(false);
  const [editando,        setEditando]        = useState<Fornecedor | null>(null);
  const [form,            setForm]            = useState<FormForn>(FORM_INICIAL);
  const [saving,          setSaving]          = useState(false);
  const [dupInativoInfo,  setDupInativoInfo]  = useState<{ mensagem: string } | null>(null);
  // Fornecedor em vias de ser INATIVADO — pede justificativa antes do PATCH
  // (ativar continua direto, sem modal).
  const [inativando,      setInativando]      = useState<Fornecedor | null>(null);
  const [processandoToggle, setProcessandoToggle] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (busca.trim()) params.set('busca', busca.trim());
      params.set('ativo', filtroAtivo === 'all' ? 'all' : filtroAtivo === 'ativo' ? 'true' : 'false');
      const res = await api.get(`/cadastro/fornecedores?${params}`);
      if (!res.data) return;
      setFornecedores(res.data.dados ?? []);
    } catch { setErroInline('Erro ao carregar fornecedores'); }
    finally { setLoading(false); }
  }, [busca, filtroAtivo]);

  useEffect(() => { if (!loadingPerms) carregar(); }, [carregar, loadingPerms]);

  const abrirNovo = () => { setEditando(null); setForm(FORM_INICIAL); setErroModal(null); setShowModal(true); };

  // Veio de "Incluir Membro" (Equipe) via "+ Cadastrar Novo Fornecedor" — abre o modal direto
  useEffect(() => {
    if ((location.state as { abrirNovo?: boolean } | null)?.abrirNovo) {
      abrirNovo();
      window.history.replaceState({}, '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const abrirEdicao = (f: Fornecedor) => {
    setErroModal(null);
    setEditando(f);
    setForm({
      nome:        f.nome,
      tipoDoc:     f.cnpj ? 'cnpj' : 'cpf',
      cpf:         f.cpf  ? mascaraCPF(f.cpf.replace(/\D/g,''))   : '',
      cnpj:        f.cnpj ? mascaraCNPJ(f.cnpj.replace(/\D/g,'')) : '',
      telefone:    f.telefone ? mascaraTelefone(f.telefone.replace(/\D/g,'')) : '',
      email:       f.email ?? '',
      tipoServico: f.tipoServico?.trim() ?? '',
      cep:         f.cep         ? mascaraCEP(f.cep.replace(/\D/g,'')) : '',
      endereco:    f.endereco    ?? '',
      complemento: f.complemento ?? '',
      bairro:      f.bairro      ?? '',
      cidade:      f.cidade      ?? '',
      estado:      f.estado      ?? '',
    });
    setShowModal(true);
  };

  const fecharModal = () => { setShowModal(false); setEditando(null); setForm(FORM_INICIAL); setErroModal(null); };
  const handleFormChange = (updates: Partial<FormForn>) => setForm(prev => ({ ...prev, ...updates }));

  const handleSalvar = async (force = false) => {
    setErroModal(null);
    if (editando && editando.tipoEntrada === 'SYSTEM' && !isAdmin) { setErroModal(msgSemPermissao('alterar fornecedor do catálogo global')); return; }
    if (editando && !podeEditar) { setErroModal(msgSemPermissao('alterar fornecedor')); return; }
    if (!editando && !podeCriar) { setErroModal(msgSemPermissao('criar fornecedor')); return; }
    if (!form.nome.trim())       { setErroModal('Nome é obrigatório'); return; }
    if (!form.tipoServico)       { setErroModal('Selecione o tipo de fornecedor'); return; }
    if (form.email.trim() && !isValidEmail(form.email)) { setErroModal('Informe um e-mail válido'); return; }
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
      ...(force ? { force: true } : {}),
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
      setBusca(''); // volta a listar todos os fornecedores da empresa
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

  const handleToggle = (f: Fornecedor) => {
    setErroLista(null);
    if (f.tipoEntrada === 'SYSTEM' && !isAdmin) { setErroLista(msgSemPermissao('alternar status de fornecedor do catálogo global')); return; }
    if (!podeAtivar) { setErroLista(msgSemPermissao('alternar status do fornecedor')); return; }
    // Inativar exige justificativa; ativar continua direto.
    if (f.ativo) { setInativando(f); return; }
    confirmarToggle(f);
  };

  const confirmarToggle = async (f: Fornecedor, motivo?: string) => {
    setProcessandoToggle(true);
    try {
      await api.patch(`/cadastro/fornecedores/${f.id}/toggle`, motivo ? { motivo } : undefined);
      toast.success(f.ativo ? 'Fornecedor inativado' : 'Fornecedor ativado');
      setInativando(null);
      carregar();
    } catch { setErroLista('Erro ao alternar status'); }
    finally { setProcessandoToggle(false); }
  };

  if (loadingPerms) return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full" />
    </div>
  );

  if (!podeExecutar('cadastro.fornecedor.ler') && !isAdmin) return (
    <PageContainer maxWidth="7xl">
      <div className="text-center py-16">
        <h2 className="text-lg font-semibold text-gray-700 mb-2">Acesso não autorizado</h2>
        <p className="text-sm text-gray-500">Você não tem permissão para visualizar fornecedores.</p>
      </div>
    </PageContainer>
  );

  return (
    <PageContainer maxWidth="7xl">
      {/* Header */}
      <BotaoVoltar />

      <InlineError message={erroInline} className="mt-3" />

      {/* Mesma linha em qualquer largura (padrão do resto da aplicação — ver
          CadastroTratador): título à esquerda, botão pequeno à direita. Com
          `flex-col sm:flex-row` o botão herdava `align-items: stretch` no mobile e
          virava uma faixa de largura total abaixo do título. */}
      <div className="flex items-center justify-between gap-3 mt-2 mb-4 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Truck size={24} className="text-emerald-600" /> Fornecedores
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

      {/* Erro das ações da LINHA (editar / ativar-inativar), colado na lista de onde
          o botão foi clicado — o `erroInline` do topo é só para falha de CARGA. */}
      <InlineError message={erroLista} className="mb-3" />

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-emerald-600" />
        </div>
      ) : fornecedores.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Truck size={40} className="mb-3 text-gray-200" />
          <p className="text-sm text-gray-400">Nenhum fornecedor encontrado</p>
        </div>
      ) : (
        <>
          {/* Mobile */}
          <div className="md:hidden space-y-3">
            {fornecedores.map(f => (
              <div key={f.id} className={`bg-white rounded-2xl border p-4 shadow-sm ${!f.ativo ? 'opacity-60' : 'border-gray-100'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                      <p className="text-sm font-semibold text-gray-900 truncate">{f.nome}</p>
                    </div>
                    {f.telefone && (
                      <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                        <Phone size={10} />{f.telefone}
                      </p>
                    )}
                    {f.email && (
                      <p className="text-xs text-gray-500 mt-0.5 truncate">{f.email}</p>
                    )}
                    {f.cidade && (
                      <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                        <MapPin size={10} />{f.cidade}{f.estado ? ` — ${f.estado}` : ''}
                      </p>
                    )}
                    <p className="text-xs text-gray-400 mt-0.5">{f.cnpj ?? f.cpf ?? '—'}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {f.tipoServico.split(',').map(t => t.trim()).filter(Boolean).map(t => (
                        <span key={t} className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${f.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                    {f.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                </div>
                {filtroAtivo === 'ativo' && (
                  <p className="text-[11px] text-gray-400 mt-1">
                    Criado em {formatDate(f.createdAt)}
                    {f.ativoPorNome ? ` · Ativado em ${formatDate(f.ativoEm ?? f.createdAt)} por ${f.ativoPorNome}` : ''}
                  </p>
                )}
                {filtroAtivo === 'inativo' && (
                  <p className="text-[11px] text-gray-400 mt-1">
                    Inativado em {formatDate(f.inativoEm)}
                    {f.inativoPorNome ? ` por ${f.inativoPorNome}` : ''}
                    {f.inativoMotivo ? <> — <JustificativaCancelamento texto={f.inativoMotivo} className="inline" /></> : ''}
                  </p>
                )}
                {(f.tipoEntrada !== 'SYSTEM' || isAdmin) && (podeEditar || podeAtivar) && (
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-50">
                    {podeEditar && (
                      <button onClick={() => abrirEdicao(f)}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 border border-orange-200 rounded-lg text-xs text-orange-600 hover:bg-orange-50 transition-colors">
                        <Pencil size={11} /> Editar
                      </button>
                    )}
                    {podeAtivar && (
                      <button onClick={() => handleToggle(f)}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 transition-colors">
                        {f.ativo ? <ToggleRight size={11} className="text-blue-600" /> : <ToggleLeft size={11} />}
                        {f.ativo ? 'Inativar' : 'Ativar'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Desktop */}
          <div className="hidden md:block bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto rounded-2xl">
            <table className="w-full min-w-[1020px] text-sm">
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
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Justificativa</th>
                    </>
                  )}
                  {(podeEditar || podeAtivar) && <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Ações</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {fornecedores.map(f => (
                  <tr key={f.id} className={`hover:bg-gray-50 transition-colors ${!f.ativo ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{f.nome}</p>
                      {f.email && <p className="text-xs text-gray-400 truncate">{f.email}</p>}
                      {f.cidade && (
                        <p className="text-xs text-gray-400 flex items-center gap-0.5">
                          <MapPin size={9} />{f.cidade}{f.estado ? ` — ${f.estado}` : ''}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap text-xs">
                      {f.cnpj ?? f.cpf ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap text-xs">
                      {f.telefone
                        ? <span className="flex items-center gap-1"><Phone size={10} />{f.telefone}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {f.tipoServico.split(',').map(t => t.trim()).filter(Boolean).map(t => (
                          <span key={t} className="text-[11px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">
                            {t}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${f.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                        {f.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    {filtroAtivo === 'ativo' && (
                      <>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-600">{formatDate(f.createdAt)}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-600">{formatDate(f.ativoEm ?? f.createdAt)}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-600">{f.ativoPorNome ?? '—'}</td>
                      </>
                    )}
                    {filtroAtivo === 'inativo' && (
                      <>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-600">{formatDate(f.inativoEm)}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-600">{f.inativoPorNome ?? '—'}</td>
                        <td className="px-4 py-3"><JustificativaCancelamento texto={f.inativoMotivo} /></td>
                      </>
                    )}
                    {(podeEditar || podeAtivar) && (
                      <td className="px-4 py-3">
                        {f.tipoEntrada === 'SYSTEM' && !isAdmin ? (
                          <span className="text-xs text-gray-300 italic block text-right">Catálogo global</span>
                        ) : (
                          <div className="flex items-center justify-end gap-1">
                            {podeEditar && (
                              <button onClick={() => abrirEdicao(f)} title="Editar"
                                className="p-1.5 text-orange-500 hover:text-orange-700 hover:bg-orange-50 rounded-lg transition-colors">
                                <Pencil size={14} />
                              </button>
                            )}
                            {podeAtivar && (
                              <button onClick={() => handleToggle(f)} title={f.ativo ? 'Inativar' : 'Ativar'}
                                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">
                                {f.ativo ? <ToggleRight size={14} className="text-blue-600" /> : <ToggleLeft size={14} />}
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
          </div>
        </>
      )}

      {showModal && (
        <ModalFornecedor
          editando={editando}
          form={form}
          saving={saving}
          erro={erroModal}
          onFormChange={handleFormChange}
          onSalvar={handleSalvar}
          onClose={fecharModal}
        />
      )}

      {dupInativoInfo && (
        <ModalDuplicataInativa
          mensagem={dupInativoInfo.mensagem}
          onConfirmar={() => { setDupInativoInfo(null); handleSalvar(true); }}
          onCancelar={() => setDupInativoInfo(null)}
        />
      )}

      <ModalJustificativa
        aberto={!!inativando}
        titulo="Inativar fornecedor?"
        descricao={inativando ? `${inativando.nome} deixa de aparecer como ativo.` : undefined}
        acaoLabel="Inativar"
        processando={processandoToggle}
        onConfirmar={(motivo) => { if (inativando) confirmarToggle(inativando, motivo); }}
        onFechar={() => setInativando(null)}
      />
    </PageContainer>
  );
}
