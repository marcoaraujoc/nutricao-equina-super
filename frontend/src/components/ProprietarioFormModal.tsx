// frontend/src/components/ProprietarioFormModal.tsx
//
// Formulário de proprietário — extraído de CadastroProprietario.tsx (mesmo padrão
// de reuso de UsuarioFormModal.tsx) para ser reaproveitado pela Transferência de
// Propriedade do animal (AnimalDetail.tsx), sem duplicar o formulário inteiro.
//
// DOIS MODOS:
//   - Padrão (Cadastro de Proprietários) — componente CONTROLADO pelo pai, como
//     sempre foi: `editando`/`form`/`saving`/`erroAcao`/`onFormChange`/`onSalvar`.
//   - `modoTransferencia` — AUTOCONTIDO: o próprio componente gerencia o formulário
//     e chama `POST /animais/:id/transferir-propriedade` direto, sem exigir que o
//     chamador replique toda a lógica de estado/validação do Cadastro. Sempre trata
//     como um dono NOVO (nunca edita um proprietário existente in-place) e exige um
//     motivo (Doação/Venda/Aluguel) antes de liberar o envio.

import { useState, useRef } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  Pencil, Trash2, Loader2, X, Users, ArrowLeftRight,
  Building2, User as UserIcon, Plus,
  MapPin, BadgeCheck, AlertCircle, Info,
} from 'lucide-react';
import { LocalizacaoCombobox } from './UsuarioFormModal';
import ErroAcao, { classeErro, type ErroAcaoDados } from './ErroAcao';

// ─── Validações CPF/CNPJ ──────────────────────────────────────────────────────

export function validarCPF(cpf: string): boolean {
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

export function validarCNPJ(cnpj: string): boolean {
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

export function mascaraCPF(v: string): string {
  return v.replace(/\D/g, '').slice(0, 11)
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

export function mascaraCNPJ(v: string): string {
  return v.replace(/\D/g, '').slice(0, 14)
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

export function mascaraTelefone(v: string): string {
  const n = v.replace(/\D/g, '').slice(0, 11);
  if (n.length <= 10) return n.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
  return n.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
}

export function mascaraCEP(v: string): string {
  return v.replace(/\D/g, '').slice(0, 8).replace(/(\d{5})(\d{1,3})$/, '$1-$2');
}

// Senha padrão de novos cadastros — troca obrigatória no primeiro acesso
export const SENHA_PADRAO_INICIAL = 'Inicial_001';

// Formata valor monetário sempre com decimais visíveis
export function formatarMoeda(v: string): string {
  const nums = v.replace(/\D/g, '');
  if (!nums) return '';
  const n = parseInt(nums, 10) / 100;
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function parseMoeda(v: string): number {
  return parseFloat(v.replace(/\./g, '').replace(',', '.')) || 0;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type TipoDoc = 'cpf' | 'cnpj';

// Uma localidade atendida do cliente, com a frequência de visitas DELA.
// Ex.: Sociedade Hípica Brasileira 2x/semana + Haras H.P. 3x/semana.
export interface LocalidadeProp {
  localizacaoId:     number;
  localizacaoNome:   string;
  frequenciaVisitas: number;
}

export interface Proprietario {
  id:               number;
  fullName:         string;
  email:            string;
  phone:            string | null;
  cpf:              string | null;
  cnpj:             string | null;
  mensalista:       boolean;
  valorAssistencia: number | null;
  frequenciaVisitas: number | null;
  localidades:      LocalidadeProp[];
  diaVencimentoFatura: number | null;
  cep:              string | null;
  endereco:         string | null;
  complemento:      string | null;
  bairro:           string | null;
  cidade:           string | null;
  estado:           string | null;
  ativo:            boolean;
  createdAt:        string;
  // Trilha de ativação/inativação (quem fez, quando) — ver lib/cadastroAtivacao.js
  ativoEm?:        string | null;
  ativoPorNome?:   string | null;
  inativoEm?:      string | null;
  inativoPorNome?: string | null;
  inativoMotivo?:  string | null;
}

export interface FormProp {
  fullName:          string;
  email:             string;
  phone:             string;
  tipoDoc:           TipoDoc;
  cpf:               string;
  cnpj:              string;
  mensalista:        boolean;
  valorAssistencia:  string;
  // A frequência é POR LOCALIDADE — o campo único saiu do formulário e passou a ser
  // derivado (o maior valor) no backend, só para as leituras legadas.
  localidades:       LocalidadeProp[];
  diaVencimentoFatura: string;
  cep:               string;
  endereco:          string;
  complemento:       string;
  bairro:            string;
  cidade:            string;
  estado:            string;
}

export const FORM_INICIAL: FormProp = {
  fullName: '', email: '', phone: '',
  tipoDoc: 'cpf', cpf: '', cnpj: '',
  mensalista: false, valorAssistencia: '', localidades: [], diaVencimentoFatura: '5',
  cep: '', endereco: '', complemento: '', bairro: '', cidade: '', estado: '',
};

const RASCUNHO_LOCALIDADE: LocalidadeProp = {
  localizacaoId: 0, localizacaoNome: '', frequenciaVisitas: 0,
};

// "Sociedade Hípica Brasileira · 2x/semana"
export const resumoLocalidade = (l: LocalidadeProp): string =>
  `${l.localizacaoNome || `Local #${l.localizacaoId}`} · ${l.frequenciaVisitas}x/semana`;

const VISITAS_OPTIONS = [
  { value: '1', label: '1x na semana' },
  { value: '2', label: '2x na semana' },
  { value: '3', label: '3x na semana' },
  { value: '4', label: '4x na semana' },
  { value: '5', label: '5x na semana' },
  { value: '6', label: '6x na semana' },
  { value: '7', label: '7x na semana (diário)' },
];

// Dia de vencimento da fatura: obrigatório, inteiro entre 1 e 25 (rejeita 0,
// negativo e >25). Retorna a mensagem de erro inline ('' = válido).
export const validarDiaVencimento = (valor: string): string => {
  if (!valor.trim()) return 'Informe o dia de vencimento da fatura (1 a 25).';
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1 || n > 25) return 'Dia inválido — escolha um dia entre 1 e 25.';
  return '';
};

export type MotivoTransferencia = 'DOACAO' | 'VENDA' | 'ALUGUEL';

const MOTIVOS_TRANSFERENCIA: { value: MotivoTransferencia; label: string }[] = [
  { value: 'DOACAO',  label: 'Doação' },
  { value: 'VENDA',   label: 'Venda' },
  { value: 'ALUGUEL', label: 'Aluguel' },
];

// Payload que o backend espera em `novoProprietario` — mesmos campos do form,
// normalizados igual ao `handleSalvar` de CadastroProprietario.tsx.
function montarNovoProprietario(form: FormProp) {
  return {
    fullName: form.fullName,
    email:    form.email,
    phone:    form.phone || null,
    cpf:      form.tipoDoc === 'cpf'  && form.cpf.trim()  ? form.cpf  : null,
    cnpj:     form.tipoDoc === 'cnpj' && form.cnpj.trim() ? form.cnpj : null,
    mensalista:       form.mensalista,
    valorAssistencia: form.mensalista && form.valorAssistencia ? parseMoeda(form.valorAssistencia) : null,
    localidades: form.localidades.map(l => ({
      localizacaoId:     l.localizacaoId,
      frequenciaVisitas: l.frequenciaVisitas,
    })),
    diaVencimentoFatura: Number(form.diaVencimentoFatura),
    cep: form.cep || null, endereco: form.endereco || null, complemento: form.complemento || null,
    bairro: form.bairro || null, cidade: form.cidade || null, estado: form.estado || null,
  };
}

// Mesma validação client-side que CadastroProprietario.tsx#handleSalvar já faz —
// duplicada aqui de propósito (o modo transferência é autocontido e não tem acesso
// à função da página) — retorna null quando válido.
function validarFormProprietario(form: FormProp): ErroAcaoDados | null {
  if (!form.fullName.trim()) return { mensagem: 'Nome é obrigatório', campos: ['fullName'] };
  if (!form.email.trim())    return { mensagem: 'E-mail é obrigatório', campos: ['email'] };
  if (!form.phone.trim())    return { mensagem: 'Telefone é obrigatório', campos: ['phone'] };
  if (form.localidades.length === 0) {
    return { mensagem: 'Informe ao menos uma localidade com a frequência de visitas', campos: ['localidades'] };
  }
  if (validarDiaVencimento(form.diaVencimentoFatura)) return { mensagem: validarDiaVencimento(form.diaVencimentoFatura) };
  if (form.tipoDoc === 'cpf'  && form.cpf.trim()  && !validarCPF(form.cpf))   return { mensagem: 'CPF inválido', campos: ['cpf'] };
  if (form.tipoDoc === 'cnpj' && form.cnpj.trim() && !validarCNPJ(form.cnpj)) return { mensagem: 'CNPJ inválido', campos: ['cnpj'] };
  if (form.mensalista && !form.valorAssistencia) {
    return { mensagem: 'Informe o valor da assistência veterinária', campos: ['valorAssistencia'] };
  }
  return null;
}

// ─── Componente ───────────────────────────────────────────────────────────────

interface ProprietarioFormModalProps {
  onClose: () => void;
  /** Modo TRANSFERÊNCIA — autocontido, sem props controlados abaixo. */
  modoTransferencia?: { animalId: number; onConcluido: (animalAtualizado: unknown) => void };
  /** Modo padrão (Cadastro de Proprietários) — componente CONTROLADO pelo pai. */
  editando?:     Proprietario | null;
  form?:         FormProp;
  saving?:       boolean;
  /** Erro do SALVAR — exibido no rodapé, junto ao botão, e marca os campos culpados */
  erroAcao?:     ErroAcaoDados | null;
  onFormChange?: (updates: Partial<FormProp>) => void;
  onSalvar?:     () => void;
}

export default function ProprietarioFormModal({
  onClose, modoTransferencia,
  editando: editandoProp, form: formProp, saving: savingProp, erroAcao: erroAcaoProp,
  onFormChange: onFormChangeProp, onSalvar: onSalvarProp,
}: ProprietarioFormModalProps) {
  const emTransferencia = !!modoTransferencia;

  // ── Estado interno — usado SÓ no modo transferência (o modo padrão é 100%
  // controlado pelo pai, como sempre foi) ──────────────────────────────────────
  const [formInterno,  setFormInterno]  = useState<FormProp>(FORM_INICIAL);
  const [savingInterno, setSavingInterno] = useState(false);
  const [erroInterno,  setErroInterno]  = useState<ErroAcaoDados | null>(null);
  const [motivo,       setMotivo]       = useState<MotivoTransferencia | ''>('');

  const editando = emTransferencia ? null                : (editandoProp ?? null);
  const form     = emTransferencia ? formInterno          : (formProp ?? FORM_INICIAL);
  const saving   = emTransferencia ? savingInterno         : !!savingProp;
  const erroAcao = emTransferencia ? erroInterno           : (erroAcaoProp ?? null);
  const onFormChange = emTransferencia
    ? (updates: Partial<FormProp>) => setFormInterno(p => ({ ...p, ...updates }))
    : (onFormChangeProp as (updates: Partial<FormProp>) => void);

  const handleSalvarTransferencia = async () => {
    setErroInterno(null);
    if (!motivo) { setErroInterno({ mensagem: 'Selecione o motivo da transferência.', campos: ['motivo'] }); return; }
    const erroValidacao = validarFormProprietario(form);
    if (erroValidacao) { setErroInterno(erroValidacao); return; }

    setSavingInterno(true);
    try {
      const res = await api.post(`/animais/${modoTransferencia!.animalId}/transferir-propriedade`, {
        motivo,
        novoProprietario: montarNovoProprietario(form),
      });
      toast.success('Propriedade transferida com sucesso');
      modoTransferencia!.onConcluido(res.data?.dados);
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } })?.response?.data?.mensagem;
      setErroInterno({ mensagem: msg ?? 'Erro ao transferir a propriedade do animal' });
    } finally { setSavingInterno(false); }
  };

  const onSalvarClick = emTransferencia ? handleSalvarTransferencia : (onSalvarProp as () => void);

  const [buscandoCNPJ,  setBuscandoCNPJ]  = useState(false);
  const [docError,      setDocError]      = useState('');
  const [buscandoCEP,   setBuscandoCEP]   = useState(false);
  const cnpjTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Localidade em preenchimento — mesmo padrão do card "Locais de trabalho":
  // o formulário só aparece após o clique e "Adicionar" empurra para a lista.
  const [rascunhoLoc,      setRascunhoLoc]      = useState<LocalidadeProp>(RASCUNHO_LOCALIDADE);
  const [mostrarFormLoc,   setMostrarFormLoc]   = useState(false);
  const [editIndexLoc,     setEditIndexLoc]     = useState<number | null>(null);
  const [erroLoc,          setErroLoc]          = useState<string | null>(null);

  const diaVencimentoErro = validarDiaVencimento(form.diaVencimentoFatura);

  const confirmarLocalidade = () => {
    if (!rascunhoLoc.localizacaoId) { setErroLoc('Selecione a localidade'); return; }
    if (!rascunhoLoc.frequenciaVisitas) { setErroLoc('Selecione a frequência de visitas'); return; }
    // Uma frequência por lugar: repetir a localidade deixaria dois combinados para o
    // mesmo local, sem como saber qual vale.
    const outras = form.localidades.filter((_, i) => i !== editIndexLoc);
    if (outras.some(l => l.localizacaoId === rascunhoLoc.localizacaoId)) {
      setErroLoc('Esta localidade já foi adicionada — altere a linha existente.'); return;
    }
    onFormChange({
      localidades: editIndexLoc === null
        ? [...form.localidades, rascunhoLoc]
        : form.localidades.map((x, i) => i === editIndexLoc ? rascunhoLoc : x),
    });
    setRascunhoLoc(RASCUNHO_LOCALIDADE);
    setErroLoc(null);
    setMostrarFormLoc(false);
    setEditIndexLoc(null);
  };

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

  // Mesmo padrão da tela de Tratador/Localização: rounded-2xl + anel emerald no foco.
  const inputCls = 'w-full border border-gray-200 rounded-2xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-400 transition-colors';
  // Vazio => aviso suave (rosa claro). Apontado pelo erro do Salvar => destaque forte.
  const inputReqCls = (v: string, campo?: string) =>
    classeErro(erroAcao, campo ?? '', `${inputCls} ${!v.trim() ? 'border-red-200 focus:ring-red-300' : ''}`);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
      {/* `dvh`, não `vh`: no mobile, `92vh` ficava preso à altura ANTES do teclado
          abrir, e o fim do formulário/rodapé ficava atrás do teclado (mesma correção
          aplicada em CadastroFornecedor). `rounded-3xl` em toda largura, como
          Tratador/Localização — antes só arredondava o topo no mobile. */}
      <div className="bg-white rounded-3xl shadow-xl w-full sm:max-w-2xl max-h-[90dvh] flex flex-col border border-gray-100">

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            {emTransferencia
              ? <ArrowLeftRight size={18} className="text-emerald-600" />
              : <Users size={18} className="text-emerald-600" />}
            {emTransferencia ? 'Transferência de Propriedade' : (editando ? 'Editar Proprietário' : 'Novo Proprietário')}
          </h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* ── Motivo da Transferência (só no modo transferência) ── */}
          {emTransferencia && (
            <section>
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <ArrowLeftRight size={12} /> Motivo da Transferência
              </h4>
              <select
                value={motivo}
                onChange={e => setMotivo(e.target.value as MotivoTransferencia)}
                className={classeErro(erroAcao, 'motivo', `${inputCls} ${!motivo ? 'border-red-200 focus:ring-red-300' : ''}`)}>
                <option value="">Selecione o motivo...</option>
                {MOTIVOS_TRANSFERENCIA.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <p className="text-[11px] text-gray-400 mt-1">
                O animal deixa de aparecer para o proprietário atual e passa a ser deste novo proprietário
                a partir de agora — o histórico clínico anterior a esta data não é visível a ele.
              </p>
            </section>
          )}

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
                  placeholder="Nome do proprietário" className={inputReqCls(form.fullName, 'fullName')} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">E-mail *</label>
                <input type="email" value={form.email} onChange={e => onFormChange({ email: e.target.value })}
                  placeholder="email@exemplo.com" className={inputReqCls(form.email, 'email')} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Telefone *</label>
                <input value={form.phone}
                  onChange={e => onFormChange({ phone: mascaraTelefone(e.target.value) })}
                  placeholder="(00) 00000-0000" className={inputReqCls(form.phone, 'phone')} />
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
              {/* Cidade e Estado na mesma linha — mesmo padrão de CadastroFornecedor:
                  um sub-grid de 2 colunas ocupando uma célula do grid de 3 colunas. */}
              <div className="grid grid-cols-2 gap-2">
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

            {/* Valor da assinatura e dia de vencimento da fatura na mesma linha —
                logo abaixo de Mensalista e acima de Localidades. O campo de valor
                fica sempre visível (não só quando Mensalista está marcado), mas só
                é obrigatório e só é salvo quando Mensalista está ativo. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Valor da Assistência Veterinária {form.mensalista && '*'}
                </label>
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
                {!form.mensalista && (
                  <p className="text-[10px] text-gray-400 mt-1">Só é cobrado quando Mensalista está ativo.</p>
                )}
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Dia de vencimento da fatura *</label>
                <input type="number" min={1} max={25}
                  value={form.diaVencimentoFatura}
                  onChange={e => onFormChange({ diaVencimentoFatura: e.target.value })}
                  placeholder="Ex.: 5"
                  className={`${inputCls} ${diaVencimentoErro ? 'border-red-300 focus:border-red-400' : ''}`} />
                {diaVencimentoErro ? (
                  <p className="text-[11px] text-red-500 mt-1 flex items-center gap-1">
                    <AlertCircle size={11} /> {diaVencimentoErro}
                  </p>
                ) : (
                  <p className="text-[10px] text-gray-400 mt-1">
                    Dia do mês entre <b>1 e 25</b>. Fatura fechada e não paga após o vencimento fica <b>Atrasada</b>.
                  </p>
                )}
              </div>
            </div>

            {/* ── Localidades atendidas + frequência de CADA uma ──────────────
                Ex.: Sociedade Hípica Brasileira 2x/semana e Haras H.P. 3x/semana.
                Mesmo padrão do card "Locais de trabalho" do profissional. */}
            <div className="mb-3">
              <label className="block text-xs text-gray-500 mb-1">
                Localidades e frequência de visitas *
              </label>

              {form.localidades.length > 0 ? (
                <div className="space-y-1.5 mb-2">
                  {form.localidades.map((loc, idx) => (
                    <div key={idx} className="flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
                      <MapPin size={13} className="text-emerald-600 flex-shrink-0" />
                      <span className="flex-1 min-w-0 text-sm text-gray-800 truncate">
                        {resumoLocalidade(loc)}
                      </span>
                      <button type="button"
                        onClick={() => {
                          setRascunhoLoc(loc);
                          setEditIndexLoc(idx);
                          setErroLoc(null);
                          setMostrarFormLoc(true);
                        }}
                        className="flex items-center gap-1 px-2 py-1 text-xs font-semibold text-orange-700 hover:bg-orange-50 rounded-lg transition-colors flex-shrink-0">
                        <Pencil size={13} /> Alterar
                      </button>
                      <button type="button"
                        onClick={() => {
                          onFormChange({ localidades: form.localidades.filter((_, i) => i !== idx) });
                          if (editIndexLoc === idx) {
                            setMostrarFormLoc(false); setEditIndexLoc(null); setRascunhoLoc(RASCUNHO_LOCALIDADE);
                          }
                        }}
                        className="flex items-center gap-1 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0">
                        <Trash2 size={13} /> Excluir
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 mb-2">
                  Nenhuma localidade informada.
                  {editando?.frequenciaVisitas
                    ? ` Frequência cadastrada antes: ${editando.frequenciaVisitas}x/semana — informe em qual localidade.`
                    : ''}
                </p>
              )}

              {!mostrarFormLoc && (
                <button type="button"
                  onClick={() => { setErroLoc(null); setEditIndexLoc(null); setRascunhoLoc(RASCUNHO_LOCALIDADE); setMostrarFormLoc(true); }}
                  className="flex items-center gap-1.5 px-3 py-2 border border-emerald-200 text-emerald-700 rounded-xl text-xs font-semibold hover:bg-emerald-50 transition-colors">
                  <Plus size={13} /> Adicionar localidade
                </button>
              )}

              {mostrarFormLoc && (
                <div className="p-3 bg-gray-50/60 border border-gray-200 rounded-2xl space-y-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Localidade</label>
                    <LocalizacaoCombobox
                      value={rascunhoLoc.localizacaoId || null}
                      nome={rascunhoLoc.localizacaoNome}
                      onSelect={(id, nome) => {
                        setErroLoc(null);
                        setRascunhoLoc(r => ({ ...r, localizacaoId: id, localizacaoNome: nome }));
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Frequência de visitas</label>
                    <select
                      value={rascunhoLoc.frequenciaVisitas || ''}
                      onChange={e => {
                        setErroLoc(null);
                        setRascunhoLoc(r => ({ ...r, frequenciaVisitas: Number(e.target.value) }));
                      }}
                      className={inputCls}>
                      <option value="">Selecione a frequência...</option>
                      {VISITAS_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button type="button"
                      onClick={() => { setMostrarFormLoc(false); setRascunhoLoc(RASCUNHO_LOCALIDADE); setErroLoc(null); setEditIndexLoc(null); }}
                      className="px-3 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-xs font-semibold hover:bg-gray-100">
                      Cancelar
                    </button>
                    <button type="button" onClick={confirmarLocalidade}
                      className="px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-semibold">
                      {editIndexLoc === null ? 'Adicionar' : 'Salvar'}
                    </button>
                  </div>
                </div>
              )}
              {erroLoc && <p className="text-xs text-red-600 mt-1.5">{erroLoc}</p>}
            </div>
          </section>

        </div>

        <div className="px-5 pb-5 pt-3 border-t border-gray-100 flex-shrink-0">
          {/* Erro pertence à superfície da ação: aqui, colado no botão que foi clicado */}
          <ErroAcao erro={erroAcao} className="mb-3" />
          {/* Rodapé no padrão da aplicação: ações à direita, tamanho padrão — mesmas
              classes de Animal.tsx/Configurações, não mais os botões de largura total. */}
          <div className="flex items-center justify-end gap-3">
            <button onClick={onClose} disabled={saving}
              className="px-4 py-2.5 border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 rounded-xl text-sm font-semibold transition-colors">
              Cancelar
            </button>
            <button onClick={onSalvarClick} disabled={saving}
              className="px-6 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-2">
              {saving && <Loader2 size={13} className="animate-spin" />}
              {emTransferencia
                ? (saving ? 'Transferindo…' : 'Transferir Propriedade')
                : (saving ? 'Salvando…' : 'Salvar')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
