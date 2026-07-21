// src/pages/AlterarSenhaObrigatoria.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import { KeyRound, Eye, EyeOff, Check, X } from 'lucide-react';
import InlineError from '../components/InlineError';

const REGRAS = [
  { label: 'Mínimo 8 caracteres',            ok: (s: string) => s.length >= 8 },
  { label: 'Pelo menos uma letra maiúscula',  ok: (s: string) => /[A-Z]/.test(s) },
  { label: 'Pelo menos 1 número',             ok: (s: string) => /[0-9]/.test(s) },
  { label: 'Pelo menos 1 caractere especial', ok: (s: string) => /[^A-Za-z0-9]/.test(s) },
];

export default function AlterarSenhaObrigatoria() {
  const [novaSenha, setNovaSenha]               = useState('');
  const [confirmar, setConfirmar]               = useState('');
  const [salvando, setSalvando]                 = useState(false);
  const [mostrarNova, setMostrarNova]           = useState(false);
  const [mostrarConfirmar, setMostrarConfirmar] = useState(false);
  const [erro, setErro]                         = useState('');
  const { refreshUser } = useAuth();
  const navigate = useNavigate();

  const todasOk        = REGRAS.every(r => r.ok(novaSenha));
  const senhasIguais   = novaSenha === confirmar && confirmar.length > 0;
  const podeSubmeter   = todasOk && senhasIguais;

  const handleSalvar = async () => {
    setErro('');
    if (!todasOk) return setErro('A senha não atende aos requisitos');
    if (!senhasIguais) return setErro('As senhas não coincidem');
    try {
      setSalvando(true);
      await api.patch('/users/me/senha', { novaSenha, obrigatoria: true });
      await refreshUser();
      toast.success('Senha definida! Agora complete o seu cadastro pessoal.');
      localStorage.setItem('s2vet_ob', 'convite');
      navigate('/cadastro-pessoal');
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? err.response?.data?.mensagem ?? 'Não foi possível conectar ao servidor. Tente novamente.'
        : 'Não foi possível conectar ao servidor. Tente novamente.';
      setErro(msg);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8 w-full max-w-md">

        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-emerald-50 rounded-xl">
            <KeyRound className="text-emerald-600" size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Defina uma nova senha</h1>
            <p className="text-sm text-gray-500">Necessário antes de continuar</p>
          </div>
        </div>

        <p className="text-sm text-gray-600 mb-6">
          Sua conta foi criada com uma senha temporária. Defina uma senha
          pessoal para acessar o S2Vet com segurança.
        </p>

        <div className="space-y-4">

          {/* Nova senha */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nova senha
            </label>
            <div className="relative">
              <input
                type={mostrarNova ? 'text' : 'password'}
                value={novaSenha}
                onChange={e => { setNovaSenha(e.target.value); setErro(''); }}
                placeholder="Digite sua nova senha"
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 pr-11 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                type="button"
                onClick={() => setMostrarNova(v => !v)}
                tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {mostrarNova ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>

          {/* Confirmar nova senha */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Confirmar nova senha
            </label>
            <div className="relative">
              <input
                type={mostrarConfirmar ? 'text' : 'password'}
                value={confirmar}
                onChange={e => { setConfirmar(e.target.value); setErro(''); }}
                placeholder="Repita a senha"
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 pr-11 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                type="button"
                onClick={() => setMostrarConfirmar(v => !v)}
                tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {mostrarConfirmar ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
            {confirmar.length > 0 && (
              <p className={`mt-1.5 text-xs flex items-center gap-1 ${senhasIguais ? 'text-emerald-600' : 'text-red-500'}`}>
                {senhasIguais ? <Check size={11} /> : <X size={11} />}
                {senhasIguais ? 'As senhas coincidem' : 'As senhas não coincidem'}
              </p>
            )}
          </div>

          {/* Requisitos */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
            <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Requisitos da senha</p>
            <ul className="space-y-1.5">
              {REGRAS.map(r => {
                const ok = novaSenha.length > 0 && r.ok(novaSenha);
                const erro = novaSenha.length > 0 && !r.ok(novaSenha);
                return (
                  <li key={r.label} className={`flex items-center gap-2 text-xs font-medium ${
                    ok ? 'text-emerald-600' : erro ? 'text-red-500' : 'text-gray-400'
                  }`}>
                    {ok
                      ? <Check size={13} className="flex-shrink-0" />
                      : <X size={13} className="flex-shrink-0" />}
                    {r.label}
                  </li>
                );
              })}
            </ul>
          </div>

          <InlineError message={erro} />

          <button
            onClick={handleSalvar}
            disabled={salvando || !podeSubmeter}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors"
          >
            {salvando ? 'Salvando...' : 'Salvar senha e continuar'}
          </button>
        </div>
      </div>
    </div>
  );
}
