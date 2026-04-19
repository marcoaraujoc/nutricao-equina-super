import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { 
  Home, 
  User, 
  Dog, 
  Utensils, 
  FileText, 
  TestTube, 
  Package, 
  Leaf, 
  Users, 
  History, 
  Menu,
  X 
} from 'lucide-react';

const Sidebar = () => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'NUTRITIONIST';

  const commonMenu = [
    { icon: Home, label: 'Menu Principal', path: '/' },
    { icon: User, label: 'Cadastro Pessoal', path: '/perfil' },
    { icon: Dog, label: 'Meus Cavalos', path: '/cavalos' },
    { icon: Utensils, label: 'Preenchimento da Dieta', path: '/dieta' },
    { icon: FileText, label: 'Relatórios', path: '/relatorios' },
    { icon: TestTube, label: 'Cadastro de Exames', path: '/exames' },
  ];

  const adminMenu = [
    { icon: Package, label: 'Cadastro de Composição de Produtos', path: '/cadastro-composicao' },
    { icon: Leaf, label: 'Cadastro de Nutrientes', path: '/cadastro-nutrientes' },
    { icon: Package, label: 'Cadastro de Produtos', path: '/cadastro-produtos' },
    { icon: Users, label: 'Administração de Usuários', path: '/admin-usuarios' },
    { icon: History, label: 'Cadastro de Histórico', path: '/cadastro-historico' },
  ];

  const isActive = (path: string) => location.pathname === path;

  return (
    <>
      {/* BOTÃO HAMBÚRGUER - Mobile */}
      <button
        onClick={() => setIsMobileOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-50 p-3 bg-emerald-700 text-white rounded-2xl shadow-lg hover:bg-emerald-800 transition-colors"
      >
        <Menu size={24} />
      </button>

      {/* SIDEBAR FIXA - Desktop */}
      <div className="hidden lg:flex w-72 h-screen bg-white border-r border-gray-200 flex-col fixed left-0 top-0 shadow-xl">
        <SidebarContent 
          user={user} 
          isAdmin={isAdmin} 
          commonMenu={commonMenu} 
          adminMenu={adminMenu} 
          isActive={isActive} 
          logout={logout} 
        />
      </div>

      {/* DRAWER MOBILE */}
      {isMobileOpen && (
        <div 
          className="lg:hidden fixed inset-0 z-50 bg-black/60"
          onClick={() => setIsMobileOpen(false)}
        >
          <div
            className="bg-white w-72 h-screen shadow-2xl translate-x-0 transition-transform duration-300"
            onClick={e => e.stopPropagation()}
          >
            <SidebarContent 
              user={user} 
              isAdmin={isAdmin} 
              commonMenu={commonMenu} 
              adminMenu={adminMenu} 
              isActive={isActive} 
              logout={logout} 
              isMobile 
              onClose={() => setIsMobileOpen(false)} 
            />
          </div>
        </div>
      )}
    </>
  );
};

const SidebarContent = ({ user, isAdmin, commonMenu, adminMenu, isActive, logout, isMobile = false, onClose }: any) => (
  <div className="flex flex-col h-full">
    {/* HEADER */}
    <div className="bg-gradient-to-br from-blue-600 to-cyan-500 p-6 text-white flex-shrink-0 relative">
      {isMobile && (
        <button
          onClick={onClose}
          className="absolute top-6 right-6 text-white hover:text-gray-200 transition-colors"
        >
          <X size={28} />
        </button>
      )}
      <div className="flex items-center gap-3">
        <img
          src={user?.photoUrl || 'https://i.pravatar.cc/128?img=64'}
          alt="Foto"
          className="w-12 h-12 rounded-2xl object-cover border-2 border-white shadow-inner"
        />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-lg truncate">{user?.fullName || 'Usuário'}</p>
          <p className="text-sm opacity-90 truncate">{user?.email}</p>
        </div>
      </div>
    </div>

    {/* MENU COM SCROLL */}
    <nav className="flex-1 min-h-0 overflow-y-auto p-4 space-y-6">
      {commonMenu.map((item: any) => (
        <Link
          key={item.path}
          to={item.path}
          onClick={isMobile ? onClose : undefined}
          className={`flex items-center gap-3 px-4 py-3 rounded-2xl transition-colors ${
            isActive(item.path) 
              ? 'bg-emerald-100 text-emerald-700 font-medium' 
              : 'text-gray-700 hover:bg-gray-100'
          }`}
        >
          <item.icon size={22} className={isActive(item.path) ? 'text-emerald-600' : 'text-gray-500'} />
          <span className="text-base">{item.label}</span>
        </Link>
      ))}

      {isAdmin && (
        <>
          <div className="px-4 pt-6 border-t border-gray-200">
            <p className="text-xs uppercase tracking-widest text-gray-400 font-medium mb-3">Administração</p>
          </div>
          {adminMenu.map((item: any) => (
            <Link
              key={item.path}
              to={item.path}
              onClick={isMobile ? onClose : undefined}
              className={`flex items-center gap-3 px-4 py-3 rounded-2xl transition-colors ${
                isActive(item.path) 
                  ? 'bg-emerald-100 text-emerald-700 font-medium' 
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <item.icon size={22} className={isActive(item.path) ? 'text-emerald-600' : 'text-gray-500'} />
              <span className="text-base">{item.label}</span>
            </Link>
          ))}
        </>
      )}
    </nav>

    {/* LOGOUT */}
    <div className="p-4 border-t border-gray-200 flex-shrink-0">
      <button
        onClick={logout}
        className="w-full flex items-center justify-center gap-2 py-4 text-red-600 hover:bg-red-50 rounded-2xl transition-colors font-medium"
      >
        Sair do sistema
      </button>
    </div>
  </div>
);

export default Sidebar;