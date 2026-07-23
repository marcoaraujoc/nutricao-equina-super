// src/pages/AceitarConviteEquipe.tsx
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import { Users2, CheckCircle2, XCircle, Loader2, Building2 } from 'lucide-react';
import InlineError from '../components/InlineError';

const LABEL_CARGO: Record<string, string> = {
  VETERINARIO:  'Médico(a) Veterinário(a)',
  ESTAGIARIO:   'Estagiário(a)',
  ADMIN:        'Administrador(a)',
  MEMBRO:       'Membro',
  PROPRIETARIO: 'Proprietário(a)',
};

export default function AceitarConviteEquipe() {
  const { user, refreshUser } = useAuth();
  const [loading, setLoading] = useState(false);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);

  const convite = user?.pendingInvite;

  const handleAceitar = async () => {
    setLoading(true);
    try {
      await api.post('/equipes/convites/auto-aceitar');
      toast.success('Convite aceito! Vamos continuar o seu cadastro.');
      await refreshUser();
      // ProtectedRoute cuida do próximo redirecionamento automaticamente
    } catch {
      setErroInline('Erro ao aceitar convite. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleRecusar = async () => {
    setLoading(true);
    try {
      await api.post('/equipes/convites/recusar-meus');
      toast('Convite recusado.');
      await refreshUser();
    } catch {
      setErroInline('Erro ao recusar convite.');
    } finally {
      setLoading(false);
    }
  };

  if (!convite) return null;

  const isGestor = convite.cargo === 'GESTOR';

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8 w-full max-w-md">

        <InlineError message={erroInline} className="mb-4" />

        {/* Ícone */}
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center">
            <Users2 size={32} className="text-emerald-600" />
          </div>
        </div>

        {/* Título */}
        <h1 className="text-xl font-bold text-gray-900 text-center mb-1">
          {isGestor ? 'Seja bem-vindo à S2Vet' : 'Convite de equipe'}
        </h1>
        <p className="text-sm text-gray-500 text-center mb-6">
          {isGestor
            ? 'Um novo conceito em Administração da sua Empresa'
            : 'Você foi convidado para fazer parte de uma equipe no S2Vet.'}
        </p>

        {/* Card com detalhes do convite */}
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 mb-6 space-y-3">
          {convite.cargo !== 'GESTOR' && (
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Building2 size={15} className="text-emerald-700" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Equipe</p>
                <p className="font-semibold text-gray-900 text-sm">{convite.equipeNome}</p>
              </div>
            </div>
          )}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
              <Users2 size={15} className="text-blue-600" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Função</p>
              <p className="font-semibold text-gray-900 text-sm">
                {LABEL_CARGO[convite.cargo] ?? convite.cargo}
              </p>
            </div>
          </div>
        </div>

        {/* Passos seguintes */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 mb-6">
          <p className="text-xs font-semibold text-blue-700 mb-2">Após aceitar você irá:</p>
          <ol className="text-xs text-blue-600 space-y-1 list-decimal list-inside">
            <li>Definir sua senha pessoal</li>
            <li>Completar seu cadastro na plataforma</li>
            <li>Acessar os recursos da equipe</li>
          </ol>
        </div>

        {/* Botões */}
        <div className="flex flex-col gap-3">
          <button
            onClick={handleAceitar}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-colors"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            {isGestor ? 'Continuar' : 'Aceitar e continuar'}
          </button>
          <button
            onClick={handleRecusar}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 border border-gray-200 hover:bg-gray-50 text-gray-500 font-medium py-2.5 rounded-xl transition-colors text-sm"
          >
            <XCircle size={14} />
            {isGestor ? 'Recusar' : 'Recusar convite'}
          </button>
        </div>

      </div>
    </div>
  );
}