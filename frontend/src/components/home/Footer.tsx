// components/home/Footer.tsx
import { Link } from 'react-router-dom';
import BrandS2Vet from '../BrandS2Vet';
import { scrollToSection } from './scrollToSection';

export default function Footer() {
  return (
    <footer className="border-t border-hairline bg-cream">
      <div className="mx-auto max-w-[1400px] px-8 py-14">
        <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-center">
          <BrandS2Vet size="sm" />
          <div className="flex flex-wrap gap-8 text-sm text-ink-soft">
            <a href="#recursos" onClick={scrollToSection('recursos')} className="hover:text-ink">Recursos</a>
            <a href="#fluxo" onClick={scrollToSection('fluxo')} className="hover:text-ink">Fluxo</a>
            <a href="#diferenciais" onClick={scrollToSection('diferenciais')} className="hover:text-ink">Diferenciais</a>
            <a href="#demo" onClick={scrollToSection('demo')} className="hover:text-ink">Demonstração</a>
            <Link to="/login" className="hover:text-ink">Entrar</Link>
          </div>
          <p className="text-xs uppercase tracking-[0.2em] text-ink-soft">
            © {new Date().getFullYear()} S2Vet
          </p>
        </div>
      </div>
    </footer>
  );
}
