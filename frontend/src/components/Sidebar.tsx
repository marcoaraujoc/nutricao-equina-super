// src/components/Sidebar.tsx

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
  Stethoscope,
  DollarSign,
  ChevronDown,
  LogOut,
  Menu,
  X,
  Users,
  ShieldCheck,
} from 'lucide-react';

export default function Sidebar() {
  const { user, logout } = useAuth();
  const { isNewUser, selectedAnimal } = useSelectedAnimal();
  const location = useLocation();

  const role = user?.role?.toUpperCase();
  const isAdmin = role === 'ADMIN';

  // ── Estados dos menus ─────────────────────────────────────────────────────

  const [openGeral,          setOpenGeral]          = useState(true);
  const [openModulos,        setOpenModulos]        = useState(true);
  const [openClinica,        setOpenClinica]        = useState(false);
  const [openNutricional,    setOpenNutricional]    = useState(false);
  const [openAdministracao,  setOpenAdministracao]  = useState(false);
  const [openFinanceiro,     setOpenFinanceiro]     = useState(false);
  const [isMobileMenuOpen,   setIsMobileMenuOpen]   = useState(false);

  const toggle = (setter: React.Dispatch<React.SetStateAction<boolean>>) =>
    setter(prev => !prev);

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const navLink = (to: string, icon: React.ReactNode, label: string) => (
    <Link
      to={to}
      onClick={() => setIsMobileMenuOpen(false)}
      className={`flex items-center gap-3 px-5 py-3 rounded-3xl text-base transition-colors ${
        isActive(to) ? 'bg-emerald-100 text-emerald-700 font-medium' : 'hover:bg-gray-100 text-gray-700'
      }`}
    >
      {icon} {label}
    </Link>
  );

  return (
    <>
      {/* Hamburguer mobile */}
      <button
        onClick={() => setIsMobileMenuOpen(true)}
        className="md:hidden fixed top-6 left-6 z-50 p-3 bg-white rounded-3xl shadow-lg border border-gray-200"
      >
        <Menu size={28} />
      </button>

      {/* Sidebar */}
      <div className={`
        fixed inset-y-0 left-0 z-50 w-72 bg-white border-r border-gray-200 shadow-sm flex flex-col
        transition-transform duration-300 ease-in-out
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
        md:translate-x-0 md:static md:flex
      `}>

        {/* Header */}
        <div className="px-6 py-8 border-b border-gray-200 flex items-center gap-3 flex-shrink-0">
          <div className="w-10 h-10 bg-emerald-600 rounded-2xl flex items-center justify-center text-white text-2xl">🥕</div>
          <div>
            <h1 className="text-2xl font-bold text-emerald-700">Nutrição Equina</h1>
            <p className="text-emerald-500 text-sm -mt-1">Super</p>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="md:hidden ml-auto p-2 text-gray-500 hover:text-gray-700"
          >
            <X size={28} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-6 space-y-6 overflow-y-auto">

          {/* ═══ GERAL ═══════════════════════════════════════════════════════ */}
          <div>
            <button
              onClick={() => toggle(setOpenGeral)}
              className="flex items-center justify-between w-full px-5 py-3 text-xs font-bold text-gray-400 uppercase tracking-widest hover:bg-gray-50 rounded-3xl"
            >
              Geral
              <ChevronDown className={`w-4 h-4 transition-transform ${openGeral ? 'rotate-180' : ''}`} />
            </button>

            {openGeral && (
              <div className="mt-2 space-y-1 pl-4">
                {navLink('/',                <LayoutDashboard size={20} />, 'Dashboard')}
                {navLink('/cadastro-pessoal',<User size={20} />,           'Cadastro Pessoal')}
                {navLink('/meus-animais',    <Zap size={20} />,            'Animais')}
                {navLink('/exames',          <ClipboardList size={20} />,  'Exames')}
              </div>
            )}
          </div>

          {/* ═══ MÓDULOS ═════════════════════════════════════════════════════ */}
          {!isNewUser ? (
            <div>
              <button
                onClick={() => toggle(setOpenModulos)}
                className="flex items-center justify-between w-full px-5 py-3 text-xs font-bold text-gray-400 uppercase tracking-widest hover:bg-gray-50 rounded-3xl"
              >
                Módulos
                <ChevronDown className={`w-4 h-4 transition-transform ${openModulos ? 'rotate-180' : ''}`} />
              </button>

              {openModulos && (
                <div className="mt-2 pl-4 space-y-1">

                  {/* Clínica */}
                  <div>
                    <button
                      onClick={() => toggle(setOpenClinica)}
                      className="flex items-center justify-between w-full px-5 py-3 text-sm font-semibold text-gray-500 hover:bg-gray-50 rounded-3xl"
                    >
                      <span className="flex items-center gap-3"><Stethoscope size={20} /> Clínica</span>
                      <ChevronDown className={`w-4 h-4 transition-transform ${openClinica ? 'rotate-180' : ''}`} />
                    </button>
                    {openClinica && (
                      <div className="mt-1 pl-6 text-gray-400 text-sm px-5 py-2">Em breve</div>
                    )}
                  </div>

                  {/* Nutricional */}
                  <div>
                    <button
                      onClick={() => toggle(setOpenNutricional)}
                      className="flex items-center justify-between w-full px-5 py-3 text-sm font-semibold text-gray-500 hover:bg-gray-50 rounded-3xl"
                    >
                      <span className="flex items-center gap-3"><Carrot size={20} /> Nutricional</span>
                      <ChevronDown className={`w-4 h-4 transition-transform ${openNutricional ? 'rotate-180' : ''}`} />
                    </button>

                    {openNutricional && (
                      <div className="mt-2 pl-6 space-y-1">
                        {navLink(
                          selectedAnimal ? `/dieta/${selectedAnimal.id}` : '/dieta',
                          null,
                          'Dieta',
                        )}
                        {navLink(
                          selectedAnimal ? `/relatorio-nutricional/${selectedAnimal.id}` : '/relatorio-nutricional',
                          null,
                          'Relatório Nutricional',
                        )}
                      </div>
                    )}
                  </div>

                  {/* Financeiro */}
                  <div>
                    <button
                      onClick={() => toggle(setOpenFinanceiro)}
                      className="flex items-center justify-between w-full px-5 py-3 text-sm font-semibold text-gray-500 hover:bg-gray-50 rounded-3xl"
                    >
                      <span className="flex items-center gap-3"><DollarSign size={20} /> Financeiro</span>
                      <ChevronDown className={`w-4 h-4 transition-transform ${openFinanceiro ? 'rotate-180' : ''}`} />
                    </button>
                    {openFinanceiro && (
                      <div className="mt-1 pl-6 text-gray-400 text-sm px-5 py-2">Em breve</div>
                    )}
                  </div>

                </div>
              )}
            </div>
          ) : (
            <div className="mx-3 px-5 py-6 bg-amber-50 border border-amber-200 rounded-3xl text-amber-700 text-sm">
              <strong>Funcionalidades bloqueadas</strong><br />
              Complete seu Cadastro e cadastre seu primeiro animal para liberar os módulos.
            </div>
          )}

          {/* ═══ ADMINISTRAÇÃO (somente ADMIN) ═══════════════════════════════ */}
          {isAdmin && (
            <div>
              <button
                onClick={() => toggle(setOpenAdministracao)}
                className="flex items-center justify-between w-full px-5 py-3 text-xs font-bold text-gray-400 uppercase tracking-widest hover:bg-gray-50 rounded-3xl"
              >
                <span className="flex items-center gap-2">
                  <ShieldCheck size={14} /> Administração
                </span>
                <ChevronDown className={`w-4 h-4 transition-transform ${openAdministracao ? 'rotate-180' : ''}`} />
              </button>

              {openAdministracao && (
                <div className="mt-2 space-y-1 pl-4">
                  {navLink('/alimentos',           <Wheat size={20} />,   'Alimentos')}
                  {navLink('/nutrientes',           <TestTube size={20} />, 'Nutrientes')}
                  {navLink('/composicao-alimentar', <ChartBar size={20} />, 'Composição Alimentar')}
                  {navLink('/usuarios',             <Users size={20} />,   'Usuários')}
                </div>
              )}
            </div>
          )}

        </nav>

        {/* Footer */}
        {user && (
          <div className="border-t border-gray-200 p-4 flex-shrink-0">
            <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 rounded-3xl">
              <div className="w-9 h-9 bg-emerald-100 text-emerald-700 rounded-2xl flex items-center justify-center font-bold text-sm">
                {user.fullName?.[0]?.toUpperCase() ?? 'U'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{user.fullName}</p>
                <p className="text-xs text-gray-500 truncate">{user.email}</p>
              </div>
              {isAdmin && (
                <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full flex-shrink-0">
                  ADMIN
                </span>
              )}
            </div>

            <button
              onClick={logout}
              className="mt-3 flex items-center justify-center gap-2 w-full py-3 text-red-600 hover:bg-red-50 rounded-3xl text-sm font-medium transition-colors"
            >
              <LogOut size={16} /> Sair
            </button>
          </div>
        )}
      </div>

      {/* Backdrop mobile */}
      {isMobileMenuOpen && (
        <div
          onClick={() => setIsMobileMenuOpen(false)}
          className="md:hidden fixed inset-0 bg-black/50 z-40"
        />
      )}
    </>
  );
}