import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useState, useEffect } from 'react';

type MenuItem = {
  path: string;
  label: string;
  icon: string;
  needsCompletion?: boolean;   // ← propriedade opcional
};

export default function Sidebar() {
  const { user, logout } = useAuth();
  const location = useLocation();

  const [cadastroPessoalCompleted, setCadastroPessoalCompleted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  // Verifica cadastro pessoal
  useEffect(() => {
    const checkCadastro = async () => {
      if (!user?.email) return;
      const token = localStorage.getItem('token');

      try {
        const res = await fetch('/api/users/me', {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();

        const isComplete = !!(data.cep || data.endereco || data.cidade || data.bairro || data.estado);
        setCadastroPessoalCompleted(isComplete);
      } catch (err) {
        console.error('Erro ao verificar cadastro:', err);
      }
    };

    checkCadastro();
  }, [user]);

  const menuBase: MenuItem[] = [
    { path: '/', label: 'Dashboard', icon: '🏠' },
    { path: '/cadastro-pessoal', label: 'Cadastro Pessoal', icon: '👤', needsCompletion: !cadastroPessoalCompleted },
    { path: '/meus-cavalos', label: 'Cavalos', icon: '🐎', needsCompletion: !cadastroPessoalCompleted },
    { path: '/dieta', label: 'Dieta Diária', icon: '🍎' },
    { path: '/exames', label: 'Exames', icon: '📋' },
    { path: '/analise', label: 'Análise + LLM', icon: '📊' },
  ];

  const menuAdminOnly: MenuItem[] = [
    { path: '/composicao-produto', label: 'Composição de Produto', icon: '📊' },
    { path: '/ocorrencias-saude', label: 'Ocorrências de Saúde', icon: '🩹' },
    { path: '/produtos', label: 'Produtos', icon: '📦' },
    { path: '/audit', label: 'Audit Log', icon: '📋' },
    { path: '/usuarios', label: 'Criação de Usuário', icon: '👤' },
  ];

  const menu = user?.role === 'ADMIN' 
    ? [...menuBase, ...menuAdminOnly] 
    : menuBase;

  return (
    <>
      {/* Overlay mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      <div className={`w-72 h-screen bg-white border-r border-gray-200 fixed flex flex-col shadow-sm transition-transform duration-300 z-50 
        ${isOpen ? 'translate-x-0' : '-translate-x-full'} 
        md:translate-x-0 md:static`}>

        <div className="px-6 py-8 border-b border-gray-200">
          <h1 className="text-3xl font-bold text-emerald-600">Equine Nutrition</h1>
          <p className="text-emerald-500 text-sm">Super</p>
        </div>

        <nav className="flex-1 p-4 overflow-y-auto">
          {menu.map((item) => {
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setIsOpen(false)}
                className={`flex items-center gap-4 px-5 py-3.5 rounded-3xl mb-1 text-base font-medium transition-all relative group ${
                  active ? 'bg-emerald-500 text-white' : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <span className="text-xl">{item.icon}</span>
                <span>{item.label}</span>
                
                {item.needsCompletion && (
                  <span className="absolute right-6 text-red-500 text-xl font-bold group-hover:opacity-100 transition-opacity">* </span>
                )}

                {item.needsCompletion && (
                  <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block bg-gray-900 text-white text-xs px-3 py-1 rounded-xl whitespace-nowrap">
                    É necessário completar o cadastro
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {user && (
          <div className="p-4 border-t border-gray-200">
            <button onClick={logout} className="w-full py-3 text-red-500 hover:text-red-600 text-sm font-medium">
              Sair
            </button>
          </div>
        )}
      </div>

      {/* Botão Hamburger (mobile) */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="md:hidden fixed top-4 left-4 z-50 bg-white shadow-md rounded-2xl p-3 text-2xl"
      >
        {isOpen ? '✕' : '☰'}
      </button>
    </>
  );
}