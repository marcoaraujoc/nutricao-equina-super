// src/pages/AceitarConvite.tsx
// Rota pública: /convite-equipe?token=xxxx
// Exibe os dados do convite e, se logado, permite aceitar

import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import { CheckCircle2, XCircle, Users } from 'lucide-react';
import InlineError from '../components/InlineError';

interface DadosConvite {
  email: string; cargo: string; cargoLabel: string;
  equipeNome: string; empresaNome: string; token: string;
}

export default function AceitarConvite() {
  const [params]    = useSearchParams();
  const { user }    = useAuth();
  const navigate    = useNavigate();
  const token       = params.get('token') ?? '';

  const [dados,    setDados]    = useState<DadosConvite | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [erro,     setErro]     = useState('');
  const [aceitando,setAceitando]= useState(false);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);
  const [aceito,   setAceito]   = useState(false);

  useEffect(() => {
    if (!token) { setErro('Token de convite inválido.'); setLoading(false); return; }
    api.get(`/equipes/convite/${token}`)
      .then(res => setDados(res.data.dados))
      .catch(err => setErro(err.response?.data?.mensagem ?? 'Convite inválido ou expirado'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleAceitar = async () => {
    if (!user) { navigate(`/login?redirect=/convite-equipe?token=${token}`); return; }
    setAceitando(true);
    setErroInline(null);
    try {
      await api.post(`/equipes/convite/${token}/aceitar`);
      toast.success('Você entrou para a equipe!');
      setAceito(true);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } }).response?.data?.mensagem ?? 'Erro ao aceitar convite';
      setErroInline(msg);
    } finally { setAceitando(false); }
  };

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full" />
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 p-8 max-w-md w-full text-center">

        {erro ? (
          <>
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <XCircle size={32} className="text-red-500" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Convite inválido</h2>
            <p className="text-gray-500 text-sm">{erro}</p>
            <button onClick={() => navigate('/')}
              className="mt-6 w-full bg-emerald-700 hover:bg-emerald-800 text-white py-3.5 rounded-2xl font-semibold transition-colors">
              Ir para o início
            </button>
          </>
        ) : aceito ? (
          <>
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 size={32} className="text-emerald-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Pronto!</h2>
            <p className="text-gray-500 text-sm mb-6">
              Você agora faz parte da equipe <strong className="text-gray-700">{dados?.equipeNome}</strong>.
            </p>
            <button onClick={() => navigate('/')}
              className="w-full bg-emerald-700 hover:bg-emerald-800 text-white py-3.5 rounded-2xl font-semibold transition-colors">
              Acessar S2Vet
            </button>
          </>
        ) : dados ? (
          <>
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Users size={28} className="text-emerald-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Você foi convidado!</h2>
            <div className="bg-gray-50 rounded-2xl p-4 text-left mb-6 space-y-2 border border-gray-100">
              {[
                { l: 'Empresa', v: dados.empresaNome },
                { l: 'Equipe',  v: dados.equipeNome  },
                { l: 'Cargo',   v: dados.cargoLabel  },
                { l: 'E-mail',  v: dados.email        },
              ].map(({ l, v }) => (
                <div key={l} className="flex justify-between items-center text-sm border-b border-gray-100 pb-2 last:border-0 last:pb-0">
                  <span className="text-gray-400 font-medium">{l}</span>
                  <span className="text-gray-900 font-semibold">{v}</span>
                </div>
              ))}
            </div>

            {!user && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-4">
                Você precisa estar logado com o e-mail <strong>{dados.email}</strong> para aceitar.
              </p>
            )}

            <InlineError message={erroInline} className="mb-4 text-left" />

            <button onClick={handleAceitar} disabled={aceitando}
              className="w-full bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white py-3.5 rounded-2xl font-semibold transition-colors">
              {aceitando ? 'Aceitando...' : user ? 'Aceitar convite' : 'Fazer login para aceitar'}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
// ADICIONAR NO App.tsx:
// ═══════════════════════════════════════════════════════════════════

/*
import AceitarConvite   from './pages/AceitarConvite';
import EquipeManager    from './pages/EquipeManager';
import AiUsageDashboard from './pages/AiUsageDashboard';

// Rota pública (fora do ProtectedRoute):
<Route path="/convite-equipe" element={<AceitarConvite />} />

// Rotas protegidas (dentro do bloco protegido):
<Route path="/equipe"    element={<EquipeManager />} />
<Route path="/ai-usage"  element={<AiUsageDashboard />} />
*/

// ═══════════════════════════════════════════════════════════════════
// ADICIONAR NA Sidebar.tsx (dentro do bloco GERAL):
// ═══════════════════════════════════════════════════════════════════

/*
// Para VETERINARIO:
{role === 'VETERINARIO' && (
  <Link to="/equipe" className="...">
    <Users size={20} /> Minha Equipe
  </Link>
)}

// Para ADMIN:
<Link to="/ai-usage" className="...">
  <Zap size={20} /> Monitoramento IA
</Link>
*/