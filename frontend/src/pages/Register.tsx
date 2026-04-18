import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function Register() {
  const location = useLocation();
  const navigate = useNavigate();
  const { login } = useAuth();

  const googleData = location.state || {};

  const [form, setForm] = useState({
    fullName: googleData.fullName || '',
    email: googleData.email || '',
    phone: '',
    userType: 'PROPRIETARIO' as 'PROPRIETARIO' | 'VETERINARIO',
    password: '',
  });

  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: form.fullName,
          email: form.email,
          password: form.password,
          phone: form.phone,
          userType: form.userType,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        alert('✅ Cadastro realizado com sucesso!');

        // Se veio do Google, faz login automático
        if (googleData.fromGoogle) {
          // Chama o login automático (backend não retorna token no register)
          const loginRes = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: form.email, password: form.password }),
          });

          const loginData = await loginRes.json();
          if (loginRes.ok) {
            login(loginData.token);
            navigate('/');
          } else {
            navigate('/login');
          }
        } else {
          navigate('/login');
        }
      } else {
        alert(data.error || 'Erro ao cadastrar usuário');
      }
    } catch (err) {
      console.error(err);
      alert('Erro de conexão com o servidor');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="bg-white text-gray-900 w-full max-w-md rounded-3xl shadow-2xl p-10">
        <h1 className="text-3xl font-bold text-center mb-8">
          {googleData.fromGoogle ? 'Complete seu cadastro' : 'Crie sua conta'}
        </h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-1">Nome completo</label>
            <input
              type="text"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              className="w-full px-4 py-3 rounded-3xl border border-gray-300 focus:outline-none focus:border-emerald-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">E-mail</label>
            <input
              type="email"
              value={form.email}
              disabled={!!googleData.email}
              className="w-full px-4 py-3 rounded-3xl border border-gray-300 bg-gray-100 cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Telefone</label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full px-4 py-3 rounded-3xl border border-gray-300 focus:outline-none focus:border-emerald-500"
              placeholder="(11) 99999-9999"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Você é...</label>
            <select
              value={form.userType}
              onChange={(e) => setForm({ ...form, userType: e.target.value as any })}
              className="w-full px-4 py-3 rounded-3xl border border-gray-300 focus:outline-none focus:border-emerald-500"
            >
              <option value="PROPRIETARIO">Proprietário de cavalo</option>
              <option value="VETERINARIO">Veterinário</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Senha</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="w-full px-4 py-3 rounded-3xl border border-gray-300 focus:outline-none focus:border-emerald-500"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-400 text-white py-4 rounded-3xl text-lg font-semibold transition-colors"
          >
            {loading ? 'Cadastrando...' : 'Criar conta'}
          </button>
        </form>

        <p className="text-center text-gray-500 mt-8">
          Já tem uma conta?{' '}
          <Link to="/login" className="text-emerald-600 font-medium hover:underline">
            Fazer login
          </Link>
        </p>
      </div>
    </div>
  );
}