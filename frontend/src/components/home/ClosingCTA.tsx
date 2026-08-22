// components/home/ClosingCTA.tsx
import { scrollToSection } from './scrollToSection';
import Reveal from './Reveal';

// TODO: endereço de contato provisório — trocar pelo e-mail comercial real da S2Vet.
const EMAIL_CONTATO = 'contato@s2vet.com.br';

export default function ClosingCTA() {
  return (
    <section id="demo" className="relative overflow-hidden bg-cream py-40 md:py-56">
      <div className="mx-auto max-w-[1200px] px-8 text-center">
        <Reveal>
          <p className="mb-8 text-xs uppercase tracking-[0.25em] text-forest">Comece devagar</p>
          <h2 className="mx-auto max-w-3xl font-display text-6xl leading-[0.98] text-ink md:text-[104px]">
            Um <em className="italic">novo silêncio</em> na sua clínica.
          </h2>
          <p className="mx-auto mt-10 max-w-xl text-lg text-ink-soft">
            Agende uma demonstração privada. Um especialista S2Vet conduz você pelo software, no ritmo da sua clínica.
          </p>
          <div className="mt-12 flex flex-wrap justify-center gap-4">
            <a
              href={`mailto:${EMAIL_CONTATO}`}
              className="rounded-full bg-forest px-8 py-4 text-sm text-cream transition-colors hover:bg-forest-deep"
            >
              Agendar demonstração
            </a>
            <a
              href="#recursos"
              onClick={scrollToSection('recursos')}
              className="rounded-full border border-hairline px-8 py-4 text-sm text-ink transition-colors hover:bg-cream-deep"
            >
              Rever recursos
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
