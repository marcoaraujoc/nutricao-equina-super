// src/pages/AprovarVinculo.tsx
import { useEffect, useState, useRef } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react';
import api from '../services/api';

type Estado = 'carregando' | 'aceito' | 'recusado' | 'expirado' | 'ja-respondido' | 'erro';

interface Resultado {
  animalNome: string;
  aceito:     boolean;
}

export default function AprovarVinculo() {
  const [searchParams] = useSearchParams();
  const navigate       = useNavigate();
  const location       = useLocation();
  const [estado,    setEstado]    = useState<Estado>('carregando');
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [msgErro,   setMsgErro]   = useState('');

  // Guard: impede dupla chamada do React 18 Strict Mode em desenvolvimento
  const chamadaFeita = useRef(false);

  const token = searchParams.get('token');
  const acao  = searchParams.get('acao') as 'aceitar' | 'recusar' | null;

  useEffect(() => {
    // Aborta a segunda invocação do Strict Mode
    if (chamadaFeita.current) return;
    chamadaFeita.current = true;

    if (!token || !acao) {
      setEstado('erro');
      setMsgErro('Link inválido. Parâmetros ausentes.');
      return;
    }

    api.get('/veterinarios/solicitacoes/responder-email', { params: { token, acao } })
      .then(res => {
        setResultado({ animalNome: res.data.dados.animalNome, aceito: res.data.dados.aceito });
        setEstado(res.data.dados.aceito ? 'aceito' : 'recusado');
      })
      .catch(err => {
        const status = err?.response?.status;
        const msg    = err?.response?.data?.mensagem ?? '';
        const codigo = err?.response?.data?.codigo   ?? '';

        if (status === 410) {
          setEstado('expirado');
          return;
        }

        if (status === 409) {
          setEstado('ja-respondido');
          setMsgErro(msg);
          return;
        }

        // Usuário logado não é o vet correto — faz logout e redireciona para login
        if (status === 403 && codigo === 'VET_INCORRETO') {
          // Limpa sessão atual completamente
          sessionStorage.removeItem('token');
          localStorage.removeItem('lastSelectedAnimalId');
          localStorage.removeItem('s2vet_ob');

          // Monta returnUrl para voltar à aprovação após login correto. Vem do
          // ROUTER (useLocation): sob HashRouter o window.location.pathname é `/`
          // e o search é vazio — a rota e o token moram no fragmento, então ler
          // window.location devolvia `%2F` e perdia o token. Ver CLAUDE.md §14.
          const returnUrl = encodeURIComponent(location.pathname + location.search);

          navigate(`/login?returnUrl=${returnUrl}&msg=vet_required`, { replace: true });
          return;
        }

        setEstado('erro');
        setMsgErro(msg || 'Ocorreu um erro inesperado.');
      });
  }, [token, acao, navigate, location.pathname, location.search]);

  const ir = () => navigate('/');

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-gray-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-xl max-w-md w-full p-8 text-center">

        {/* Logo */}
        <div className="mb-6">
          <span className="text-4xl">🐴</span>
          <p className="text-lg font-bold text-emerald-700 mt-1">S2Vet</p>
        </div>

        {/* Carregando */}
        {estado === 'carregando' && (
          <div className="py-8">
            <div className="w-12 h-12 border-4 border-emerald-200 border-t-emerald-600 rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-500">Processando sua resposta…</p>
          </div>
        )}

        {/* Aceito */}
        {estado === 'aceito' && (
          <>
            <CheckCircle className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Vínculo aceito!</h2>
            <p className="text-gray-600 mb-8">
              Você agora é o veterinário responsável por{' '}
              <strong className="text-emerald-700">{resultado?.animalNome}</strong>.
            </p>
            <button
              onClick={ir}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 rounded-2xl transition-colors"
            >
              Acessar a plataforma
            </button>
          </>
        )}

        {/* Recusado */}
        {estado === 'recusado' && (
          <>
            <XCircle className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Solicitação recusada</h2>
            <p className="text-gray-600 mb-8">
              Você recusou o vínculo com <strong>{resultado?.animalNome}</strong>.
              O proprietário será notificado.
            </p>
            <button
              onClick={ir}
              className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-3 rounded-2xl transition-colors"
            >
              Ir para a plataforma
            </button>
          </>
        )}

        {/* Link expirado */}
        {estado === 'expirado' && (
          <>
            <Clock className="w-16 h-16 text-amber-400 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Link expirado</h2>
            <p className="text-gray-600 mb-8">
              Este link de aprovação expirou (validade 7 dias).
              Peça ao proprietário que reatribua o veterinário pelo sistema.
            </p>
            <button
              onClick={ir}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 rounded-2xl transition-colors"
            >
              Acessar a plataforma
            </button>
          </>
        )}

        {/* Já respondida */}
        {estado === 'ja-respondido' && (
          <>
            <AlertTriangle className="w-16 h-16 text-amber-400 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Já respondida</h2>
            <p className="text-gray-600 mb-8">{msgErro}</p>
            <button
              onClick={ir}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 rounded-2xl transition-colors"
            >
              Ver na plataforma
            </button>
          </>
        )}

        {/* Erro genérico */}
        {estado === 'erro' && (
          <>
            <XCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Algo deu errado</h2>
            <p className="text-gray-600 mb-8">
              {msgErro || 'Link inválido ou solicitação não encontrada.'}
            </p>
            <button
              onClick={ir}
              className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-3 rounded-2xl transition-colors"
            >
              Ir para a plataforma
            </button>
          </>
        )}

      </div>
    </div>
  );
}