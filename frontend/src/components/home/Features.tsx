// components/home/Features.tsx
import { motion, useScroll, useTransform } from 'motion/react';
import { useRef } from 'react';
import productEvolution from '../../assets/home/product-evolution.jpg';
import productPrescription from '../../assets/home/product-prescription.jpg';
import productReport from '../../assets/home/product-report.jpg';
import { scrollToSection } from './scrollToSection';
import Reveal from './Reveal';

const features = [
  {
    n: '01',
    kicker: 'Evolução',
    title: 'A recuperação, contada em uma única linha.',
    body: 'Sinais vitais, notas de acompanhamento e resultados laboratoriais convergem em uma linha do tempo visual. O que antes exigia comparação manual, agora se apresenta em silêncio.',
    image: productEvolution,
  },
  {
    n: '02',
    kicker: 'Prescrição',
    title: 'Prescrever com o gesto de quem já conhece a resposta.',
    body: 'Sugestões contextuais, alertas de contraindicação em tempo real e envio direto à farmácia parceira. A prescrição digital reduzida ao mínimo essencial — sem perder um único detalhe clínico.',
    image: productPrescription,
  },
  {
    n: '03',
    kicker: 'Relatórios',
    title: 'Relatórios que o tutor guarda.',
    body: 'Cada laudo é composto com tipografia refinada, hierarquia clara e a exatidão dos dados originais. Um documento que comunica confiança antes de ser lido.',
    image: productReport,
  },
];

export default function Features() {
  return (
    <section id="recursos" className="relative bg-cream py-32 md:py-48">
      <div className="mx-auto max-w-[1400px] px-8">
        <Reveal>
          <div className="mb-24 max-w-3xl">
            <p className="mb-6 text-xs uppercase tracking-[0.25em] text-forest">Recursos</p>
            <h2 className="font-display text-5xl leading-[1.02] text-ink md:text-7xl">
              Três gestos essenciais. Executados com precisão milimétrica.
            </h2>
          </div>
        </Reveal>

        <div className="space-y-40 md:space-y-56">
          {features.map((f, i) => (
            <FeatureRow key={f.n} feature={f} reverse={i % 2 === 1} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureRow({
  feature,
  reverse,
}: {
  feature: (typeof features)[number];
  reverse: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], ['6%', '-6%']);

  return (
    <div
      ref={ref}
      className={`grid gap-12 md:grid-cols-12 md:items-center ${
        reverse ? 'md:[&>*:first-child]:order-2' : ''
      }`}
    >
      <Reveal className="md:col-span-7">
        <motion.div
          style={{ y }}
          className="relative overflow-hidden rounded-3xl border border-hairline bg-white shadow-[0_40px_80px_-40px_rgba(15,44,29,0.18)]"
        >
          <img
            src={feature.image}
            alt={feature.title}
            loading="lazy"
            width={1600}
            height={1200}
            className="h-full w-full object-cover"
          />
          <div className="absolute left-5 top-5 flex items-center gap-2 rounded-full border border-hairline/70 bg-cream/90 px-3 py-1.5 text-xs text-ink-soft backdrop-blur">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-forest opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-forest" />
            </span>
            Em movimento
          </div>
        </motion.div>
      </Reveal>

      <div className="md:col-span-5 md:pl-12">
        <Reveal delay={0.15}>
          <p className="mb-8 font-display text-6xl italic text-forest/40">{feature.n}</p>
          <p className="mb-4 text-xs uppercase tracking-[0.25em] text-forest">{feature.kicker}</p>
          <h3 className="font-display text-4xl leading-tight text-ink md:text-5xl">{feature.title}</h3>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-ink-soft">{feature.body}</p>
          <a
            href="#demo"
            onClick={scrollToSection('demo')}
            className="mt-8 inline-flex items-center gap-2 text-sm text-forest transition-transform hover:translate-x-1"
          >
            Ver em ação
            <span aria-hidden>→</span>
          </a>
        </Reveal>
      </div>
    </div>
  );
}
