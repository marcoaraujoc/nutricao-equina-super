// components/home/Nav.tsx
import { Link } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import LinkMarcaS2Vet from '../LinkMarcaS2Vet';
import { scrollToSection } from './scrollToSection';

// A barra troca de pele conforme o que está ATRÁS dela (pedido de 2026-08-29):
//
//   sobre a foto do hero  -> pílula escura + links BRANCOS
//   sobre o corpo da página -> pílula clara  + links VERDE ESMERALDA
//
// Por que as duas coisas andam juntas: o Nav é `fixed` e atravessa a página
// inteira. Branco só se lê sobre escuro (branco na pílula cream/70 original dava
// ~1,7:1 de contraste) e esmeralda só se lê sobre claro — fixar UM par de cores
// deixaria metade do percurso ilegível.
export default function Nav() {
  const navRef = useRef<HTMLElement>(null);
  const [sobreFoto, setSobreFoto] = useState(true);

  useEffect(() => {
    // "Sobre a foto" = a barra ainda está dentro do hero. O limite é o RODAPÉ da
    // própria barra, medido, e não um número fixo: o hero é `h-[100vh]` com
    // `min-h-[720px]` e a marca muda de altura no breakpoint md, então qualquer
    // constante escrita aqui erraria em alguma tela ou ao redimensionar.
    const avaliar = () => {
      const hero = document.getElementById('topo');
      if (!hero) {
        // Sem hero na página, o fundo é sempre claro — nunca deixar branco.
        setSobreFoto(false);
        return;
      }
      const limite = navRef.current?.getBoundingClientRect().bottom ?? 96;
      setSobreFoto(hero.getBoundingClientRect().bottom > limite);
    };

    avaliar();
    // passive: o listener só lê geometria, nunca chama preventDefault — sem isto
    // o navegador precisa esperar o handler antes de rolar.
    window.addEventListener('scroll', avaliar, { passive: true });
    window.addEventListener('resize', avaliar);
    return () => {
      window.removeEventListener('scroll', avaliar);
      window.removeEventListener('resize', avaliar);
    };
  }, []);

  // ⚠️ Valor ARBITRÁRIO, e não `bg-ink/45` / `bg-cream/70`: o modificador de
  // opacidade NÃO funciona nos tokens da Home. Eles estão declarados como
  // `oklch(...)` puro no tailwind.config.js, formato que o Tailwind v3 não sabe
  // fatiar para injetar alfa — a classe é descartada em silêncio e a pílula fica
  // SEM fundo nenhum. Escrever o oklch inteiro aqui (com o alfa embutido) é o que
  // faz a regra existir no CSS. Se um dia os tokens ganharem `<alpha-value>`,
  // isto pode voltar a ser `bg-ink/45` / `bg-cream/70`.
  const pilula = sobreFoto
    ? 'border-white/15 bg-[oklch(0.18_0.015_160/0.45)]'
    : 'border-hairline bg-[oklch(0.985_0.006_90/0.75)]';
  const corLink = sobreFoto ? 'text-white/85' : 'text-emerald-600';
  const corHover = sobreFoto ? 'hover:text-white' : 'hover:text-emerald-700';

  return (
    <header className="fixed top-0 left-0 right-0 z-50">
      <div className="mx-auto max-w-[1400px] px-8 pt-6">
        <nav
          ref={navRef}
          className={`flex items-center justify-between rounded-full border px-6 py-3 backdrop-blur-xl transition-colors duration-300 ${pilula}`}
        >
          {/* Marca na COR ORIGINAL (verde), por decisão do usuário em 2026-08-29
              — chegou a ser invertida para branco por causa da pílula escura e foi
              revertida. Não reintroduzir o filtro sem pedido.
              O clique SEMPRE volta ao site principal ("/"); estando já nele, rola
              até o topo — ver components/LinkMarcaS2Vet.tsx. */}
          <LinkMarcaS2Vet />
          <div className={`hidden items-center gap-10 text-sm transition-colors duration-300 md:flex ${corLink}`}>
            <a href="#recursos" onClick={scrollToSection('recursos')} className={`transition-colors ${corHover}`}>Recursos</a>
            <a href="#fluxo" onClick={scrollToSection('fluxo')} className={`transition-colors ${corHover}`}>Fluxo</a>
            <a href="#diferenciais" onClick={scrollToSection('diferenciais')} className={`transition-colors ${corHover}`}>Diferenciais</a>
          </div>
          <div className="flex items-center gap-5">
            <Link to="/login" className={`text-sm transition-colors duration-300 ${corLink} ${corHover}`}>
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
