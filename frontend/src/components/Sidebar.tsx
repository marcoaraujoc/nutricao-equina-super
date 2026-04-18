import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function Sidebar() {
  const { user, logout } = useAuth();
  const location = useLocation();

  const menu = [
    { path: '/', label: 'Dashboard', icon: '🏠' },
    { path: '/cavalos', label: 'Cavalos', icon: '🐎' },
    { path: '/dieta', label: 'Dieta Diária', icon: '🍎' },
    { path: '/exames', label: 'Exames', icon: '📋' },
    { path: '/analise', label: 'Análise + LLM', icon: '📊' },
    { path: '/auditoria', label: 'Auditoria', icon: '📊' },
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
          <button
            onClick={logout}
            className="w-full py-3 text-red-400 hover:text-red-300 text-sm transition-colors"
          >
            Sair
          </button>
        </div>
      )}
    </div>
  );
}