// src/pages/Login.tsx
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { useAuth } from '../contexts/AuthContext';
import { AlertCircle } from 'lucide-react';

export default function Login() {
  const { login }  = useAuth();
  const navigate   = useNavigate();
  const location   = useLocation();

  const searchParams = new URLSearchParams(location.search);
  const returnUrl    = searchParams.get('returnUrl');
  const msg          = searchParams.get('msg');

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotEmail,     setForgotEmail]     = useState('');
  const [forgotLoading,   setForgotLoading]   = useState(false);
  const [forgotSuccess,   setForgotSuccess]   = useState(false);
  const [forgotError,     setForgotError]     = useState('');

  const redirecionarAposLogin = () => {
    if (returnUrl) {
      navigate(decodeURIComponent(returnUrl), { replace: true });
    } else {
      navigate('/', { replace: true });
    }
  };

  const handleGoogleSuccess = async (credentialResponse: { credential?: string }) => {
    if (!credentialResponse?.credential) {
      alert('Google não retornou o token.');
      return;
    }
    try {
      const res  = await fetch('/api/auth/google', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ credential: credentialResponse.credential }),
      });
      const data = await res.json();
      if (res.ok && data.token) {
        login(data.token);
        localStorage.removeItem('s2vet_ob');
        redirecionarAposLogin();
      } else {
        alert(data.error || 'Erro no login Google');
      }
    } catch (err) {
      console.error('Erro ao processar login Google:', err);
      alert('Erro de conexão com o servidor.');
    }
  };

  const handleGoogleError = () => {
    alert('Falha ao conectar com Google. Tente novamente.');
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res  = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (res.ok) {
        login(data.token);
        localStorage.removeItem('s2vet_ob');
        redirecionarAposLogin();
      } else {
        setError('Usuário ou senha inválidos');
      }
    } catch {
      setError('Erro de conexão com o servidor');
    } finally {
      setLoading(false);
    }
  };

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

        <h1 className="text-2xl sm:text-3xl font-bold text-center mb-4 sm:mb-6">
          Faça login na sua conta
        </h1>

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
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 sm:py-3 rounded-3xl border border-gray-300
                         focus:outline-none focus:border-emerald-500 text-sm sm:text-base"
              required
            />
          </div>

          {error && (
            <p className="text-red-500 text-sm text-center font-medium">{error}</p>
          )}

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

        <GoogleLogin
          onSuccess={handleGoogleSuccess}
          onError={handleGoogleError}
          useOneTap={false}
          theme="outline"
          size="large"
          text="continue_with"
          shape="rectangular"
          width="100%"
        />

        <p className="text-center text-gray-500 text-sm mt-4 sm:mt-6">
          Não tem uma conta?{' '}
          <Link to="/register" className="text-emerald-600 font-medium hover:underline">
            Cadastrar-se
          </Link>
        </p>
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
              {forgotError && (
                <p className="text-red-500 text-sm text-center mt-3">{forgotError}</p>
              )}
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