import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { jwtDecode } from 'jwt-decode';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // ==================== GOOGLE ====================
  const handleGoogleSuccess = (credentialResponse: any) => {
    console.log('✅ Google credential recebido:', credentialResponse);

    if (!credentialResponse?.credential) {
      alert('Google não retornou o token.');
      return;
    }

    try {
      const decoded: any = jwtDecode(credentialResponse.credential);

      // Login direto (sem ir para cadastro)
      const payload = {
        id: decoded.sub || Date.now(),
        email: decoded.email,
        fullName: decoded.name || '',
        role: 'USER',
      };

      const fakeToken = btoa(JSON.stringify(payload));

      localStorage.setItem('token', fakeToken);
      login(fakeToken);

      console.log('🎉 Login com Google realizado com sucesso!');
      navigate('/');   // vai direto para o dashboard

    } catch (err) {
      console.error('❌ Erro ao decodificar token:', err);
      alert('Erro ao processar dados do Google.');
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
          <Link to="/register" className="text-emerald-600 font-medium hover:underline">
            Cadastrar-se
          </Link>
        </p>
      </div>
    </div>
  );
}