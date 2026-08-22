// components/home/Hero.tsx
import { motion, useScroll, useTransform } from 'motion/react';
import { useRef } from 'react';
import heroClinic from '../../assets/home/hero-clinic.jpg';
import { scrollToSection } from './scrollToSection';
import { easeOut } from './Reveal';

export default function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], ['0%', '18%']);
  const scale = useTransform(scrollYProgress, [0, 1], [1, 1.08]);
  const opacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

  return (
    <section id="topo" ref={ref} className="relative h-[100vh] min-h-[720px] w-full overflow-hidden">
      <motion.div style={{ y, scale }} className="absolute inset-0">
        <img
          src={heroClinic}
          alt="Veterinário examinando um cavalo em uma clínica"
          className="h-full w-full object-cover"
          width={1800}
          height={1200}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-ink/40 via-ink/20 to-cream" />
      </motion.div>

      <motion.div style={{ opacity }} className="relative z-10 flex h-full flex-col justify-between px-8 pb-16 pt-32 md:pt-40">
        <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col justify-end">
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.4, ease: easeOut, delay: 0.3 }}
            className="mb-6 text-xs uppercase tracking-[0.25em] text-cream/80"
          >
            S2Vet — Clínica em movimento
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.6, ease: easeOut, delay: 0.5 }}
            className="font-display text-[64px] leading-[0.95] text-cream md:text-[104px]"
          >
            O cuidado <em className="italic text-cream/95">discreto</em>
            <br />
            por trás da clínica moderna.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.6, ease: easeOut, delay: 0.9 }}
            className="mt-8 max-w-xl text-lg text-cream/85"
          >
            Um software veterinário desenhado para desaparecer. Evolução automática, prescrição digital e relatórios de precisão — em uma interface silenciosa.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.6, ease: easeOut, delay: 1.15 }}
            className="mt-10 flex flex-wrap items-center gap-4"
          >
            <a
              href="#demo"
              onClick={scrollToSection('demo')}
              className="rounded-full bg-cream px-7 py-3 text-sm text-ink transition-transform hover:-translate-y-0.5"
            >
              Agendar demonstração
            </a>
            <a
              href="#recursos"
              onClick={scrollToSection('recursos')}
              className="rounded-full border border-cream/40 px-7 py-3 text-sm text-cream transition-colors hover:bg-cream/10"
            >
              Explorar recursos
            </a>
          </motion.div>
        </div>
      </motion.div>
    </section>
  );
}
