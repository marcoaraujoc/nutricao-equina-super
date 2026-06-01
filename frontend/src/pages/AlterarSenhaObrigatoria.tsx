// src/pages/AlterarSenhaObrigatoria.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import { KeyRound } from 'lucide-react';

export default function AlterarSenhaObrigatoria() {
  const [novaSenha, setNovaSenha]         = useState('');
  const [confirmar, setConfirmar]         = useState('');
  const [salvando, setSalvando]           = useState(false);
  const { refreshUser } = useAuth();      // implementar refreshUser se não existir
  const navigate = useNavigate();

  const handleSalvar = async () => {
    if (novaSenha.length < 8) {
      return toast.error('A senha deve ter ao menos 8 caracteres');
    }
    if (novaSenha !== confirmar) {
      return toast.error('As senhas não coincidem');
    }
    try {
      setSalvando(true);
      await api.patch('/users/me/senha', { novaSenha });
      await refreshUser();
      toast.success('Senha definida! Agora complete o seu cadastro pessoal.');
      localStorage.setItem('s2vet_ob', 'convite');
      navigate('/cadastro-pessoal');
    } catch (error) {
      toast.error('Erro ao salvar senha. Tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8 w-full max-w-md">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-emerald-50 rounded-xl">
            <KeyRound className="text-emerald-600" size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Crie sua senha</h1>
            <p className="text-sm text-gray-500">Necessário antes de continuar</p>
          </div>
        </div>

        <p className="text-sm text-gray-600 mb-6">
          Sua conta foi criada com uma senha temporária. Defina uma senha
          pessoal para acessar o S2Vet com segurança.
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nova senha
            </label>
            <input
              type="password"
              value={novaSenha}
              onChange={e => setNovaSenha(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Confirmar nova senha
            </label>
            <input
              type="password"
              value={confirmar}
              onChange={e => setConfirmar(e.target.value)}
              placeholder="Repita a senha"
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <button
            onClick={handleSalvar}
            disabled={salvando}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-medium py-3 rounded-xl transition-colors"
          >
            {salvando ? 'Salvando...' : 'Salvar senha e continuar'}
          </button>
        </div>
      </div>
    </div>
  );
}