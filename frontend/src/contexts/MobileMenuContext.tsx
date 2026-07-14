// src/contexts/MobileMenuContext.tsx
// Estado compartilhado do drawer lateral no mobile. Fica num contexto para que a
// barra superior (renderizada dentro do <main>, no App) e o Sidebar (o drawer em si)
// compartilhem o mesmo aberto/fechado. Evita o botão `position: fixed`, que no
// iOS Safari se comporta mal dentro do shell com scroll interno.

import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

interface MobileMenuCtx {
  open:    boolean;
  setOpen: (v: boolean) => void;
}

const Ctx = createContext<MobileMenuCtx | null>(null);

export function MobileMenuProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <Ctx.Provider value={{ open, setOpen }}>{children}</Ctx.Provider>;
}

export function useMobileMenu(): MobileMenuCtx {
  const ctx = useContext(Ctx);
  // Fallback seguro caso algum consumidor fique fora do provider (não deve ocorrer)
  if (!ctx) return { open: false, setOpen: () => {} };
  return ctx;
}
