import { BrowserRouter as Router, Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import { createContext, useContext, useState, useEffect } from 'react';

// ====================== AUTH CONTEXT ======================
const AuthContext = createContext<any>(null);

function AuthProvider({ children }: any) {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setUser(payload);
      } catch (e) {}
    }
    setLoading(false);
  }, []);

  const login = (token: string) => {
    localStorage.setItem('token', token);
    const payload = JSON.parse(atob(token.split('.')[1]));
    setUser(payload);
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

function useAuth() {
  return useContext(AuthContext);
}

// ====================== PROTECTED ROUTE ======================
function ProtectedRoute({ children }: any) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-white">Carregando...</div>;
  }

  if (!user) return <Navigate to="/login" replace />;

  return children;
}

// ====================== SIDEBAR ======================
function Sidebar() {
  const { user, logout } = useAuth();
  const location = useLocation();

  const menu = [
    { path: '/', label: 'Dashboard', icon: '🏠' },
    { path: '/cavalos', label: 'Cavalos', icon: '🐎' },
    { path: '/dieta', label: 'Dieta Diária', icon: '🍎' },
    { path: '/exames', label: 'Exames', icon: '📋' },
    { path: '/analise', label: 'Análise + LLM', icon: '📊' },
  ];

  return (
    <div className="w-72 h-screen bg-gray-900 border-r border-gray-800 fixed flex flex-col">
      <div className="px-6 py-8 border-b border-gray-800">
        <h1 className="text-3xl font-bold text-emerald-400">Equine Nutrition</h1>
        <p className="text-emerald-500 text-sm">Super</p>
      </div>

      <nav className="flex-1 p-4">
        {menu.map((item) => {
          const active = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-4 px-5 py-4 rounded-3xl mb-2 text-lg font-medium transition-all ${
                active ? 'bg-emerald-500 text-white' : 'text-gray-300 hover:bg-gray-800'
              }`}
            >
              <span className="text-2xl">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {user && (
        <div className="p-4 border-t border-gray-800">
          <button onClick={logout} className="w-full py-3 text-red-400 hover:text-red-300 text-sm">
            Sair
          </button>
        </div>
      )}
    </div>
  );
}

// ====================== LOGIN ======================
function AuthPage() {
  const { login } = useAuth();

  const handleGoogleLogin = () => {
    const mockToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwiZW1haWwiOiJwYXR0eWNzMDFAZ21haWwuY29tIiwiZnVsbE5hbWUiOiJNYXJjbyIsInJvbGUiOiJVU0VSIiwiaWF0IjoxNzc2MDAwMDAwLCJleHAiOjE3NzYwODYwMDB9.mockgoogle";
    login(mockToken);
    window.location.href = '/';
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="bg-white text-gray-900 w-full max-w-md rounded-3xl shadow-2xl p-10">

        <h1 className="text-3xl font-bold text-center mb-10">
          Faça login na sua conta
        </h1>

        {/* X - Botão preto */}
        <button className="w-full bg-black text-white py-4 rounded-3xl text-lg font-semibold flex items-center justify-center gap-3 mb-4">
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white">
            <path d="M18.244 2H21l-6.5 7.4L22 22h-6.828l-5.345-7.04L3.5 22H1l7.02-8.02L2 2h6.828l4.85 6.4L18.244 2z"/>
          </svg>
          Login com X
        </button>

        <div className="space-y-3">

          {/* Email - Branco com texto preto */}
          <button className="w-full bg-white border border-gray-300 hover:bg-gray-100 py-4 rounded-3xl text-lg flex items-center justify-center">
            ✉ Login com e-mail
          </button>

          {/* Google - Branco com texto preto */}
          <button onClick={handleGoogleLogin} className="w-full bg-white border border-gray-300 hover:bg-gray-100 py-4 rounded-3xl flex items-center justify-center gap-3">
            <svg viewBox="0 0 48 48" className="w-5 h-5">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.74 1.22 9.26 3.6l6.9-6.9C35.64 2.28 30.24 0 24 0 14.64 0 6.48 5.4 2.56 13.32l8.06 6.26C12.6 13.04 17.84 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.5 24c0-1.64-.14-3.22-.4-4.74H24v9h12.68c-.54 2.92-2.2 5.4-4.68 7.04l7.2 5.6C43.92 36.64 46.5 30.88 46.5 24z"/>
              <path fill="#FBBC05" d="M10.62 28.58A14.4 14.4 0 0 1 9.5 24c0-1.6.28-3.14.78-4.58l-8.06-6.26A23.94 23.94 0 0 0 0 24c0 3.88.94 7.54 2.6 10.8l8.02-6.22z"/>
              <path fill="#34A853" d="M24 48c6.24 0 11.48-2.06 15.3-5.6l-7.2-5.6c-2 1.36-4.56 2.16-8.1 2.16-6.16 0-11.4-3.54-13.38-8.68l-8.02 6.22C6.48 42.6 14.64 48 24 48z"/>
            </svg>
            Login com Google
          </button>

          {/* Apple - Branco com texto preto */}
          <button className="w-full bg-white border border-gray-300 hover:bg-gray-100 py-4 rounded-3xl flex items-center justify-center gap-3">
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-black">
              <path d="M16.365 1.43c0 1.14-.46 2.19-1.22 2.97-.8.82-2.12 1.45-3.34 1.35-.15-1.1.4-2.23 1.17-3.02.8-.82 2.18-1.42 3.39-1.3zM20.5 17.5c-.8 1.8-1.8 3.6-3.3 3.6-1.4 0-1.9-.9-3.5-.9-1.6 0-2.2.9-3.6.9-1.5 0-2.6-1.6-3.4-3.4-1.7-3.7-.3-9 2.6-9 1.3 0 2.2.9 3.4.9 1.2 0 2-.9 3.4-.9 1.2 0 2.5.7 3.3 1.8-2.9 1.6-2.4 5.7.1 6z"/>
            </svg>
            Login com Apple
          </button>

        </div>

        {/* Link de cadastro */}
        <p className="text-center text-gray-500 mt-8">
          Não tem uma conta?{' '}
          <Link to="/register" className="text-emerald-600 font-medium hover:underline">
            Cadastrar-se
          </Link>
        </p>

        {/* Termos e Privacidade */}
        <p className="text-center text-xs text-gray-400 mt-10">
          Ao continuar, você concorda com os{' '}
          <a href="/termos.html" target="_blank" className="hover:underline">Termos de Serviço</a> e a{' '}
          <a href="/politica.html" target="_blank" className="hover:underline">Política de Privacidade</a>
        </p>
      </div>
    </div>
  );
}

// ====================== APP ======================
function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<AuthPage />} />
          <Route path="/register" element={<AuthPage />} />
          <Route path="/*" element={
            <ProtectedRoute>
              <div className="flex min-h-screen bg-gray-950">
                <Sidebar />
                <div className="flex-1 ml-72 p-10 text-white">
                  <Routes>
                    <Route path="/" element={<h1 className="text-5xl font-bold">Dashboard</h1>} />
                    <Route path="/cavalos" element={<h1 className="text-4xl">Cavalos</h1>} />
                    <Route path="/dieta" element={<h1 className="text-4xl">Dieta</h1>} />
                    <Route path="/exames" element={<h1 className="text-4xl">Exames</h1>} />
                    <Route path="/analise" element={<h1 className="text-4xl">Análise</h1>} />
                  </Routes>
                </div>
              </div>
            </ProtectedRoute>
          } />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
