import { useState } from 'react';
import { Link } from 'react-router-dom';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess(false);

    const emailLower = email.trim().toLowerCase();

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailLower }),
      });

      if (res.ok) {
        setSuccess(true);
      } else {
        const data = await res.json();
        setError(data.error || 'Erro ao enviar link de recuperação');
      }
    } catch (err) {
      setError('Erro de conexão com o servidor');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="bg-white text-gray-900 w-full max-w-md rounded-3xl shadow-2xl p-10 text-center">
          <h1 className="text-3xl font-bold mb-4 text-emerald-600">Link enviado!</h1>
          <p className="text-gray-600 mb-8">
            Enviamos um link de recuperação de senha para <strong>{email}</strong>.<br />
            Verifique sua caixa de entrada (e também a pasta de spam).
          </p>
          <Link
            to="/login"
            className="inline-block bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-4 rounded-3xl text-lg font-semibold"
          >
            Voltar para o Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="bg-white text-gray-900 w-full max-w-md rounded-3xl shadow-2xl p-10">
        <h1 className="text-3xl font-bold text-center mb-2">Esqueci minha senha</h1>
        <p className="text-center text-gray-500 mb-8">
          Digite seu e-mail e enviaremos um link para redefinir sua senha.
        </p>

        <form onSubmit={handleSubmit} className="space-y-6">
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

          {error && <p className="text-red-500 text-sm text-center font-medium">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-400 text-white py-4 rounded-3xl text-lg font-semibold transition-colors"
          >
            {loading ? 'Enviando link...' : 'Enviar link de recuperação'}
          </button>
        </form>

        <p className="text-center text-gray-500 mt-8">
          Lembrou a senha?{' '}
          <Link to="/login" className="text-emerald-600 font-medium hover:underline">
            Voltar para o Login
          </Link>
        </p>
      </div>
    </div>
  );
}