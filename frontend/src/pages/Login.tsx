// src/pages/Login.tsx
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { useAuth } from '../contexts/AuthContext';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';
import InlineError from '../components/InlineError';
import Verificacao2FA from '../components/Verificacao2FA';
import type { DesafioMfa } from '../components/Verificacao2FA';

export default function Login() {
  const { login }  = useAuth();
  const navigate   = useNavigate();
  const location   = useLocation();

  const searchParams = new URLSearchParams(location.search);
  const returnUrl    = searchParams.get('returnUrl');
  const msg          = searchParams.get('msg');

  const [email,        setEmail]        = useState('');
  const [password,     setPassword]     = useState('');
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const [googleError,  setGoogleError]  = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // Desafio de 2FA pendente: com ele preenchido, a tela troca para o código.
  const [desafio2fa,   setDesafio2fa]   = useState<DesafioMfa | null>(null);

  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotEmail,     setForgotEmail]     = useState('');
  const [forgotLoading,   setForgotLoading]   = useState(false);
  const [forgotSuccess,   setForgotSuccess]   = useState(false);
  const [forgotError,     setForgotError]     = useState('');

  // Destino pós-login. Profissional (vet, gestor, estagiário, fornecedor...) vai
  // DIRETO ao Painel Principal — antes passava por `/` (Dashboard), que só
  // redirecionava para lá quando reconhecia o perfil como clínico, deixando os
  // demais numa tela intermediária. O PROPRIETÁRIO mantém `/` (portal do cliente).
  // Cadastro pessoal pendente NAQUELA empresa continua sendo interceptado pelo
  // ProtectedRoute; já confirmado, não aparece mais e o login cai no painel.
  const redirecionarAposLogin = (u?: { userType?: string } | null) => {
    if (returnUrl) {
      navigate(decodeURIComponent(returnUrl), { replace: true });
      return;
    }
    const ehCliente = (u?.userType ?? '').toUpperCase() === 'PROPRIETARIO';
    navigate(ehCliente ? '/' : '/painel-principal', { replace: true });
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setGoogleError('');
    try {
      const res  = await fetch('/api/auth/login', {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (res.ok) {
        // Senha correta, mas ainda falta o segundo fator: nenhum cookie foi
        // emitido — a sessão só nasce após POST /auth/2fa/verificar.
        if (data.mfaRequerido) {
          setDesafio2fa({
            desafioId:       data.desafioId,
            emailMascarado:  data.emailMascarado,
            validadeMinutos: data.validadeMinutos ?? 10,
          });
          return;
        }
        // Backend já setou os cookies HttpOnly — carrega a identidade via /me
        const logado = await login();
        localStorage.removeItem('s2vet_ob');
        redirecionarAposLogin(logado);
      } else if (res.status === 503) {
        setError(data.error ?? 'Não foi possível enviar o código de verificação.');
      } else if (res.status === 429) {
        // Rate limit do /api/auth. Mostrar "usuário ou senha inválidos" aqui era uma
        // ARMADILHA: com a senha CERTA a tela acusava credencial errada, o usuário
        // tentava de novo e cada tentativa renovava o bloqueio.
        setError(data.mensagem ?? data.error
          ?? 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.');
      } else if (res.status >= 500) {
        setError('O servidor não conseguiu processar o login. Tente novamente em instantes.');
      } else {
        setError(data.error ?? data.mensagem ?? 'Usuário ou senha inválidos');
      }
    } catch {
      setError('Erro de conexão com o servidor');
    } finally {
      setLoading(false);
    }
  };

  const loginComGoogle = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      setGoogleError('');
      try {
        const res  = await fetch('/api/auth/google', {
          method:      'POST',
          credentials: 'include',
          headers:     { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_token: tokenResponse.access_token }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          const logado = await login();
          localStorage.removeItem('s2vet_ob');
          redirecionarAposLogin(logado);
        } else {
          setGoogleError(data.error || 'Erro no login Google');
        }
      } catch (err) {
        console.error('Erro ao processar login Google:', err);
        setGoogleError('Erro de conexão com o servidor.');
      }
    },
    onError: () => setGoogleError('Falha ao conectar com Google. Tente novamente.'),
    prompt: 'select_account',
    flow:   'implicit',
  });

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotLoading(true);
    setForgotError('');
    setForgotSuccess(false);
    try {
      await fetch('/api/auth/forgot-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: forgotEmail.trim().toLowerCase() }),
      });
      setForgotSuccess(true);
    } catch {
      setForgotSuccess(true);
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    /*
      h-full        → ocupa 100% da altura do #root (= 100vh)
      overflow-auto → permite scroll APENAS se o conteúdo não couber
                      (ex: telas muito pequenas ou banners de aviso ativos)
    */
    <div className="h-full bg-gray-950 flex items-center justify-center p-4 overflow-auto">

      <div className="bg-white text-gray-900 w-full max-w-md rounded-3xl shadow-2xl
                      px-6 py-6 sm:px-10 sm:py-8">

        {desafio2fa ? (
          <Verificacao2FA
            desafio={desafio2fa}
            onVerificado={async () => {
              const logado = await login();
              localStorage.removeItem('s2vet_ob');
              redirecionarAposLogin(logado);
            }}
            onCancelar={() => { setDesafio2fa(null); setPassword(''); }}
          />
        ) : (
        <>
        <h1 className="text-2xl sm:text-3xl font-bold text-center mb-4 sm:mb-6">
          Faça login na sua conta
        </h1>

        {/* ── Banner: link de recuperação enviado (volta de "Esqueci minha senha") ──
            Repete aqui a confirmação que a tela anterior exibiu antes de redirecionar,
            para quem chega e já não a tem mais na frente. Texto GENÉRICO ("se houver
            uma conta"): confirmar a existência do e-mail permitiria enumerar usuários. */}
        {msg === 'reset_link_enviado' && (
          <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-200
                          rounded-2xl px-4 py-3 text-sm text-emerald-800 mb-4">
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5 text-emerald-600" />
            <span>
              Se houver uma conta com o e-mail informado, enviamos um link para
              redefinir a senha. Verifique a caixa de entrada e a pasta de spam.
            </span>
          </div>
        )}

        {/* ── Banner: proprietário precisa logar para aprovar vínculo ── */}
        {msg === 'login_required_to_approve' && (
          <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-200
                          rounded-2xl px-4 py-3 text-sm text-emerald-800 mb-4">
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5 text-emerald-600" />
            <span>
              Faça login com a sua conta de proprietário para autorizar ou
              recusar o vínculo veterinário. Após o login você será
              redirecionado automaticamente.
            </span>
          </div>
        )}

        {/* ── Banner: vet_required ── */}
        {msg === 'vet_required' && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200
                          rounded-2xl px-4 py-3 text-sm text-amber-700 mb-4">
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
            <span>
              Este link de aprovação pertence a um veterinário específico.{' '}
              <strong>Faça login com a conta do veterinário</strong> para continuar.
            </span>
          </div>
        )}

        <form onSubmit={handleEmailLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">E-mail</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 sm:py-3 rounded-3xl border border-gray-300
                         focus:outline-none focus:border-emerald-500 text-sm sm:text-base"
              placeholder="seuemail@email.com"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Senha</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 sm:py-3 pr-11 rounded-3xl border border-gray-300
                           focus:outline-none focus:border-emerald-500 text-sm sm:text-base"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <InlineError message={error} className="mb-1" />

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-400
                       text-white py-3 sm:py-4 rounded-3xl text-base sm:text-lg
                       font-semibold transition-colors"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <div className="text-center mt-3">
          <button
            onClick={() => setShowForgotModal(true)}
            className="text-emerald-600 hover:underline text-sm"
          >
            Esqueci minha senha
          </button>
        </div>

        <div className="flex items-center gap-3 my-4 sm:my-6">
          <div className="flex-1 h-px bg-gray-300" />
          <span className="text-gray-400 text-sm">ou</span>
          <div className="flex-1 h-px bg-gray-300" />
        </div>

        <button
          type="button"
          onClick={() => loginComGoogle()}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-300
                     rounded-3xl text-sm font-medium text-gray-700 bg-white hover:bg-gray-50
                     transition-colors shadow-sm"
        >
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Entrar com Google
        </button>

        <InlineError message={googleError} className="mt-3" />

        <p className="text-center text-gray-500 text-sm mt-4 sm:mt-6">
          Não tem uma conta?{' '}
          <Link to="/register" className="text-emerald-600 font-medium hover:underline">
            Cadastrar-se
          </Link>
        </p>
        </>
        )}
      </div>

      {/* MODAL — Esqueci minha senha */}
      {showForgotModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl px-6 py-8 sm:p-8 w-full max-w-md text-gray-900">
            <h2 className="text-xl sm:text-2xl font-bold text-center mb-2">
              Esqueci minha senha
            </h2>
            <p className="text-gray-500 text-sm text-center mb-6">
              Digite seu e-mail e enviaremos um link de recuperação.
            </p>
            <form onSubmit={handleForgotPassword}>
              <input
                type="email"
                value={forgotEmail}
                onChange={e => setForgotEmail(e.target.value)}
                placeholder="seuemail@email.com"
                className="w-full px-4 py-3 rounded-3xl border border-gray-300
                           focus:outline-none focus:border-emerald-500 text-sm"
                required
              />
              <InlineError message={forgotError} className="mt-3" />
              {forgotSuccess && (
                <p className="text-emerald-600 text-sm text-center mt-3">
                  Se o e-mail existir, será enviado um link de recuperação.
                </p>
              )}
              <button
                type="submit"
                disabled={forgotLoading}
                className="w-full mt-5 bg-emerald-600 hover:bg-emerald-700
                           text-white py-3 rounded-3xl text-base font-semibold"
              >
                {forgotLoading ? 'Enviando...' : 'Enviar e-mail'}
              </button>
            </form>
            <button
              onClick={() => setShowForgotModal(false)}
              className="mt-4 w-full text-gray-500 hover:text-gray-700 text-sm"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}