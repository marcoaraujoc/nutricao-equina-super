import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Modal Esqueci minha senha
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSuccess, setForgotSuccess] = useState(false);
  const [forgotError, setForgotError] = useState('');

  // ==================== GOOGLE ====================
  const handleGoogleSuccess = async (credentialResponse: any) => {
    console.log('✅ Google credential recebido:', credentialResponse);

    if (!credentialResponse?.credential) {
      alert('Google não retornou o token.');
      return;
    }

    try {
      // Envia o credential para o backend gerar o token JWT
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: credentialResponse.credential }),
      });

      const data = await res.json();

      if (res.ok && data.token) {
        login(data.token);                    // ← Token gerado pelo backend
        console.log('🎉 Login Google realizado com sucesso!');
        navigate('/');
      } else {
        console.error('Erro do backend:', data);
        alert(data.error || 'Erro no login Google');
      }
    } catch (err) {
      console.error('❌ Erro ao processar login Google:', err);
      alert('Erro de conexão com o servidor.');
    }
  };

  const handleGoogleError = () => {
    console.error('❌ Google Login Error');
    alert('Falha ao conectar com Google. Tente novamente.');
  };

  // ==================== LOGIN COM E-MAIL ====================
  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (res.ok) {
        login(data.token);
        navigate('/');
      } else {
        setError('Usuário ou senha inválidos');
      }
    } catch (err) {
      setError('Erro de conexão com o servidor');
    } finally {
      setLoading(false);
    }
  };

  // ==================== ESQUECI MINHA SENHA ====================
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotLoading(true);
    setForgotError('');
    setForgotSuccess(false);

    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail.trim().toLowerCase() }),
      });

      setForgotSuccess(true);
    } catch (err) {
      setForgotSuccess(true); // Mostra sucesso mesmo em erro (segurança)
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="bg-white text-gray-900 w-full max-w-md rounded-3xl shadow-2xl p-10">

        <h1 className="text-3xl font-bold text-center mb-8">Faça login na sua conta</h1>

        <form onSubmit={handleEmailLogin} className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-1">E-mail</label>
            <input 
              type="email" 
              value={email} 
              onChange={(e) => setEmail(e.target.value)} 
              className="w-full px-4 py-3 rounded-3xl border border-gray-300 focus:outline-none focus:border-emerald-500" 
              placeholder="seuemail@email.com" 
              required 
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Senha</label>
            <input 
              type="password" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)} 
              className="w-full px-4 py-3 rounded-3xl border border-gray-300 focus:outline-none focus:border-emerald-500" 
              required 
            />
          </div>

          {error && <p className="text-red-500 text-sm text-center font-medium">{error}</p>}

          <button 
            type="submit" 
            disabled={loading} 
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-400 text-white py-4 rounded-3xl text-lg font-semibold transition-colors"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <div className="text-center mt-4">
          <button 
            onClick={() => setShowForgotModal(true)} 
            className="text-emerald-600 hover:underline text-sm"
          >
            Esqueci minha senha
          </button>
        </div>

        <div className="flex items-center gap-3 my-8">
          <div className="flex-1 h-px bg-gray-300"></div>
          <span className="text-gray-400 text-sm">ou</span>
          <div className="flex-1 h-px bg-gray-300"></div>
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

        <p className="text-center text-gray-500 mt-8">
          Não tem uma conta?{' '}
          <Link to="/register" className="text-emerald-600 font-medium hover:underline">Cadastrar-se</Link>
        </p>
      </div>

      {/* MODAL - Esqueci minha senha */}
      {showForgotModal && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
          <div className="bg-white rounded-3xl p-8 w-full max-w-md mx-4 text-gray-900">
            <h2 className="text-2xl font-bold text-center mb-2">Esqueci minha senha</h2>
            <p className="text-gray-500 text-center mb-6">Digite seu e-mail e enviaremos um link de recuperação.</p>

            <form onSubmit={handleForgotPassword}>
              <input
                type="email"
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                placeholder="seuemail@email.com"
                className="w-full px-4 py-3 rounded-3xl border border-gray-300 focus:outline-none focus:border-emerald-500"
                required
              />

              {forgotError && <p className="text-red-500 text-sm text-center mt-3">{forgotError}</p>}
              {forgotSuccess && (
                <p className="text-emerald-600 text-sm text-center mt-3">
                  Se o e-mail existir, será enviado um link de recuperação.
                </p>
              )}

              <button 
                type="submit" 
                disabled={forgotLoading} 
                className="w-full mt-6 bg-emerald-600 hover:bg-emerald-700 text-white py-4 rounded-3xl text-lg font-semibold"
              >
                {forgotLoading ? 'Enviando...' : 'Enviar e-mail'}
              </button>
            </form>

            <button 
              onClick={() => setShowForgotModal(false)} 
              className="mt-6 w-full text-gray-500 hover:text-gray-700 text-sm"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}