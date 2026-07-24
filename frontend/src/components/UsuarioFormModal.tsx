// src/components/UsuarioFormModal.tsx
// Formulário compartilhado de criação/edição de usuário — página única com
// seções (Dados Pessoais / Endereço), mesmo layout do modal de Novo Proprietário.
// Usado em: Usuarios.tsx (Novo/Editar Usuário) e Equipe.tsx (Incluir/Editar Membro).
// Criação sem campo de senha — a senha inicial é a padrão do sistema (Inicial_001),
// com troca obrigatória no primeiro acesso. Em edição, `permitirSenha` exibe o
// campo "Nova senha" (admin: qualquer usuário; gestor: membros da própria equipe).

import { useState, useEffect } from 'react';
import {
  X, AlertCircle, Info, Eye, EyeOff, Loader2, Plus,
  User as UserIcon, MapPin, Users, Pencil, Trash2,
} from 'lucide-react';
import api from '../services/api';
import { isValidEmail } from '../utils/validators';
import ModalNovoFornecedor, { type NovoFornecedorResult } from './ModalNovoFornecedor';
import EspecialidadeSelector from './EspecialidadeSelector';
import InlineError from './InlineError';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface UsuarioFormValues {
  fullName: string;
  email: string;
  phone: string;
  perfil: string;      // cargo primário (primeiro de cargos)
  cargos: string[];    // todos os cargos selecionados
  senha: string;       // edição com permitirSenha: vazio = não alterar
  ativo: boolean;
  cep: string;
  endereco: string;
  complemento: string;
  bairro: string;
  cidade: string;
  estado: string;
  /** Perfil FORNECEDOR (comFornecedor): cadastro Fornecedor selecionado, null = criar novo */
  fornecedorId?: number | null;
  /** Perfil FORNECEDOR sem fornecedorId: tipo de serviço do novo cadastro Fornecedor */
  tipoServico?: string;
  /** Especialidades (catálogo por espécie) — VET e FORNECEDOR. */
  especialidadeIds?: number[];
  /** Expediente de trabalho do profissional (Agenda). Vazio = herda o da empresa. */
  diasTrabalho?: number[];       // 0=Dom … 6=Sáb
  horaInicioTrabalho?: string;   // HH:MM
  horaFimTrabalho?: string;      // HH:MM
  /** Locais de trabalho — o membro pode ter vários na mesma empresa, cada um com
   *  dias e horário próprios. Quando presente, é a fonte do expediente. */
  locaisTrabalho?: LocalTrabalhoForm[];
}

export interface LocalTrabalhoForm {
  localizacaoId:      number;
  localizacaoNome:    string;
  diasTrabalho:       number[];  // 0=Dom … 6=Sáb
  horaInicioTrabalho: string;    // HH:MM
  horaFimTrabalho:    string;    // HH:MM
  especialidadeIds:   number[];  // especialidades exercidas NESTE local (catálogo)
}

interface LocalizacaoOpcao { id: number; nome: string }

const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500 transition-colors';
const labelCls = 'block text-xs text-gray-500 mb-1';

interface FornecedorDisponivel {
  id:          number;
  nome:        string;
  email:       string | null;
  telefone:    string | null;
  tipoServico: string;
  userId:      number | null;
  ativo:       boolean;
}

export const SENHA_PADRAO_INICIAL = 'Inicial_001';

export const PERFIS_ACESSO: Array<{ value: string; label: string }> = [
  { value: 'VETERINARIO', label: 'Veterinário' },
  { value: 'ESTAGIARIO',  label: 'Estagiário'  },
  { value: 'ENFERMEIRO',  label: 'Enfermeiro'  },
  { value: 'SECRETARIA',  label: 'Secretaria'  },
  { value: 'FINANCEIRO',  label: 'Financeiro'  },
  { value: 'FORNECEDOR',  label: 'Fornecedor'  },
];

// Perfis que não podem ser escolhidos, mas podem existir em usuários antigos (edição)
const PERFIS_LEGADOS: Record<string, string> = {
  PROPRIETARIO: 'Proprietário',
  ADMIN:        'Administrador',
  MEMBRO:       'Membro',
};

// Mesmas regras de UserController.alterarSenha
const validarSenha = (s: string): string | null => {
  if (s.length < 8)           return 'A senha deve ter ao menos 8 caracteres';
  if (!/[A-Z]/.test(s))       return 'A senha deve ter ao menos uma letra maiúscula';
  if (!/\d/.test(s))          return 'A senha deve ter ao menos 1 número';
  if (!/[^A-Za-z0-9]/.test(s)) return 'A senha deve ter ao menos 1 caractere especial';
  return null;
};

const mascaraTelefone = (v: string): string => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length === 0) return '';
  if (d.length <= 2)  return `(${d}`;
  if (d.length <= 6)  return `(${d.slice(0,2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
};

const mascaraCEP = (v: string): string => {
  const d = v.replace(/\D/g, '').slice(0, 8);
  return d.length <= 5 ? d : `${d.slice(0,5)}-${d.slice(5)}`;
};

const FORM_VAZIO: UsuarioFormValues = {
  fullName: '', email: '', phone: '', perfil: 'VETERINARIO', cargos: ['VETERINARIO'], senha: '', ativo: true,
  cep: '', endereco: '', complemento: '', bairro: '', cidade: '', estado: '',
  diasTrabalho: [], horaInicioTrabalho: '', horaFimTrabalho: '', especialidadeIds: [],
  locaisTrabalho: [],
};

// Dias da semana (0=Dom … 6=Sáb) — mesma convenção de Date.getDay()
const DIAS_SEMANA_TRAB = [
  { v: 0, l: 'Dom' }, { v: 1, l: 'Seg' }, { v: 2, l: 'Ter' }, { v: 3, l: 'Qua' },
  { v: 4, l: 'Qui' }, { v: 5, l: 'Sex' }, { v: 6, l: 'Sáb' },
];

// Rótulo compacto de um local já adicionado: "Haras X — Seg, Ter · 08:00–12:00"
export function resumoLocal(l: LocalTrabalhoForm): string {
  const dias = [...l.diasTrabalho].sort((a, b) => a - b)
    .map(d => DIAS_SEMANA_TRAB.find(x => x.v === d)?.l ?? d).join(', ');
  const hora = l.horaInicioTrabalho && l.horaFimTrabalho
    ? `${l.horaInicioTrabalho}–${l.horaFimTrabalho}` : '';
  return [dias || null, hora || null].filter(Boolean).join(' · ');
}

export const RASCUNHO_LOCAL_VAZIO: LocalTrabalhoForm = {
  localizacaoId: 0, localizacaoNome: '', diasTrabalho: [], horaInicioTrabalho: '', horaFimTrabalho: '', especialidadeIds: [],
};

// Especialidades do profissional = UNIÃO das especialidades de todos os locais.
export function uniaoEspecialidadesLocais(locais: LocalTrabalhoForm[]): number[] {
  return [...new Set(locais.flatMap(l => l.especialidadeIds ?? []).map(Number).filter(Number.isInteger))];
}

// Campo de hora 24h (HH:MM), SEM AM/PM — o <input type="time"> herda 12/24h do locale
// do SO, então usamos texto com máscara. Vazio = sem restrição (herda o da empresa);
// preenchido é sempre normalizado ao intervalo 00:01–23:59.
export function HoraInput({ value, onChange, className }: {
  value: string; onChange: (v: string) => void; className?: string;
}) {
  const [texto, setTexto] = useState(value);
  useEffect(() => { setTexto(value); }, [value]);

  const mascarar = (raw: string) => {
    const d = raw.replace(/\D/g, '').slice(0, 4);
    return d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`;
  };
  // Normaliza para o intervalo 00:01–23:59
  const normalizar = (t: string): string => {
    const d = t.replace(/\D/g, '');
    if (d.length === 0) return '';
    const h  = Math.min(23, parseInt(d.slice(0, 2), 10) || 0);
    let   mi = Math.min(59, parseInt(d.slice(2, 4) || '0', 10) || 0);
    if (h === 0 && mi === 0) mi = 1; // 00:00 não é permitido → 00:01
    return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
  };

  return (
    <input
      type="text" inputMode="numeric" placeholder="HH:MM" maxLength={5} value={texto}
      onChange={e => {
        const f = mascarar(e.target.value);
        setTexto(f);
        if (/^\d{2}:\d{2}$/.test(f)) onChange(normalizar(f));
        else if (f === '') onChange('');
      }}
      onBlur={() => { const n = texto ? normalizar(texto) : ''; setTexto(n); onChange(n); }}
      className={className}
    />
  );
}

// Dois locais do mesmo profissional não podem coincidir: dia da semana em comum +
// horários que se cruzam. Espelha `conflitoEntreLocais` do EquipeController (backend
// continua sendo a autoridade; aqui é só o aviso imediato ao usuário).
export function conflitoEntreLocais(locais: LocalTrabalhoForm[]): string | null {
  const faixa = (l: LocalTrabalhoForm): [string, string] =>
    [l.horaInicioTrabalho || '00:00', l.horaFimTrabalho || '23:59'];

  for (let i = 0; i < locais.length; i++) {
    for (let j = i + 1; j < locais.length; j++) {
      const comuns = locais[i].diasTrabalho.filter(d => locais[j].diasTrabalho.includes(d));
      if (comuns.length === 0) continue;

      const [iniA, fimA] = faixa(locais[i]);
      const [iniB, fimB] = faixa(locais[j]);
      if (iniA < fimB && iniB < fimA) {
        const dias = [...comuns].sort((a, b) => a - b)
          .map(d => DIAS_SEMANA_TRAB.find(x => x.v === d)?.l ?? d).join(', ');
        return `Os locais de trabalho não podem coincidir: há sobreposição em ${dias} `
             + `(${iniA}–${fimA} e ${iniB}–${fimB}).`;
      }
    }
  }
  return null;
}

interface UsuarioFormModalProps {
  titulo: string;
  /** Nota informativa extra exibida acima do rodapé (ex: aviso de inclusão imediata) */
  infoNota?: string;
  /** Edição: oculta a nota de senha padrão e exibe o checkbox "Usuário ativo" */
  modoEdicao?: boolean;
  /** Edição: exibe campo "Nova senha" (admin: todos; gestor: membros da própria equipe) */
  permitirSenha?: boolean;
  /** Desabilita o campo de e-mail (e-mail é o login — edição restrita) */
  emailBloqueado?: boolean;
  /** Perfil Fornecedor (FORNECEDOR): exibe seletor de fornecedores cadastrados disponíveis */
  comFornecedor?: boolean;
  /** Exibe checkboxes multi-seleção de cargo em vez do select único */
  permitirMultiCargos?: boolean;
  /** Oculta o campo "Perfil de acesso" (usado em telas de cadastro simples) */
  ocultarPerfil?: boolean;
  /** Exibe a seção de expediente de trabalho (dias + horário) — usado em Equipe */
  comExpediente?: boolean;
  /** Equipe gerenciada pela tela — filtra as especialidades pelas espécies dessa empresa */
  equipeId?: number | null;
  /** Erro de senha vindo do backend (ex.: reuso das últimas 6 senhas) — exibido inline sob o campo. */
  erroSenhaServidor?: string;
  initial?: Partial<UsuarioFormValues>;
  salvando: boolean;
  textoBotao?: string;
  onClose: () => void;
  onSubmit: (values: UsuarioFormValues) => void;
}

// ─── Combobox de localização (autocomplete no catálogo) ───────────────────────
// Exportado para o Cadastro Pessoal reusar o MESMO seletor de local de trabalho.
export function LocalizacaoCombobox({
  value, nome, onSelect,
}: {
  value: number | null;
  nome: string;
  onSelect: (id: number, nome: string) => void;
}) {
  const [busca, setBusca]   = useState(nome);
  const [aberto, setAberto] = useState(false);
  const [opcoes, setOpcoes] = useState<LocalizacaoOpcao[]>([]);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => { setBusca(nome); }, [nome]);

  useEffect(() => {
    if (!aberto) return;
    const t = setTimeout(async () => {
      setCarregando(true);
      try {
        const res = await api.get('/cadastro/localizacoes', {
          params: { busca: busca.trim() || undefined, limit: 10 },
        });
        setOpcoes(res.data?.dados ?? []);
      } catch { setOpcoes([]); }
      finally { setCarregando(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [busca, aberto]);

  return (
    <div className="relative">
      <div className="relative">
        <MapPin size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text" value={busca}
          onChange={e => { setBusca(e.target.value); setAberto(true); }}
          onFocus={() => setAberto(true)}
          onBlur={() => setTimeout(() => setAberto(false), 180)}
          placeholder="Buscar local de trabalho..."
          className={`${inputCls} pl-7 ${value ? '' : 'text-gray-700'}`}
        />
      </div>
      {aberto && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
          {carregando && <p className="px-3 py-2 text-xs text-gray-400">Buscando…</p>}
          {!carregando && opcoes.length === 0 && (
            <p className="px-3 py-2 text-xs text-gray-400">Nenhum local encontrado.</p>
          )}
          {opcoes.map(o => (
            <button key={o.id} type="button"
              onMouseDown={() => { onSelect(o.id, o.nome); setBusca(o.nome); setAberto(false); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 hover:text-emerald-700 border-b border-gray-50 last:border-0">
              {o.nome}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function UsuarioFormModal({
  titulo, infoNota, modoEdicao = false, permitirSenha = false, emailBloqueado = false,
  comFornecedor = false, permitirMultiCargos = false, ocultarPerfil = false, comExpediente = false,
  equipeId = null, erroSenhaServidor, initial, salvando, textoBotao, onClose, onSubmit,
}: UsuarioFormModalProps) {
  const initCargos = initial?.cargos ?? (initial?.perfil ? [initial.perfil] : ['VETERINARIO']);
  const [form, setForm] = useState<UsuarioFormValues>({
    ...FORM_VAZIO,
    ...initial,
    cargos: initCargos,
    perfil: initCargos[0],
  });
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [erroSenhaLocal, setErroSenhaLocal] = useState('');
  // Erro de ação/validação do formulário — exibido inline acima dos botões do rodapé
  const [erroInline, setErroInline] = useState<string | null>(null);
  const [buscandoCEP,  setBuscandoCEP]  = useState(false);

  // Seletor de fornecedor existente
  const [fornecedores,        setFornecedores]        = useState<FornecedorDisponivel[]>([]);
  const [loadingFornecedores, setLoadingFornecedores] = useState(false);
  const [fornecedorId,        setFornecedorId]        = useState<number | ''>('');
  const [criandoNovo,         setCriandoNovo]         = useState(false);

  const mostrarSeletorFornecedor = comFornecedor && !modoEdicao && form.perfil === 'FORNECEDOR';

  // Especialidades (catálogo por espécie) — VET e FORNECEDOR, na inclusão E na edição.
  const mostrarEspecialidades = form.perfil === 'VETERINARIO' || form.perfil === 'FORNECEDOR';
  // Rascunho do local em preenchimento (padrão da prescrição: formulário fixo →
  // "Adicionar" empurra para a lista compacta e limpa o formulário).
  const [rascunhoLocal, setRascunhoLocal] = useState<LocalTrabalhoForm>(RASCUNHO_LOCAL_VAZIO);
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  // Formulário do local só aparece depois de clicar em "Adicionar local e horário"
  const [mostrarFormLocal, setMostrarFormLocal] = useState(false);
  // Índice do local em edição (null = adicionando um novo)
  const [editIndexLocal, setEditIndexLocal] = useState<number | null>(null);

  const [especiesEmpresa, setEspeciesEmpresa] = useState<number[]>([]);
  useEffect(() => {
    const url = equipeId ? `/equipes/especies-atendidas?equipeId=${equipeId}` : '/equipes/especies-atendidas';
    api.get(url)
      .then(res => {
        const lista = res.data?.dados?.especiesAtendidas ?? [];
        setEspeciesEmpresa(Array.isArray(lista) ? lista : []);
      })
      .catch(() => setEspeciesEmpresa([]));
  }, [equipeId]);

  // Expediente da EMPRESA — todo membro fica restrito a esses dias/horário
  const [expedienteEmpresa, setExpedienteEmpresa] = useState<{ dias: number[] | null; ini: string | null; fim: string | null }>({ dias: null, ini: null, fim: null });
  useEffect(() => {
    if (!comExpediente) return;
    const url = equipeId ? `/equipes/horario-atendimento?equipeId=${equipeId}` : '/equipes/horario-atendimento';
    api.get(url)
      .then(res => {
        const d = res.data?.dados;
        if (!d) return;
        setExpedienteEmpresa({
          dias: d.diasAtendimento ? String(d.diasAtendimento).split(',').map(Number).filter((n: number) => n >= 0 && n <= 6) : null,
          ini:  d.horaInicioAtendimento || null,
          fim:  d.horaFimAtendimento    || null,
        });
      })
      .catch(() => {});
  }, [comExpediente, equipeId]);

  // Mapa id→nome de especialidade — para exibir os nomes nas linhas de local já adicionadas
  const [espNomeById, setEspNomeById] = useState<Record<number, string>>({});
  useEffect(() => {
    api.get('/especialidades')
      .then(res => {
        const lista: Array<{ id: number; nome: string }> = res.data?.dados ?? [];
        const m: Record<number, string> = {};
        for (const e of lista) m[e.id] = e.nome;
        setEspNomeById(m);
      })
      .catch(() => {});
  }, []);

  // Valida um local contra o expediente da EMPRESA (dias + horário). Retorna a
  // mensagem de erro se extrapolar; null se estiver dentro (ou empresa sem restrição).
  const validarExpedienteEmpresa = (local: LocalTrabalhoForm): string | null => {
    const { dias, ini, fim } = expedienteEmpresa;
    const nomeDia = (n: number) => DIAS_SEMANA_TRAB.find(x => x.v === n)?.l ?? String(n);
    if (dias && dias.length > 0) {
      const fora = local.diasTrabalho.filter(d => !dias.includes(d));
      if (fora.length > 0) {
        return `Dias fora do expediente da empresa (permitido: ${[...dias].sort((a, b) => a - b).map(nomeDia).join(', ')}).`;
      }
    }
    if (ini && local.horaInicioTrabalho && local.horaInicioTrabalho < ini) {
      return `Entrada antes do expediente da empresa (a partir de ${ini}).`;
    }
    if (fim && local.horaFimTrabalho && local.horaFimTrabalho > fim) {
      return `Saída após o expediente da empresa (até ${fim}).`;
    }
    return null;
  };

  useEffect(() => {
    if (!mostrarSeletorFornecedor || fornecedores.length > 0 || loadingFornecedores) return;
    let cancelado = false;
    (async () => {
      setLoadingFornecedores(true);
      try {
        const res = await api.get('/cadastro/fornecedores');
        if (cancelado) return;
        const lista = (res.data?.dados ?? []) as FornecedorDisponivel[];
        setFornecedores(lista.filter(f => f.ativo && !f.userId));
      } catch { /* silencioso */ }
      finally { if (!cancelado) setLoadingFornecedores(false); }
    })();
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mostrarSeletorFornecedor]);

  const selecionarFornecedor = (id: number | '') => {
    setFornecedorId(id);
    setCriandoNovo(false);
    if (id === '') return;
    const f = fornecedores.find(x => x.id === id);
    if (!f) return;
    setForm(prev => ({
      ...prev,
      fullName: f.nome,
      email:    f.email    ?? prev.email,
      phone:    f.telefone ?? prev.phone,
    }));
  };

  const set = (field: keyof UsuarioFormValues, value: string | boolean | string[]) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const toggleCargo = (valor: string, checked: boolean) => {
    const atual = form.cargos ?? [form.perfil];
    const next = checked ? [...atual, valor] : atual.filter(c => c !== valor);
    if (next.length === 0) return;
    setForm(prev => ({ ...prev, cargos: next, perfil: next[0] }));
  };

  // Inclui o perfil legado do usuário em edição para o select renderizar corretamente
  const opcoesPerfil = PERFIS_LEGADOS[form.perfil]
    ? [...PERFIS_ACESSO, { value: form.perfil, label: PERFIS_LEGADOS[form.perfil] }]
    : PERFIS_ACESSO;

  const buscarCep = async (cepValue?: string) => {
    const cep = (cepValue ?? form.cep).replace(/\D/g, '');
    setErroInline(null);
    if (cep.length !== 8) { setErroInline('CEP inválido'); return; }
    setBuscandoCEP(true);
    try {
      const res  = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = await res.json();
      if (data.erro) { setErroInline('CEP não encontrado'); return; }
      setForm(prev => ({
        ...prev,
        endereco: data.logradouro ?? '',
        bairro:   data.bairro     ?? '',
        cidade:   data.localidade ?? '',
        estado:   data.uf         ?? '',
      }));
    } catch {
      setErroInline('Erro ao buscar CEP');
    } finally { setBuscandoCEP(false); }
  };

  const handleSubmit = () => {
    setErroSenhaLocal('');
    setErroInline(null);
    if (!form.fullName.trim())     { setErroInline('Informe o nome');           return; }
    if (!form.email.trim())        { setErroInline('Informe o e-mail');         return; }
    if (!isValidEmail(form.email)) { setErroInline('Informe um e-mail válido'); return; }
    if (!form.phone.trim())                          { setErroInline('Informe o telefone'); return; }
    if (form.phone.replace(/\D/g, '').length < 10)  { setErroInline('Telefone inválido');  return; }
    const cargosFinais = form.cargos ?? [form.perfil];
    if (permitirMultiCargos && cargosFinais.length === 0) {
      setErroInline('Selecione ao menos um perfil de acesso'); return;
    }
    if (permitirSenha && form.senha) {
      const erroSenha = validarSenha(form.senha);
      if (erroSenha) { setErroSenhaLocal(erroSenha); return; }
    }
    const perfilFinal = cargosFinais[0];
    const enviaEspec = perfilFinal === 'VETERINARIO' || perfilFinal === 'FORNECEDOR';
    // Absorve um local preenchido mas ainda não adicionado (mesma cortesia da
    // prescrição, que aproveita o item do formulário ao salvar).
    let locaisTrabalho = form.locaisTrabalho ?? [];
    if (comExpediente && rascunhoLocal.localizacaoId) {
      if (rascunhoLocal.horaInicioTrabalho && rascunhoLocal.horaFimTrabalho
          && rascunhoLocal.horaInicioTrabalho >= rascunhoLocal.horaFimTrabalho) {
        setErroInline('A hora de entrada deve ser menor que a de saída no local em preenchimento.'); return;
      }
      // Ao editar, ignora o próprio item (ele será substituído, não duplicado)
      const outros = editIndexLocal === null ? locaisTrabalho : locaisTrabalho.filter((_, i) => i !== editIndexLocal);
      if (outros.some(l => l.localizacaoId === rascunhoLocal.localizacaoId)) {
        setErroInline('O local em preenchimento já foi adicionado.'); return;
      }
      const foraEmp = validarExpedienteEmpresa(rascunhoLocal);
      if (foraEmp) { setErroInline(foraEmp); return; }
      locaisTrabalho = editIndexLocal === null
        ? [...locaisTrabalho, rascunhoLocal]
        : locaisTrabalho.map((x, i) => i === editIndexLocal ? rascunhoLocal : x);
    }
    // Ninguém está em dois lugares ao mesmo tempo (mesma checagem do backend)
    if (comExpediente) {
      const conflito = conflitoEntreLocais(locaisTrabalho);
      if (conflito) { setErroInline(conflito); return; }
      // Todo membro fica restrito ao dia/horário da empresa (reforço em todos os locais)
      for (const l of locaisTrabalho) {
        const fe = validarExpedienteEmpresa(l);
        if (fe) { setErroInline(fe); return; }
      }
    }
    // Especialidades do profissional: COM locais (Equipe) = união das especialidades
    // dos locais; SEM locais (Usuários/admin) = seletor standalone.
    const uniaoEspec = comExpediente
      ? uniaoEspecialidadesLocais(locaisTrabalho)
      : (form.especialidadeIds ?? []);
    if (enviaEspec && !modoEdicao && uniaoEspec.length === 0) {
      setErroInline(comExpediente
        ? 'Selecione ao menos uma especialidade em algum local de trabalho'
        : 'Selecione ao menos uma especialidade');
      return;
    }
    // Transição/legado: com expediente e NENHUMA especialidade por local, não envia
    // especialidadeIds (evita apagar as especialidades já cadastradas do profissional).
    const especEnviar = comExpediente && uniaoEspec.length === 0 ? undefined : uniaoEspec;
    onSubmit({
      ...form,
      locaisTrabalho,
      fullName:     form.fullName.trim(),
      email:        form.email.trim().toLowerCase(),
      phone:        form.phone.trim(),
      cargos:       cargosFinais,
      perfil:       perfilFinal,
      fornecedorId: mostrarSeletorFornecedor && fornecedorId !== '' ? fornecedorId : null,
      tipoServico:  undefined,
      especialidadeIds: enviaEspec ? especEnviar : undefined,
    });
  };

  return (<>
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-2xl max-h-[92vh] flex flex-col border border-gray-100">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <Users size={18} className="text-emerald-600" />
            {titulo}
          </h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* ── Dados Pessoais ── */}
          <section>
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <UserIcon size={12} /> Dados Pessoais
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {!ocultarPerfil && <div className="sm:col-span-2">
                <label className={labelCls}>Perfil de acesso *</label>
                {permitirMultiCargos ? (
                  <div className="flex flex-wrap gap-2 mt-0.5">
                    {PERFIS_ACESSO.map(p => {
                      const sel = (form.cargos ?? [form.perfil]).includes(p.value);
                      return (
                        <label key={p.value} className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer select-none text-sm transition-colors ${
                          sel ? 'border-emerald-500 bg-emerald-50 text-emerald-700 font-medium' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}>
                          <input type="checkbox" checked={sel}
                            onChange={e => { toggleCargo(p.value, e.target.checked); }}
                            className="w-3.5 h-3.5 accent-emerald-600" />
                          {p.label}
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <select value={form.perfil}
                    onChange={e => {
                      const val = e.target.value;
                      setFornecedorId(''); setCriandoNovo(false);
                      if (modoEdicao) {
                        set('perfil', val); set('cargos', [val]);
                      } else {
                        // Inclusão: trocar o perfil zera o formulário (evita dados do perfil
                        // anterior — fornecedor selecionado, especialidades, etc.).
                        setForm({ ...FORM_VAZIO, perfil: val, cargos: [val] });
                      }
                    }}
                    className={inputCls}>
                    {opcoesPerfil.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                )}
              </div>}

              {/* Seletor de fornecedor existente */}
              {mostrarSeletorFornecedor && (
                <div className="sm:col-span-2 space-y-2">
                  {loadingFornecedores ? (
                    <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
                      <Loader2 size={12} className="animate-spin" /> Buscando fornecedores…
                    </div>
                  ) : (
                    <select value={fornecedorId}
                      onChange={e => selecionarFornecedor(e.target.value === '' ? '' : Number(e.target.value))}
                      className={inputCls}>
                      <option value="">Selecionar fornecedor existente…</option>
                      {fornecedores.map(f => (
                        <option key={f.id} value={f.id}>{f.nome}{f.tipoServico ? ` · ${f.tipoServico}` : ''}</option>
                      ))}
                    </select>
                  )}
                  <button type="button"
                    onClick={() => setCriandoNovo(true)}
                    className="flex items-center gap-1.5 text-xs text-emerald-600 hover:text-emerald-800 font-medium transition-colors">
                    <Plus size={13} />
                    Incluir novo fornecedor
                  </button>
                </div>
              )}

              <>
                  <div className="sm:col-span-2">
                    <label className={labelCls}>Nome completo *</label>
                    <input type="text" value={form.fullName}
                      onChange={e => set('fullName', e.target.value)}
                      placeholder="Nome do usuário" className={inputCls} />
                  </div>

                  <div>
                    <label className={labelCls}>E-mail *</label>
                    <input type="email" value={form.email}
                      onChange={e => set('email', e.target.value)}
                      disabled={emailBloqueado}
                      title={emailBloqueado ? 'O e-mail de acesso não pode ser alterado aqui' : undefined}
                      placeholder="email@exemplo.com"
                      className={`${inputCls} ${emailBloqueado ? 'bg-gray-50 text-gray-400 cursor-not-allowed' : ''}`} />
                  </div>

                  <div>
                    <label className={labelCls}>Telefone *</label>
                    <input type="text" value={form.phone}
                      onChange={e => set('phone', mascaraTelefone(e.target.value))}
                      placeholder="(00) 00000-0000" className={inputCls} />
                  </div>

                  {modoEdicao && permitirSenha && (
                    <div>
                      <label className={labelCls}>Nova senha (em branco para manter)</label>
                      <div className="relative">
                        <input type={mostrarSenha ? 'text' : 'password'} value={form.senha}
                          onChange={e => { set('senha', e.target.value); setErroSenhaLocal(''); }}
                          placeholder="Nova senha..."
                          autoComplete="new-password"
                          className={`${inputCls} pr-10`} />
                        <button type="button" onClick={() => setMostrarSenha(v => !v)}
                          title={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                          {mostrarSenha ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                      {(erroSenhaLocal || erroSenhaServidor) ? (
                        <InlineError message={erroSenhaLocal || erroSenhaServidor} className="mt-1.5" />
                      ) : (
                        <div className="flex items-center gap-1.5 mt-1.5 text-xs text-gray-400">
                          <AlertCircle size={11} />
                          Mín. 8 caracteres, com maiúscula, número e especial.
                        </div>
                      )}
                    </div>
                  )}

                  {/* Especialidade standalone só quando NÃO há locais (Usuários/admin).
                      Com expediente (Equipe), a especialidade é definida POR LOCAL. */}
                  {mostrarEspecialidades && !comExpediente && (
                    <div className="sm:col-span-2">
                      <label className={labelCls}>Especialidade *</label>
                      <EspecialidadeSelector
                        variant="dropdown"
                        value={form.especialidadeIds ?? []}
                        onChange={ids => setForm(prev => ({ ...prev, especialidadeIds: ids }))}
                        especieIds={especiesEmpresa}
                        emptyText="A empresa ainda não configurou as espécies atendidas (Configurações)."
                      />
                    </div>
                  )}

                  {!modoEdicao && (
                    <div className="sm:col-span-2">
                      <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2.5 text-xs text-emerald-700">
                        <Info size={12} className="flex-shrink-0 mt-0.5" />
                        <span>
                          A senha inicial é a padrão <strong>{SENHA_PADRAO_INICIAL}</strong> —
                          o usuário deverá alterá-la no primeiro acesso.
                        </span>
                      </div>
                    </div>
                  )}

                  {modoEdicao && (
                    <div className="sm:col-span-2 flex items-center gap-3 pt-1">
                      <input type="checkbox" id="ativo-modal" checked={form.ativo}
                        onChange={e => set('ativo', e.target.checked)}
                        className="w-4 h-4 accent-emerald-600" />
                      <label htmlFor="ativo-modal" className="text-sm font-medium text-gray-700">
                        Usuário ativo
                      </label>
                    </div>
                  )}
                </>
            </div>
          </section>

          {/* ── Locais de trabalho (dias + horário por local) ──
              Padrão da prescrição: um formulário em linha (local · dias · horas) →
              "Adicionar" empurra para a lista compacta acima e limpa o formulário. */}
          {comExpediente && (
            <section>
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <MapPin size={12} /> Locais de trabalho
              </h4>

              {/* Locais já adicionados — cada um em UMA linha */}
              {(form.locaisTrabalho ?? []).length > 0 ? (
                <div className="space-y-1.5 mb-3">
                  {(form.locaisTrabalho ?? []).map((lt, idx) => (
                    <div key={idx} className="flex items-start gap-2 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
                      <MapPin size={13} className="text-emerald-600 flex-shrink-0 mt-1" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-800 truncate">{lt.localizacaoNome || `Local #${lt.localizacaoId}`}</span>
                          {resumoLocal(lt) && <span className="text-xs text-gray-500 truncate">— {resumoLocal(lt)}</span>}
                        </div>
                        {(lt.especialidadeIds ?? []).length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {lt.especialidadeIds.map(id => (
                              <span key={id} className="text-[10px] bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded-full font-medium">
                                {espNomeById[id] ?? `#${id}`}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button type="button"
                          onClick={() => {
                            setRascunhoLocal(lt);
                            setEditIndexLocal(idx);
                            setErroLocal(null);
                            setMostrarFormLocal(true);
                          }}
                          className="flex items-center gap-1 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors">
                          <Pencil size={13} /> Alterar
                        </button>
                        <button type="button"
                          onClick={() => {
                            setForm(prev => ({
                              ...prev,
                              locaisTrabalho: (prev.locaisTrabalho ?? []).filter((_, i) => i !== idx),
                            }));
                            if (editIndexLocal === idx) { setMostrarFormLocal(false); setEditIndexLocal(null); setRascunhoLocal(RASCUNHO_LOCAL_VAZIO); }
                          }}
                          className="flex items-center gap-1 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                          <Trash2 size={13} /> Excluir
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 mb-3">
                  Nenhum local informado — o profissional herda o expediente da empresa.
                </p>
              )}

              {/* Botão que revela o formulário — os campos só aparecem após o clique */}
              {!mostrarFormLocal && (
                <button type="button"
                  onClick={() => { setErroLocal(null); setEditIndexLocal(null); setRascunhoLocal(RASCUNHO_LOCAL_VAZIO); setMostrarFormLocal(true); }}
                  className="flex items-center gap-1.5 px-3 py-2 border border-emerald-200 text-emerald-700 rounded-xl text-xs font-semibold hover:bg-emerald-50 transition-colors">
                  <Plus size={13} /> Adicionar local e horário de trabalho
                </button>
              )}

              {/* Formulário do novo local: local · dias · horas · especialidades */}
              {mostrarFormLocal && (
              <div className="p-3 bg-gray-50/60 border border-gray-200 rounded-2xl space-y-3">
                <div className="flex flex-wrap items-end gap-2">
                <div className="flex-1 min-w-[160px]">
                  <label className={labelCls}>Local</label>
                  <LocalizacaoCombobox
                    value={rascunhoLocal.localizacaoId || null}
                    nome={rascunhoLocal.localizacaoNome}
                    onSelect={(id, nome) => { setErroLocal(null); setRascunhoLocal(r => ({ ...r, localizacaoId: id, localizacaoNome: nome })); }}
                  />
                </div>
                <div className="min-w-[180px]">
                  <label className={labelCls}>Dias da semana</label>
                  <div className="flex flex-wrap gap-1">
                    {DIAS_SEMANA_TRAB.map(d => {
                      const on = rascunhoLocal.diasTrabalho.includes(d.v);
                      return (
                        <button key={d.v} type="button"
                          onClick={() => { setErroLocal(null); setRascunhoLocal(r => ({
                            ...r,
                            diasTrabalho: on ? r.diasTrabalho.filter(x => x !== d.v)
                                             : [...r.diasTrabalho, d.v].sort((a, b) => a - b),
                          })); }}
                          className={`px-2 py-1 rounded-lg text-xs font-bold border transition-colors ${
                            on ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                          }`}>
                          {d.l}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="w-24">
                  <label className={labelCls}>Entra às</label>
                  <HoraInput value={rascunhoLocal.horaInicioTrabalho}
                    onChange={v => { setErroLocal(null); setRascunhoLocal(r => ({ ...r, horaInicioTrabalho: v })); }}
                    className={inputCls} />
                </div>
                <div className="w-24">
                  <label className={labelCls}>Sai às</label>
                  <HoraInput value={rascunhoLocal.horaFimTrabalho}
                    onChange={v => { setErroLocal(null); setRascunhoLocal(r => ({ ...r, horaFimTrabalho: v })); }}
                    className={inputCls} />
                </div>
                </div>

                {/* Especialidades exercidas NESTE local (multi-seleção) */}
                {mostrarEspecialidades && (
                  <div>
                    <label className={labelCls}>Especialidades neste local</label>
                    <EspecialidadeSelector
                      variant="dropdown"
                      value={rascunhoLocal.especialidadeIds}
                      onChange={ids => { setErroLocal(null); setRascunhoLocal(r => ({ ...r, especialidadeIds: ids })); }}
                      especieIds={especiesEmpresa}
                      emptyText="A empresa ainda não configurou as espécies atendidas (Configurações)."
                    />
                  </div>
                )}

                <div className="flex justify-end gap-2">
                <button type="button"
                  onClick={() => { setMostrarFormLocal(false); setRascunhoLocal(RASCUNHO_LOCAL_VAZIO); setErroLocal(null); setEditIndexLocal(null); }}
                  className="px-3 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-xs font-semibold hover:bg-gray-100">
                  Cancelar
                </button>
                <button type="button"
                  onClick={() => {
                    if (!rascunhoLocal.localizacaoId) { setErroLocal('Selecione o local'); return; }
                    if (rascunhoLocal.horaInicioTrabalho && rascunhoLocal.horaFimTrabalho
                        && rascunhoLocal.horaInicioTrabalho >= rascunhoLocal.horaFimTrabalho) {
                      setErroLocal('A hora de entrada deve ser menor que a de saída'); return;
                    }
                    // Ao editar, ignora o próprio item (não conflita consigo mesmo)
                    const outros = (form.locaisTrabalho ?? []).filter((_, i) => i !== editIndexLocal);
                    // Mesmo local não se repete; horários não podem coincidir
                    const jaTem = outros.some(l => l.localizacaoId === rascunhoLocal.localizacaoId);
                    if (jaTem) { setErroLocal('Este local já foi adicionado'); return; }
                    const conflito = conflitoEntreLocais([...outros, rascunhoLocal]);
                    if (conflito) { setErroLocal(conflito); return; }
                    // Todo membro fica restrito ao dia/horário da empresa
                    const foraEmpresa = validarExpedienteEmpresa(rascunhoLocal);
                    if (foraEmpresa) { setErroLocal(foraEmpresa); return; }
                    setForm(prev => ({
                      ...prev,
                      locaisTrabalho: editIndexLocal === null
                        ? [...(prev.locaisTrabalho ?? []), rascunhoLocal]
                        : (prev.locaisTrabalho ?? []).map((x, i) => i === editIndexLocal ? rascunhoLocal : x),
                    }));
                    setRascunhoLocal(RASCUNHO_LOCAL_VAZIO);
                    setErroLocal(null);
                    setMostrarFormLocal(false); // some após adicionar/salvar; volta o botão
                    setEditIndexLocal(null);
                  }}
                  className="px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-semibold">
                  {editIndexLocal === null ? 'Adicionar' : 'Salvar'}
                </button>
                </div>
              </div>
              )}
              {erroLocal && <p className="text-xs text-red-600 mt-1.5">{erroLocal}</p>}
            </section>
          )}

          {/* ── Endereço ── */}
          <section>
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <MapPin size={12} /> Endereço
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>CEP</label>
                <div className="relative">
                  <input type="text" value={form.cep}
                    onChange={e => {
                      const masked = mascaraCEP(e.target.value);
                      set('cep', masked);
                      if (masked.replace(/\D/g, '').length === 8) buscarCep(masked);
                    }}
                    placeholder="00000-000"
                    className={`${inputCls} pr-8`} />
                  {buscandoCEP && <Loader2 size={12} className="animate-spin text-emerald-600 absolute right-3 top-1/2 -translate-y-1/2" />}
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Endereço</label>
                <input type="text" value={form.endereco}
                  onChange={e => set('endereco', e.target.value)}
                  placeholder="Rua, av., rodovia..." className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Complemento</label>
                <input type="text" value={form.complemento}
                  onChange={e => set('complemento', e.target.value)}
                  placeholder="Apto, sala..." className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Bairro</label>
                <input type="text" value={form.bairro}
                  onChange={e => set('bairro', e.target.value)}
                  placeholder="Bairro" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Cidade</label>
                <input type="text" value={form.cidade}
                  onChange={e => set('cidade', e.target.value)}
                  placeholder="Cidade" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Estado</label>
                <input type="text" value={form.estado}
                  onChange={e => set('estado', e.target.value.toUpperCase().slice(0, 2))}
                  placeholder="SP" maxLength={2} className={inputCls} />
              </div>
            </div>
          </section>

          {/* Nota informativa */}
          {infoNota && (
            <div className="flex items-start gap-2 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5 text-xs text-gray-500">
              <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
              <span>{infoNota}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <InlineError message={erroInline} className="mx-5 mt-3 flex-shrink-0" />

        <div className="flex gap-3 px-5 pb-5 pt-3 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose} disabled={salvando}
            className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={handleSubmit} disabled={salvando}
            className="flex-1 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2">
            {salvando && <Loader2 size={13} className="animate-spin" />}
            {salvando ? 'Salvando…' : textoBotao ?? (modoEdicao ? 'Atualizar' : 'Criar Usuário')}
          </button>
        </div>
      </div>
    </div>

    {criandoNovo && mostrarSeletorFornecedor && (
      <ModalNovoFornecedor
        onClose={() => setCriandoNovo(false)}
        onSalvo={(result: NovoFornecedorResult) => {
          // Fornecedor criado — inclui imediatamente na equipe e fecha tudo
          setCriandoNovo(false);
          onSubmit({
            fullName:     result.nome,
            email:        result.email ?? '',
            phone:        result.telefone ?? '',
            perfil:       'FORNECEDOR',
            cargos:       ['FORNECEDOR'],
            senha:        '',
            ativo:        true,
            cep: '', endereco: '', complemento: '', bairro: '', cidade: '', estado: '',
            fornecedorId: result.id,
            tipoServico:  undefined,
          });
        }}
      />
    )}
  </>
  );
}
