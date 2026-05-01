import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import { useState } from 'react';
import { 
  LayoutDashboard, 
  User, 
  Zap, 
  ClipboardList, 
  Wheat, 
  TestTube, 
  ChartBar, 
  Carrot, 
  Settings, 
  BarChart3,
  Users,
  Stethoscope,
  Package,
  DollarSign,
  ChevronDown,
  LogOut,
  Menu,
  X
} from 'lucide-react';

export default function Sidebar() {
  const { user, logout } = useAuth();
  const { selectedAnimal } = useSelectedAnimal();
  const location = useLocation();

  const role = user?.role?.toUpperCase();
  const isAdminOrVet = role === 'ADMIN' || role === 'VETERINARIO';

  // Estados dos menus
  const [openGeral, setOpenGeral] = useState(true);
  const [openModulos, setOpenModulos] = useState(true);
  const [openGestao, setOpenGestao] = useState(true);

  const [openClinica, setOpenClinica] = useState(false);
  const [openNutricional, setOpenNutricional] = useState(false);
  const [openEstoque, setOpenEstoque] = useState(false);
  const [openFinanceiro, setOpenFinanceiro] = useState(false);

  // Menu mobile
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const toggle = (setter: any) => setter((prev: boolean) => !prev);
  
  // ✅ Suporte a rota dinâmica /dieta/:animalId e /exames/:animalId
  const isActive = (path: string) => {
    if (path === '/dieta' || path === '/exames') return location.pathname.startsWith(path);
    return location.pathname === path;
  };

  return (
    <>
      {/* HAMBURGER BUTTON (Mobile/Tablet) */}
      <button
        onClick={() => setIsMobileMenuOpen(true)}
        className="md:hidden fixed top-6 left-6 z-50 p-3 bg-white rounded-3xl shadow-lg border border-gray-200"
      >
        <Menu size={28} />
      </button>

      {/* SIDEBAR */}
      <div className={`
        fixed inset-y-0 left-0 z-50 w-72 bg-white border-r border-gray-200 shadow-sm
        transition-transform duration-300 ease-in-out
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
        md:translate-x-0 md:static md:block
      `}>

        {/* HEADER */}
        <div className="px-6 py-8 border-b border-gray-200 flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-600 rounded-2xl flex items-center justify-center text-white text-2xl">🥕</div>
          <div>
            <h1 className="text-3xl font-bold text-emerald-700">Nutrição Equina</h1>
            <p className="text-emerald-500 text-sm -mt-1">Super</p>
          </div>

          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="md:hidden ml-auto p-2 text-gray-500 hover:text-gray-700"
          >
            <X size={28} />
          </button>
        </div>

        <nav className="flex-1 px-3 py-6 space-y-8 overflow-y-auto">

          {/* GERAL */}
          <div>
            <button onClick={() => toggle(setOpenGeral)} className="flex items-center justify-between w-full px-5 py-3 text-sm font-semibold text-gray-500 uppercase tracking-widest hover:bg-gray-50 rounded-3xl">
              GERAL
              <ChevronDown className={`w-4 h-4 transition-transform ${openGeral ? 'rotate-180' : ''}`} />
            </button>
            {openGeral && (
              <div className="mt-2 space-y-1 pl-4">
                <Link to="/" className={`flex items-center gap-3 px-5 py-3 rounded-3xl text-base ${isActive('/') ? 'bg-emerald-100 text-emerald-700' : 'hover:bg-gray-100 text-gray-700'}`}>
                  <LayoutDashboard size={20} /> Dashboard
                </Link>
                <Link to="/cadastro-pessoal" className={`flex items-center gap-3 px-5 py-3 rounded-3xl text-base ${isActive('/cadastro-pessoal') ? 'bg-emerald-100 text-emerald-700' : 'hover:bg-gray-100 text-gray-700'}`}>
                  <User size={20} /> Cadastro Pessoal
                </Link>
                <Link to="/meus-cavalos" className={`flex items-center gap-3 px-5 py-3 rounded-3xl text-base ${isActive('/meus-cavalos') ? 'bg-emerald-100 text-emerald-700' : 'hover:bg-gray-100 text-gray-700'}`}>
                  <Zap size={20} /> Animais
                </Link>
                <Link to="/exames" className={`flex items-center gap-3 px-5 py-3 rounded-3xl text-base ${isActive('/exames') ? 'bg-emerald-100 text-emerald-700' : 'hover:bg-gray-100 text-gray-700'}`}>
                  <ClipboardList size={20} /> Exames
                </Link>
              </div>
            )}
          </div>

          {/* MÓDULOS */}
          <div>
            <button onClick={() => toggle(setOpenModulos)} className="flex items-center justify-between w-full px-5 py-3 text-sm font-semibold text-gray-500 uppercase tracking-widest hover:bg-gray-50 rounded-3xl">
              MÓDULOS
              <ChevronDown className={`w-4 h-4 transition-transform ${openModulos ? 'rotate-180' : ''}`} />
            </button>

            {openModulos && (
              <div className="mt-2 pl-4 space-y-6">

                {/* Clínica */}
                <div>
                  <button onClick={() => toggle(setOpenClinica)} className="flex items-center justify-between w-full px-5 py-3 text-sm font-semibold text-gray-500 hover:bg-gray-50 rounded-3xl">
                    <span className="flex items-center gap-3"><Stethoscope size={20} /> Clínica</span>
                    <ChevronDown className={`w-4 h-4 transition-transform ${openClinica ? 'rotate-180' : ''}`} />
                  </button>
                  {openClinica && <div className="mt-1 pl-6 text-gray-600 text-sm">Em breve</div>}
                </div>

                {/* Nutricional */}
                <div>
                  <button onClick={() => toggle(setOpenNutricional)} className="flex items-center justify-between w-full px-5 py-3 text-sm font-semibold text-gray-500 hover:bg-gray-50 rounded-3xl">
                    <span className="flex items-center gap-3"><Carrot size={20} /> Nutricional</span>
                    <ChevronDown className={`w-4 h-4 transition-transform ${openNutricional ? 'rotate-180' : ''}`} />
                  </button>
                  {openNutricional && (
                    <div className="mt-2 pl-6 space-y-1">
                      <Link 
                        to={selectedAnimal ? `/dieta/${selectedAnimal.id}` : '/dieta'} 
                        className={`flex items-center gap-3 px-5 py-3 rounded-3xl text-base ${isActive('/dieta') ? 'bg-emerald-100 text-emerald-700' : 'hover:bg-gray-100 text-gray-700'}`}
                      >
                        Dieta
                      </Link>
                      <Link to="/analise" className={`flex items-center gap-3 px-5 py-3 rounded-3xl text-base ${isActive('/analise') ? 'bg-emerald-100 text-emerald-700' : 'hover:bg-gray-100 text-gray-700'}`}>Relatório</Link>
                      {isAdminOrVet && (
                        <>
                          <Link to="/alimentos" className={`flex items-center gap-3 px-5 py-3 rounded-3xl text-base ${isActive('/alimentos') ? 'bg-emerald-100 text-emerald-700' : 'hover:bg-gray-100 text-gray-700'}`}><Wheat size={20} /> Alimentos</Link>
                          <Link to="/nutrientes" className={`flex items-center gap-3 px-5 py-3 rounded-3xl text-base ${isActive('/nutrientes') ? 'bg-emerald-100 text-emerald-700' : 'hover:bg-gray-100 text-gray-700'}`}><TestTube size={20} /> Nutrientes</Link>
                          <Link to="/composicao-alimentar" className={`flex items-center gap-3 px-5 py-3 rounded-3xl text-base ${isActive('/composicao-alimentar') ? 'bg-emerald-100 text-emerald-700' : 'hover:bg-gray-100 text-gray-700'}`}><ChartBar size={20} /> Composição Alimentar</Link>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Estoque */}
                {isAdminOrVet && (
                  <div>
                    <button onClick={() => toggle(setOpenEstoque)} className="flex items-center justify-between w-full px-5 py-3 text-sm font-semibold text-gray-500 hover:bg-gray-50 rounded-3xl">
                      <span className="flex items-center gap-3"><Package size={20} /> Estoque</span>
                      <ChevronDown className={`w-4 h-4 transition-transform ${openEstoque ? 'rotate-180' : ''}`} />
                    </button>
                    {openEstoque && <div className="mt-1 pl-6 text-gray-600 text-sm">Em breve</div>}
                  </div>
                )}

                {/* Financeiro */}
                <div>
                  <button onClick={() => toggle(setOpenFinanceiro)} className="flex items-center justify-between w-full px-5 py-3 text-sm font-semibold text-gray-500 hover:bg-gray-50 rounded-3xl">
                    <span className="flex items-center gap-3"><DollarSign size={20} /> Financeiro</span>
                    <ChevronDown className={`w-4 h-4 transition-transform ${openFinanceiro ? 'rotate-180' : ''}`} />
                  </button>
                  {openFinanceiro && <div className="mt-1 pl-6 text-gray-600 text-sm">Em breve</div>}
                </div>
              </div>
            )}
          </div>

          {/* GESTÃO (apenas ADMIN) */}
          {role === 'ADMIN' && (
            <div>
              <button onClick={() => toggle(setOpenGestao)} className="flex items-center justify-between w-full px-5 py-3 text-sm font-semibold text-gray-500 uppercase tracking-widest hover:bg-gray-50 rounded-3xl">
                GESTÃO
                <ChevronDown className={`w-4 h-4 transition-transform ${openGestao ? 'rotate-180' : ''}`} />
              </button>
              {openGestao && (
                <div className="mt-2 pl-4 space-y-1">
                  <Link to="/usuarios" className={`flex items-center gap-3 px-5 py-3 rounded-3xl text-base ${isActive('/usuarios') ? 'bg-emerald-100 text-emerald-700' : 'hover:bg-gray-100 text-gray-700'}`}>
                    <Users size={20} /> Usuários
                  </Link>
                  <Link to="/relatorios" className={`flex items-center gap-3 px-5 py-3 rounded-3xl text-base ${isActive('/relatorios') ? 'bg-emerald-100 text-emerald-700' : 'hover:bg-gray-100 text-gray-700'}`}>
                    <BarChart3 size={20} /> Relatórios
                  </Link>
                  <Link to="/configuracoes" className={`flex items-center gap-3 px-5 py-3 rounded-3xl text-base ${isActive('/configuracoes') ? 'bg-emerald-100 text-emerald-700' : 'hover:bg-gray-100 text-gray-700'}`}>
                    <Settings size={20} /> Configurações
                  </Link>
                </div>
              )}
            </div>
          )}
        </nav>

        {/* FOOTER */}
        {user && (
          <div className="mt-auto border-t border-gray-200 p-4">
            <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 rounded-3xl">
              <div className="w-9 h-9 bg-emerald-100 text-emerald-700 rounded-2xl flex items-center justify-center font-semibold">
                {user.fullName?.[0] || 'U'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{user.fullName}</p>
                <p className="text-xs text-gray-500 truncate">{user.email}</p>
              </div>
            </div>

            <button onClick={logout} className="mt-4 flex items-center justify-center gap-3 w-full py-3 text-red-600 hover:bg-red-50 rounded-3xl text-sm font-medium transition-colors">
              <LogOut size={18} />
              Sair
            </button>
          </div>
        )}
      </div>

      {/* BACKDROP MOBILE */}
      {isMobileMenuOpen && (
        <div
          onClick={() => setIsMobileMenuOpen(false)}
          className="md:hidden fixed inset-0 bg-black/50 z-40"
        />
      )}
    </>
  );
}