// components/home/Nav.tsx
import { Link } from 'react-router-dom';
import BrandS2Vet from '../BrandS2Vet';
import { scrollToSection } from './scrollToSection';

export default function Nav() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50">
      <div className="mx-auto max-w-[1400px] px-8 pt-6">
        <nav className="flex items-center justify-between rounded-full border border-hairline bg-cream/70 px-6 py-3 backdrop-blur-xl">
          <a href="#" onClick={scrollToSection('topo')} className="flex items-center">
            <BrandS2Vet />
          </a>
          <div className="hidden items-center gap-10 text-sm text-ink-soft md:flex">
            <a href="#recursos" onClick={scrollToSection('recursos')} className="transition-colors hover:text-ink">Recursos</a>
            <a href="#fluxo" onClick={scrollToSection('fluxo')} className="transition-colors hover:text-ink">Fluxo</a>
            <a href="#diferenciais" onClick={scrollToSection('diferenciais')} className="transition-colors hover:text-ink">Diferenciais</a>
          </div>
          <div className="flex items-center gap-5">
            <Link to="/login" className="text-sm text-ink-soft transition-colors hover:text-ink">
              Entrar
            </Link>
            <a
              href="#demo"
              onClick={scrollToSection('demo')}
              className="rounded-full bg-forest px-5 py-2 text-sm text-cream transition-colors hover:bg-forest-deep"
            >
              Agendar demonstração
            </a>
          </div>
        </nav>
      </div>
    </header>
  );
}
