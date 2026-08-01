// src/components/AppHeader.tsx
// Header global do shell — marca do produto, busca global, notificações e o menu do
// usuário (que substituiu o bloco de usuário/Sair que ficava no rodapé da Sidebar).
// No mobile também abriga o gatilho do menu lateral (era a MobileTopBar do App.tsx).

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Menu, Bell, ChevronDown, LogOut, User as UserIcon, Settings } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useMobileMenu } from '../contexts/MobileMenuContext';
import { usePermissoes } from '../hooks/usePermissoes';
import { useVetPendentes } from '../hooks/useVetPendentes';
import BrandS2Vet from './BrandS2Vet';
import BuscaGlobal from './BuscaGlobal';

/** Selo do perfil no contexto ativo — mesma escala de cores usada na Sidebar */
function seloPerfil(role: string, userType: string, isAdmin: boolean, isGestor: boolean) {
  if (isAdmin)                                                 return { texto: 'ADMIN',  cls: 'bg-emerald-100 text-emerald-700' };
  if (isGestor)                                                return { texto: 'GESTOR', cls: 'bg-purple-100 text-purple-700' };
  if (role === 'VETERINARIO' || userType === 'VETERINARIO')    return { texto: 'VET',    cls: 'bg-blue-100 text-blue-700' };
  if (role === 'ESTAGIARIO'  || userType === 'ESTAGIARIO')     return { texto: 'EST',    cls: 'bg-purple-100 text-purple-700' };
  if (userType === 'FORNECEDOR')                               return { texto: 'PREST.', cls: 'bg-amber-100 text-amber-700' };
  if (userType === 'PROPRIETARIO')                             return { texto: 'CLIENTE', cls: 'bg-gray-100 text-gray-600' };
  return null;
}

export default function AppHeader() {
  const { user, logout } = useAuth();
  const { setOpen }      = useMobileMenu();
  const { isGestor }     = usePermissoes();
  const pendentes        = useVetPendentes();
  const navigate         = useNavigate();

  const [menuAberto, setMenuAberto] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuAberto) return;
    const aoClicar = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuAberto(false);
    };
    document.addEventListener('mousedown', aoClicar);
    return () => document.removeEventListener('mousedown', aoClicar);
  }, [menuAberto]);

  const role     = (user?.role     ?? user?.userType ?? '').toUpperCase();
  const userType = (user?.userType ?? '').toUpperCase();
  const isAdmin  = role === 'ADMIN';
  const selo     = user ? seloPerfil(role, userType, isAdmin, isGestor) : null;
  const inicial  = user?.fullName?.trim()?.[0]?.toUpperCase() ?? 'U';
  // Iniciais do primeiro e do último nome (ex.: "Maria Eduarda Costa" → "MC")
  const iniciais = (() => {
    const partes = user?.fullName?.trim().split(/\s+/).filter(Boolean) ?? [];
    if (partes.length === 0) return 'U';
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
  })();

  const aoClicarSino = () => {
    if (pendentes > 0) { navigate('/animais-vet'); return; }
    toast('Nenhuma notificação nova.', { icon: '🔔' });
  };

  // h-20 no desktop para acomodar a marca ampliada sem espremê-la
  return (
    <header
      className="flex-shrink-0 h-16 md:h-20 bg-white border-b border-gray-200 flex items-center gap-1 pr-4 md:pr-6"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      {/*
        Bloco da marca com a MESMA largura do sidebar (w-72) e conteúdo centralizado:
        é o que alinha o logo ao eixo vertical do menu logo abaixo. O padding lateral
        do header saiu daqui e foi para o bloco da direita — com `px` no <header> o
        centro do bloco não coincidiria com o centro do sidebar.
        No mobile não há sidebar (é drawer): largura natural e alinhado à esquerda,
        ao lado do gatilho do menu.
      */}
      <div className="flex items-center gap-2 px-4 md:px-0 md:w-72 md:justify-center flex-shrink-0">
        {/* Gatilho do menu lateral (mobile). Fica no header, que é um irmão flex do
            shell — sem `position: fixed`, que se desloca no iOS Safari. */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir menu"
          className="md:hidden p-2 -ml-1 text-gray-600 hover:bg-gray-100 rounded-xl flex-shrink-0"
        >
          <Menu size={22} />
        </button>

        {/* Marca do produto — só a arte: o PNG já traz o nome e a tagline escritos */}
        <Link to="/" className="flex items-center flex-shrink-0" aria-label="S2Vet — início">
          <BrandS2Vet />
        </Link>
      </div>

      {/* Busca global — ocupa o meio, com teto para não colar nas laterais */}
      <div className="flex-1 min-w-0 max-w-xl mx-auto px-2 md:px-4">
        <BuscaGlobal />
      </div>

      {/* Notificações */}
      <button
        type="button"
        onClick={aoClicarSino}
        aria-label={pendentes > 0 ? `${pendentes} notificações` : 'Notificações'}
        className="relative p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-xl flex-shrink-0"
      >
        <Bell size={20} />
        {pendentes > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] rounded-full flex items-center justify-center px-1 leading-none">
            {pendentes > 9 ? '9+' : pendentes}
          </span>
        )}
      </button>

      {/* Menu do usuário */}
      {user && (
        <div ref={menuRef} className="relative flex-shrink-0">
          <button
            type="button"
            onClick={() => setMenuAberto((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuAberto}
            className="flex items-center gap-2.5 pl-1.5 pr-2 py-1.5 rounded-2xl hover:bg-gray-100 transition-colors"
          >
            <span className="w-9 h-9 bg-emerald-100 text-emerald-700 rounded-xl flex items-center justify-center font-bold text-xs flex-shrink-0">
              {iniciais}
            </span>
            <span className="hidden md:block text-left leading-tight max-w-[10rem]">
              <span className="block text-sm font-medium text-gray-900 truncate">{user.fullName}</span>
              {selo && <span className="block text-[11px] text-gray-500">{selo.texto}</span>}
            </span>
            <ChevronDown size={16} className={`hidden md:block text-gray-400 transition-transform ${menuAberto ? 'rotate-180' : ''}`} />
          </button>

          {menuAberto && (
            <div role="menu" className="absolute right-0 mt-2 w-64 bg-white border border-gray-200 rounded-2xl shadow-lg py-2 z-50">
              <div className="px-4 py-2 border-b border-gray-100">
                <p className="text-sm font-semibold text-gray-900 truncate">{user.fullName || inicial}</p>
                <p className="text-xs text-gray-500 truncate">{user.email}</p>
                {selo && (
                  <span className={`inline-block mt-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full ${selo.cls}`}>
                    {selo.texto}
                  </span>
                )}
              </div>

              <Link
                to="/cadastro-pessoal" role="menuitem" onClick={() => setMenuAberto(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                <UserIcon size={16} /> Cadastro Pessoal
              </Link>

              {isGestor && (
                <Link
                  to="/configuracoes" role="menuitem" onClick={() => setMenuAberto(false)}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <Settings size={16} /> Configurações
                </Link>
              )}

              <button
                type="button" role="menuitem"
                onClick={() => { setMenuAberto(false); logout(); }}
                className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 border-t border-gray-100 mt-1"
              >
                <LogOut size={16} /> Sair
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
