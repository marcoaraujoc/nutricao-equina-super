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
    confirmPassword: '',
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Máscara de telefone com (21)
  const formatPhone = (value: string) => {
    let phone = value.replace(/\D/g, '');
    if (phone.length > 11) phone = phone.substring(0, 11);

    if (phone.length <= 2) return `(${phone}`;
    if (phone.length <= 6) return `(${phone.substring(0,2)}) ${phone.substring(2)}`;
    return `(${phone.substring(0,2)}) ${phone.substring(2,7)}-${phone.substring(7)}`;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'phone') {
      setForm({ ...form, phone: formatPhone(value) });
    } else {
      setForm({ ...form, [name]: value });
    }
  };

  // Validação forte de senha
  const validatePassword = (password: string): string | null => {
    if (password.length < 8) return 'A senha deve ter no mínimo 8 caracteres';
    if (!/[A-Z]/.test(password)) return 'A senha deve conter pelo menos 1 letra maiúscula';
    if (!/[0-9]/.test(password)) return 'A senha deve conter pelo menos 1 número';
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) return 'A senha deve conter pelo menos 1 caractere especial (!@#$%^&*)';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const passwordError = validatePassword(form.password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    if (form.password !== form.confirmPassword) {
      setError('As senhas não coincidem');
      return;
    }

    if (form.phone.replace(/\D/g, '').length < 10) {
      setError('Telefone inválido');
      return;
    }

    setLoading(true);

    const emailLower = form.email.trim().toLowerCase();

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: form.fullName,
          email: emailLower,
          password: form.password,
          phone: form.phone,
          userType: form.userType,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        alert('✅ Cadastro realizado com sucesso!');
        if (googleData.fromGoogle) {
          const loginRes = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: emailLower, password: form.password }),
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
        // Tratamento de e-mail duplicado
        if (data.error?.toLowerCase().includes('email') || data.error?.toLowerCase().includes('e-mail')) {
          setError('Este e-mail já está cadastrado. Tente fazer login ou use outro e-mail.');
        } else {
          setError(data.error || 'Erro ao cadastrar usuário');
        }
      }
    } catch (err) {
      console.error(err);
      setError('Erro de conexão com o servidor');
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
            <label className="block text-sm font-medium mb-1">
              Nome completo <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="fullName"
              value={form.fullName}
              onChange={handleChange}
              className="w-full px-4 py-3 rounded-3xl border border-gray-300 focus:outline-none focus:border-emerald-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              E-mail <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              className="w-full px-4 py-3 rounded-3xl border border-gray-300 focus:outline-none focus:border-emerald-500 text-gray-900"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Telefone <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              name="phone"
              value={form.phone}
              onChange={handleChange}
              placeholder="(21) 99999-9999"
              className="w-full px-4 py-3 rounded-3xl border border-gray-300 focus:outline-none focus:border-emerald-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Você é... <span className="text-red-500">*</span>
            </label>
            <select
              name="userType"
              value={form.userType}
              onChange={handleChange}
              className="w-full px-4 py-3 rounded-3xl border border-gray-300 focus:outline-none focus:border-emerald-500"
              required
            >
              <option value="PROPRIETARIO">Proprietário</option>
              <option value="VETERINARIO">Veterinário</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Senha <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                name="password"
                value={form.password}
                onChange={handleChange}
                className="w-full px-4 py-3 rounded-3xl border border-gray-300 focus:outline-none focus:border-emerald-500"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 text-xl"
              >
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Repetir Senha <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                name="confirmPassword"
                value={form.confirmPassword}
                onChange={handleChange}
                className="w-full px-4 py-3 rounded-3xl border border-gray-300 focus:outline-none focus:border-emerald-500"
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 text-xl"
              >
                {showConfirmPassword ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          {error && <p className="text-red-500 text-sm text-center font-medium">{error}</p>}

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