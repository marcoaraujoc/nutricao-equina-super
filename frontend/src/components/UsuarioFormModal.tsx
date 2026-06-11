// src/components/UsuarioFormModal.tsx
// Formulário compartilhado de criação/edição de usuário — página única com
// seções (Dados Pessoais / Endereço), mesmo layout do modal de Novo Proprietário.
// Usado em: Usuarios.tsx (Novo/Editar Usuário) e Equipe.tsx (Incluir/Editar Membro).
// Criação sem campo de senha — a senha inicial é a padrão do sistema (Inicial_001),
// com troca obrigatória no primeiro acesso. Em edição, `permitirSenha` exibe o
// campo "Nova senha" (admin: qualquer usuário; sócio: membros da própria equipe).

import { useState } from 'react';
import toast from 'react-hot-toast';
import {
  X, AlertCircle, Info, Eye, EyeOff, Loader2,
  User as UserIcon, MapPin, Users,
} from 'lucide-react';
import { isValidEmail } from '../utils/validators';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface UsuarioFormValues {
  fullName: string;
  email: string;
  phone: string;
  perfil: string;      // VETERINARIO | ESTAGIARIO | PRESTADOR | SOCIO (+ legados em edição)
  senha: string;       // edição com permitirSenha: vazio = não alterar
  ativo: boolean;
  cep: string;
  endereco: string;
  complemento: string;
  bairro: string;
  cidade: string;
  estado: string;
}

export const SENHA_PADRAO_INICIAL = 'Inicial_001';

export const PERFIS_ACESSO: Array<{ value: string; label: string }> = [
  { value: 'VETERINARIO', label: 'Veterinário' },
  { value: 'ESTAGIARIO',  label: 'Estagiário'  },
  { value: 'PRESTADOR',   label: 'Fornecedor'  },
  { value: 'SOCIO',       label: 'Sócio'       },
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

const FORM_VAZIO: UsuarioFormValues = {
  fullName: '', email: '', phone: '', perfil: 'VETERINARIO', senha: '', ativo: true,
  cep: '', endereco: '', complemento: '', bairro: '', cidade: '', estado: '',
};

interface UsuarioFormModalProps {
  titulo: string;
  /** Nota informativa extra exibida acima do rodapé (ex: aviso de inclusão imediata) */
  infoNota?: string;
  /** Edição: oculta a nota de senha padrão e exibe o checkbox "Usuário ativo" */
  modoEdicao?: boolean;
  /** Edição: exibe campo "Nova senha" (admin: todos; sócio: membros da própria equipe) */
  permitirSenha?: boolean;
  /** Desabilita o campo de e-mail (e-mail é o login — edição restrita) */
  emailBloqueado?: boolean;
  initial?: Partial<UsuarioFormValues>;
  salvando: boolean;
  textoBotao?: string;
  onClose: () => void;
  onSubmit: (values: UsuarioFormValues) => void;
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function UsuarioFormModal({
  titulo, infoNota, modoEdicao = false, permitirSenha = false, emailBloqueado = false,
  initial, salvando, textoBotao, onClose, onSubmit,
}: UsuarioFormModalProps) {
  const [form, setForm] = useState<UsuarioFormValues>({ ...FORM_VAZIO, ...initial });
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [buscandoCEP,  setBuscandoCEP]  = useState(false);

  const set = (field: keyof UsuarioFormValues, value: string | boolean) =>
    setForm(prev => ({ ...prev, [field]: value }));

  // Inclui o perfil legado do usuário em edição para o select renderizar corretamente
  const opcoesPerfil = PERFIS_LEGADOS[form.perfil]
    ? [...PERFIS_ACESSO, { value: form.perfil, label: PERFIS_LEGADOS[form.perfil] }]
    : PERFIS_ACESSO;

  const buscarCep = async () => {
    const cep = form.cep.replace(/\D/g, '');
    if (cep.length !== 8) { toast.error('CEP inválido'); return; }
    setBuscandoCEP(true);
    try {
      const res  = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = await res.json();
      if (data.erro) { toast.error('CEP não encontrado'); return; }
      setForm(prev => ({
        ...prev,
        endereco: data.logradouro ?? '',
        bairro:   data.bairro     ?? '',
        cidade:   data.localidade ?? '',
        estado:   data.uf         ?? '',
      }));
    } catch {
      toast.error('Erro ao buscar CEP');
    } finally { setBuscandoCEP(false); }
  };

  const handleSubmit = () => {
    if (!form.fullName.trim())     { toast.error('Informe o nome');           return; }
    if (!form.email.trim())        { toast.error('Informe o e-mail');         return; }
    if (!isValidEmail(form.email)) { toast.error('Informe um e-mail válido'); return; }
    if (!form.phone.trim())        { toast.error('Informe o telefone');       return; }
    if (permitirSenha && form.senha) {
      const erroSenha = validarSenha(form.senha);
      if (erroSenha) { toast.error(erroSenha); return; }
    }
    onSubmit({
      ...form,
      fullName: form.fullName.trim(),
      email:    form.email.trim().toLowerCase(),
      phone:    form.phone.trim(),
    });
  };

  const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500 transition-colors';
  const labelCls = 'block text-xs text-gray-500 mb-1';

  return (
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
                  onChange={e => set('phone', e.target.value)}
                  placeholder="(00) 00000-0000" className={inputCls} />
              </div>

              <div>
                <label className={labelCls}>Perfil de acesso</label>
                <select value={form.perfil} onChange={e => set('perfil', e.target.value)} className={inputCls}>
                  {opcoesPerfil.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>

              {modoEdicao && permitirSenha && (
                <div>
                  <label className={labelCls}>Nova senha (em branco para manter)</label>
                  <div className="relative">
                    <input type={mostrarSenha ? 'text' : 'password'} value={form.senha}
                      onChange={e => set('senha', e.target.value)}
                      placeholder="Nova senha..."
                      autoComplete="new-password"
                      className={`${inputCls} pr-10`} />
                    <button type="button" onClick={() => setMostrarSenha(v => !v)}
                      title={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {mostrarSenha ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5 text-xs text-gray-400">
                    <AlertCircle size={11} />
                    Mín. 8 caracteres, com maiúscula, número e especial.
                  </div>
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
            </div>
          </section>

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
                    onChange={e => set('cep', e.target.value)}
                    onBlur={() => { if (form.cep.replace(/\D/g, '').length === 8) buscarCep(); }}
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
  );
}
