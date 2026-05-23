// src/components/Sidebar.tsx

import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import { useState } from 'react';
import {
  LayoutDashboard, User, Zap, ClipboardList,
  Wheat, TestTube, ChartBar, Carrot, Stethoscope,
  DollarSign, ChevronDown, LogOut, Menu, X,
  Users, Users2, ShieldCheck,
} from 'lucide-react';
import { useVetPendentes } from '../hooks/useVetPendentes';
import { useVetSolicitacaoMonitor } from '../hooks/useVetSolicitacaoMonitor';
import { useProprietarioNotificacoes } from '../hooks/useProprietarioNotificacoes';

// ─── Estilos ──────────────────────────────────────────────────────────────────
const CLS_MODULE_ACTIVE  = 'bg-emerald-50 text-emerald-600';
const CLS_ITEM_ACTIVE    = 'bg-emerald-100 text-emerald-700 font-medium';
const CLS_ITEM_INACTIVE  = 'text-gray-700 hover:bg-gray-100';
const CLS_MODULE_INACTIVE= 'text-gray-500 hover:bg-gray-50';

const ROLES_CLINICAS = ['ADMIN', 'VETERINARIO', 'ESTAGIARIO'];

// ─── Detectar seção ativa ─────────────────────────────────────────────────────
type ActiveSection = 'geral' | 'clinica' | 'nutricional' | 'admin';

function detectSection(pathname: string): ActiveSection {
  if (pathname.startsWith('/clinica'))               return 'clinica';
  if (pathname.startsWith('/animais-vet'))           return 'geral';
  if (pathname.startsWith('/dieta'))                 return 'nutricional';
  if (pathname.startsWith('/relatorio-nutricional')) return 'nutricional';
  if (
    pathname.startsWith('/alimentos') ||
    pathname.startsWith('/nutrientes') ||
    pathname.startsWith('/composicao-alimentar') ||
    pathname.startsWith('/usuarios') ||
    pathname.startsWith('/equipe') ||
    pathname.startsWith('/ai-usage')
  ) return 'admin';
  return 'geral';
}

export default function Sidebar() {
  const { user, logout }              = useAuth();
  const { isNewUser, selectedAnimal } = useSelectedAnimal();
  const location                      = useLocation();
  const pendentesCount                = useVetPendentes();
  useVetSolicitacaoMonitor();
  useProprietarioNotificacoes();

  const role          = (user?.role      ?? user?.userType ?? '').toUpperCase();
  const userTypeUpper = (user?.userType  ?? '').toUpperCase();
  const isAdmin          = role === 'ADMIN';
  const isVet            = role === 'VETERINARIO' || userTypeUpper === 'VETERINARIO';
  const temAcessoClinico = ROLES_CLINICAS.includes(role) || ROLES_CLINICAS.includes(userTypeUpper);
  const animalId         = selectedAnimal?.id;

  const activeSection = detectSection(location.pathname);
  const p             = location.pathname;

  // ── Helpers de active state ───────────────────────────────────────────────
  const isGeralActive = (path: string) => {
    if (activeSection !== 'geral') return false;
    if (path === '/') return p === '/';
    return p.startsWith(path);
  };
  const isModuleActive         = (mod: ActiveSection) => activeSection === mod;
  const isNutricionalSubActive = (path: string) => activeSection === 'nutricional' && p.startsWith(path);
  const isAdminActive          = (path: string) => activeSection === 'admin' && p.startsWith(path);

  // ── Estados dos menus ─────────────────────────────────────────────────────
  const [openGeral,         setOpenGeral]        = useState(true);
  const [openModulos,       setOpenModulos]       = useState(true);
  const [openNutricional,   setOpenNutricional]   = useState(() =>
    p.startsWith('/dieta') || p.startsWith('/relatorio-nutricional'),
  );
  const [openAdministracao, setOpenAdministracao] = useState(false);
  const [openFinanceiro,    setOpenFinanceiro]    = useState(false);
  const [isMobileMenuOpen,  setIsMobileMenuOpen]  = useState(false);

  const toggle      = (s: React.Dispatch<React.SetStateAction<boolean>>) => s(v => !v);
  const closeMobile = () => setIsMobileMenuOpen(false);

  // ── Renderizadores ────────────────────────────────────────────────────────
  const navLink = (to: string, icon: React.ReactNode, label: string, active: boolean) => (
    <Link to={to} onClick={closeMobile}
      className={`flex items-center gap-3 px-5 py-3 rounded-3xl text-base transition-colors ${active ? CLS_ITEM_ACTIVE : CLS_ITEM_INACTIVE}`}>
      {icon} {label}
    </Link>
  );

  const navLinkBadge = (
    to: string, icon: React.ReactNode, label: string, active: boolean, badge: number,
  ) => (
    <Link to={to} onClick={closeMobile}
      className={`flex items-center gap-3 px-5 py-3 rounded-3xl text-base transition-colors ${active ? CLS_ITEM_ACTIVE : CLS_ITEM_INACTIVE}`}>
      {icon}
      <span className="flex-1">{label}</span>
      {badge > 0 && (
        <span className="bg-red-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] rounded-full flex items-center justify-center px-1 leading-none flex-shrink-0">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </Link>
  );

  const moduleButton = (
    label: string, icon: React.ReactNode, mod: ActiveSection, open: boolean, onToggle: () => void,
  ) => (
    <button onClick={onToggle}
      className={`flex items-center justify-between w-full px-5 py-3 text-sm font-semibold rounded-3xl transition-colors ${isModuleActive(mod) ? CLS_MODULE_ACTIVE : CLS_MODULE_INACTIVE}`}>
      <span className="flex items-center gap-3">{icon} {label}</span>
      <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
  );

  const subLink = (to: string, icon: React.ReactNode, label: string, active: boolean) => (
    <Link key={to} to={to} onClick={closeMobile}
      className={`flex items-center gap-3 px-5 py-2.5 rounded-2xl text-sm transition-colors ${active ? 'bg-emerald-100 text-emerald-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`}>
      {icon && <span className="flex-shrink-0">{icon}</span>}
      {label}
    </Link>
  );

  return (
    <>
      {/* Hamburguer mobile */}
      <button onClick={() => setIsMobileMenuOpen(true)}
        className="md:hidden fixed top-6 left-6 z-50 p-3 bg-white rounded-3xl shadow-lg border border-gray-200">
        <Menu size={28} />
      </button>

      {/* Sidebar */}
      <div className={`
        fixed inset-y-0 left-0 z-50 w-72 bg-white border-r border-gray-200 shadow-sm
        flex flex-col overflow-hidden
        transition-transform duration-300 ease-in-out
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
        md:translate-x-0 md:static md:flex
      `}>

        {/* Header */}
        <div className="px-6 py-6 border-b border-gray-200 flex items-center gap-3 flex-shrink-0">
          <div className="w-10 h-10 bg-emerald-600 rounded-2xl flex items-center justify-center text-white text-2xl">🥕</div>
          <div>
            <h1 className="text-xl font-bold text-emerald-700">Nutrição Equina</h1>
            <p className="text-emerald-500 text-sm -mt-0.5">Super</p>
          </div>
          <button onClick={closeMobile} className="md:hidden ml-auto p-2 text-gray-500 hover:text-gray-700">
            <X size={28} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 min-h-0 px-3 py-4 space-y-4 overflow-y-auto">

          {/* ═══ GERAL ═══════════════════════════════════════════════════════ */}
          <div>
            <button onClick={() => toggle(setOpenGeral)}
              className="flex items-center justify-between w-full px-5 py-2.5 text-xs font-bold text-gray-400 uppercase tracking-widest hover:bg-gray-50 rounded-3xl">
              Geral
              <ChevronDown className={`w-4 h-4 transition-transform ${openGeral ? 'rotate-180' : ''}`} />
            </button>

            {openGeral && (
              <div className="mt-1 space-y-0.5 pl-4">
                {navLink('/', <LayoutDashboard size={20} />, 'Dashboard', isGeralActive('/'))}
                {navLink('/cadastro-pessoal', <User size={20} />, 'Cadastro Pessoal', isGeralActive('/cadastro-pessoal'))}

                {isVet
                  ? navLinkBadge('/animais-vet', <Zap size={20} />, 'Pacientes', isGeralActive('/animais-vet'), pendentesCount)
                  : navLink('/meus-animais', <Zap size={20} />, 'Animais', isGeralActive('/meus-animais'))
                }

                {navLink('/exames', <ClipboardList size={20} />, 'Exames', isGeralActive('/exames'))}
              </div>
            )}
          </div>

          {/* ═══ MÓDULOS ═════════════════════════════════════════════════════ */}
          {!isNewUser ? (
            <div>
              <button onClick={() => toggle(setOpenModulos)}
                className="flex items-center justify-between w-full px-5 py-2.5 text-xs font-bold text-gray-400 uppercase tracking-widest hover:bg-gray-50 rounded-3xl">
                Módulos
                <ChevronDown className={`w-4 h-4 transition-transform ${openModulos ? 'rotate-180' : ''}`} />
              </button>

              {openModulos && (
                <div className="mt-1 pl-4 space-y-0.5">

                  {/* ── Clínica — agora um único link "Atendimento" ──────── */}
                  {temAcessoClinico && (
                    <Link
                      to="/clinica"
                      onClick={closeMobile}
                      className={`flex items-center gap-3 px-5 py-3 text-sm font-semibold rounded-3xl transition-colors ${
                        isModuleActive('clinica') ? CLS_MODULE_ACTIVE : CLS_MODULE_INACTIVE
                      }`}
                    >
                      <Stethoscope size={20} />
                      Atendimento
                    </Link>
                  )}

                  {/* ── Nutricional ──────────────────────────────────────── */}
                  <div>
                    {moduleButton('Nutricional', <Carrot size={20} />, 'nutricional', openNutricional, () => toggle(setOpenNutricional))}
                    {openNutricional && (
                      <div className="mt-1 pl-6 space-y-0.5">
                        {subLink(
                          animalId ? `/dieta/${animalId}` : '/dieta',
                          null, 'Dieta',
                          isNutricionalSubActive('/dieta'),
                        )}
                        {subLink(
                          animalId ? `/relatorio-nutricional/${animalId}` : '/relatorio-nutricional',
                          null, 'Relatório Nutricional',
                          isNutricionalSubActive('/relatorio-nutricional'),
                        )}
                      </div>
                    )}
                  </div>

                  {/* ── Financeiro ───────────────────────────────────────── */}
                  <div>
                    <button onClick={() => toggle(setOpenFinanceiro)}
                      className="flex items-center justify-between w-full px-5 py-2.5 text-sm font-semibold text-gray-500 hover:bg-gray-50 rounded-3xl transition-colors">
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
            <div className="mx-3 px-5 py-5 bg-amber-50 border border-amber-200 rounded-3xl text-amber-700 text-sm">
              <strong>Funcionalidades bloqueadas</strong><br />
              Complete seu Cadastro e cadastre seu primeiro animal para liberar os módulos.
            </div>
          )}

          {/* ═══ ADMINISTRAÇÃO ═══════════════════════════════════════════════ */}
          {(isAdmin || isVet) && (
            <div>
              <button onClick={() => toggle(setOpenAdministracao)}
                className="flex items-center justify-between w-full px-5 py-2.5 text-xs font-bold text-gray-400 uppercase tracking-widest hover:bg-gray-50 rounded-3xl">
                <span className="flex items-center gap-2"><ShieldCheck size={14} /> Administração</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${openAdministracao ? 'rotate-180' : ''}`} />
              </button>

              {openAdministracao && (
                <div className="mt-1 space-y-0.5 pl-4">
                  {isAdmin && (
                    <>
                      {navLink('/alimentos',           <Wheat size={20} />,    'Alimentos',            isAdminActive('/alimentos'))}
                      {navLink('/nutrientes',           <TestTube size={20} />, 'Nutrientes',           isAdminActive('/nutrientes'))}
                      {navLink('/composicao-alimentar', <ChartBar size={20} />, 'Composição Alimentar', isAdminActive('/composicao-alimentar'))}
                      {navLink('/usuarios',             <Users size={20} />,    'Usuários',             isAdminActive('/usuarios'))}
                      {navLink('/ai-usage',             <Users size={20} />,    'Monitoramento IA',     isAdminActive('/ai-usage'))}
                    </>
                  )}
                  {navLink('/equipe', <Users2 size={20} />, 'Minha Equipe', isAdminActive('/equipe'))}
                </div>
              )}
            </div>
          )}

        </nav>

        {/* Footer */}
        {user && (
          <div className="border-t border-gray-200 p-3 flex-shrink-0">
            <div className="flex items-center gap-3 px-3 py-2.5 bg-gray-50 rounded-2xl">
              <div className="w-8 h-8 bg-emerald-100 text-emerald-700 rounded-xl flex items-center justify-center font-bold text-sm flex-shrink-0">
                {user.fullName?.[0]?.toUpperCase() ?? 'U'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{user.fullName}</p>
                <p className="text-xs text-gray-500 truncate">{user.email}</p>
              </div>
              {isAdmin && (
                <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full flex-shrink-0">ADMIN</span>
              )}
              {(role === 'VETERINARIO' || userTypeUpper === 'VETERINARIO') && !isAdmin && (
                <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full flex-shrink-0">VET</span>
              )}
              {role === 'ESTAGIARIO' && (
                <span className="text-[10px] font-bold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full flex-shrink-0">EST</span>
              )}
            </div>
            <button onClick={logout}
              className="mt-2 flex items-center justify-center gap-2 w-full py-2.5 text-red-600 hover:bg-red-50 rounded-2xl text-sm font-medium transition-colors">
              <LogOut size={16} /> Sair
            </button>
          </div>
        )}
      </div>

      {/* Backdrop mobile */}
      {isMobileMenuOpen && (
        <div onClick={closeMobile} className="md:hidden fixed inset-0 bg-black/50 z-40" />
      )}
    </>
  );
}