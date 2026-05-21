// src/pages/AprovarVinculoProprietario.tsx
// Rota: /proprietario/aprovar-vinculo?token=X&acao=aceitar|recusar
// Proprietário chega aqui pelo link do email enviado pelo vet.
// Se não estiver logado → redireciona para /login com returnUrl.

import { useEffect, useState, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';

type Estado = 'aguardando_auth' | 'carregando' | 'sucesso_aceito' | 'sucesso_recusado' | 'erro' | 'expirado';

export default function AprovarVinculoProprietario() {
  const [searchParams]              = useSearchParams();
  const navigate                    = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [estado,   setEstado]   = useState<Estado>('aguardando_auth');
  const [mensagem, setMensagem] = useState('');
  const executadoRef            = useRef(false);

  useEffect(() => {
    // Aguarda o AuthContext verificar o token salvo
    if (authLoading) return;

    const token = searchParams.get('token');
    const acao  = searchParams.get('acao');

    if (!token || !acao) {
      setEstado('erro');
      setMensagem('Link inválido. Parâmetros ausentes.');
      return;
    }

    // Não logado → redireciona para login com returnUrl para voltar após autenticação
    if (!user) {
      const returnUrl = encodeURIComponent(
        window.location.pathname + window.location.search
      );
      navigate(`/login?returnUrl=${returnUrl}&msg=login_required_to_approve`, { replace: true });
      return;
    }

    // Logado → processar a solicitação (guard de double-call do Strict Mode)
    if (executadoRef.current) return;
    executadoRef.current = true;

    setEstado('carregando');

    api.post('/animais/proprietario/aprovar', { token, acao })
      .then(res => {
        setEstado(res.data?.aceito ? 'sucesso_aceito' : 'sucesso_recusado');
        setMensagem(res.data?.mensagem ?? '');
      })
      .catch(err => {
        const status = err?.response?.status;
        const msg    = err?.response?.data?.mensagem ?? 'Erro ao processar a solicitação.';
        setEstado(status === 410 ? 'expirado' : 'erro');
        setMensagem(msg);
      });
  }, [authLoading, user, searchParams, navigate]);

  // ── Tela de espera enquanto verifica autenticação ─────────────────────────
  if (estado === 'aguardando_auth' || authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-500 text-sm">Verificando autenticação…</p>
        </div>
      </div>
    );
  }

  if (estado === 'carregando') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-500 text-sm">Processando sua resposta…</p>
        </div>
      </div>
    );
  }

  const config: Record<Exclude<Estado, 'aguardando_auth' | 'carregando'>, {
    bg: string; emoji: string; titulo: string; cor: string;
  }> = {
    sucesso_aceito:   { bg: 'bg-emerald-50', emoji: '✅', titulo: 'Vínculo autorizado!',  cor: 'text-emerald-700' },
    sucesso_recusado: { bg: 'bg-red-50',      emoji: '❌', titulo: 'Vínculo recusado.',    cor: 'text-red-700'     },
    erro:             { bg: 'bg-red-50',      emoji: '⚠️', titulo: 'Erro na solicitação',  cor: 'text-red-700'     },
    expirado:         { bg: 'bg-amber-50',    emoji: '⏰', titulo: 'Link expirado',        cor: 'text-amber-700'   },
  };

  const { bg, emoji, titulo, cor } = config[estado as keyof typeof config] ?? config['erro'];

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-xl border border-gray-100 max-w-md w-full overflow-hidden">

        <div className="bg-emerald-700 px-8 py-6 text-center">
          <h1 className="text-white text-xl font-bold">🐴 S2Vet</h1>
          <p className="text-emerald-200 text-xs mt-1">Sistema Hospitalar Veterinário</p>
        </div>

        <div className={`${bg} px-8 py-10 text-center`}>
          <div className="text-5xl mb-4">{emoji}</div>
          <h2 className={`text-xl font-bold mb-3 ${cor}`}>{titulo}</h2>
          <p className="text-gray-600 text-sm leading-relaxed">{mensagem}</p>

          {estado === 'sucesso_aceito' && (
            <p className="mt-4 text-xs text-gray-400">
              O veterinário receberá uma confirmação por e-mail e poderá
              acompanhar o animal a partir de agora.
            </p>
          )}
          {estado === 'sucesso_recusado' && (
            <p className="mt-4 text-xs text-gray-400">
              O veterinário foi notificado. Você pode atribuir outro
              veterinário pelo aplicativo S2Vet.
            </p>
          )}
          {estado === 'expirado' && (
            <p className="mt-4 text-xs text-gray-400">
              Entre em contato com o veterinário para que ele envie
              uma nova solicitação de vínculo.
            </p>
          )}
          {estado === 'erro' && (
            <p className="mt-4 text-xs text-gray-400">
              Se o problema persistir, entre em contato com o suporte.
            </p>
          )}
        </div>

        <div className="px-8 py-4 border-t border-gray-100 text-center">
          <a href="/" className="text-sm text-emerald-700 font-medium hover:underline">
            Acessar o S2Vet →
          </a>
        </div>
      </div>
    </div>
  );
}