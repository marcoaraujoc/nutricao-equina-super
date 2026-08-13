// src/components/AppHeader.tsx
// Header global do shell — marca do produto, busca global e o menu do usuário (que
// substituiu o bloco de usuário/Sair que ficava no rodapé da Sidebar).
// No mobile também abriga o gatilho do menu lateral (era a MobileTopBar do App.tsx).
//
// ⚠️ O SINO SAIU (fase 3 do multi-tenancy). A única coisa que ele notificava eram as
// solicitações de vínculo vet↔animal, que deixaram de existir: o profissional passou a
// enxergar o paciente por pertencer à EMPRESA, sem pedir nem aprovar nada. Sem fonte,
// o botão só teria um estado — "Nenhuma notificação nova." — e botão que nunca faz
// nada é cromo morto. Quando houver notificação de verdade para dar, ele volta com ela.

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, ChevronDown, LogOut, User, Building2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useEmpresa } from '../contexts/EmpresaContext';
import { useMobileMenu } from '../contexts/MobileMenuContext';
import { usePermissoes } from '../hooks/usePermissoes';
import BrandS2Vet from './BrandS2Vet';
import BuscaGlobal from './BuscaGlobal';
import SeletorContexto from './SeletorContexto';

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
  const { opcoes }       = useEmpresa();

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
  // Mesma regra do Sidebar (podVerCadastroPessoal): estagiário e proprietário não têm
  // Cadastro Pessoal próprio de profissional.
  const isEstagiario         = role === 'ESTAGIARIO' || userType === 'ESTAGIARIO';
  const isProprietario       = userType === 'PROPRIETARIO';
  const podeVerCadastroPessoal = !isEstagiario && !isProprietario;
  // Iniciais do primeiro e do último nome (ex.: "Maria Eduarda Costa" → "MC")
  const iniciais = (() => {
    const partes = user?.fullName?.trim().split(/\s+/).filter(Boolean) ?? [];
    if (partes.length === 0) return 'U';
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
  })();

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

      {/* Menu do usuário — identidade + troca de empresa/equipe. "Cadastro Pessoal"
          e "Cadastro da Empresa" saíram daqui em 2026-08-18 (já existiam no Sidebar
          e duplicavam entrada) mas voltaram para QUEM SÓ TEM UMA EMPRESA: sem
          mais de uma opção, SeletorContexto (`embedded`) renderiza null e o menu
          abria vazio — sem nenhum atalho, o dropdown virava cromo morto para quem
          não troca de contexto. Com >1 opção o seletor de contexto continua sendo
          o conteúdo do menu, como antes. */}
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
            <div
              role="menu"
              className={`absolute right-0 mt-2 max-w-[calc(100vw-2rem)] bg-white border border-gray-200 rounded-2xl shadow-lg py-2 z-50 ${
                opcoes.length > 1 ? 'w-80' : 'w-52'
              }`}
            >
              {opcoes.length > 1 ? (
                <SeletorContexto embedded onTrocar={() => setMenuAberto(false)} />
              ) : (
                <div role="group" aria-label="Configurações">
                  <p className="px-4 pt-1 pb-2 text-[11px] font-bold text-gray-400 uppercase tracking-wide">
                    Configurações
                  </p>
                  <div className="py-1">
                    {podeVerCadastroPessoal && (
                      <Link
                        to="/cadastro-pessoal"
                        role="menuitem"
                        onClick={() => setMenuAberto(false)}
                        className="flex items-center gap-2 px-2 py-1 hover:bg-emerald-500/15"
                      >
                        <span className="flex items-center gap-2.5 flex-1 min-w-0 text-left px-1 py-1">
                          <span className="w-7 h-7 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
                            <User size={15} />
                          </span>
                          <span className="text-sm text-gray-900 truncate">Pessoal</span>
                        </span>
                      </Link>
                    )}
                    {isGestor && (
                      <Link
                        to="/cadastro/empresa"
                        role="menuitem"
                        onClick={() => setMenuAberto(false)}
                        className="flex items-center gap-2 px-2 py-1 hover:bg-emerald-500/15"
                      >
                        <span className="flex items-center gap-2.5 flex-1 min-w-0 text-left px-1 py-1">
                          <span className="w-7 h-7 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
                            <Building2 size={15} />
                          </span>
                          <span className="text-sm text-gray-900 truncate">Empresa</span>
                        </span>
                      </Link>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Sair — FORA do dropdown, sempre visível ao lado do menu do usuário.
          Sair é a ação mais frequente do header e não deve custar dois cliques
          (abrir o menu + escolher). No mobile fica só o ícone: o rótulo cabe no
          `aria-label`/`title`, que é o que dá nome ao botão para leitor de tela. */}
      {user && (
        <button
          type="button"
          onClick={logout}
          title="Sair"
          aria-label="Sair"
          className="flex items-center gap-2 flex-shrink-0 px-2.5 md:px-3 py-2 rounded-xl text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
        >
          <LogOut size={18} />
          <span className="hidden md:inline">Sair</span>
        </button>
      )}
    </header>
  );
}
