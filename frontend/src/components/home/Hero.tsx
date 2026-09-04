// components/home/Hero.tsx
import { motion, useScroll, useTransform } from 'motion/react';
import { useRef } from 'react';
import heroHaras from '../../assets/home/beico-haras.jpg';
import { easeOut } from './Reveal';

export default function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], ['0%', '18%']);
  const scale = useTransform(scrollYProgress, [0, 1], [1, 1.08]);
  const opacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

  return (
    // bg-ink: a foto entra em opacidade CHEIA (2026-08-29), então isto deixou de
    // ser o que a escurece. Fica por dois motivos que continuam valendo: é o
    // fundo enquanto a imagem carrega (sem ele o hero pisca branco antes de
    // pintar), e cobre a área que o parallax descola — por isso mora na
    // <section>, e não na div transformada.
    <section id="topo" ref={ref} className="relative h-[100vh] min-h-[720px] w-full overflow-hidden bg-ink">
      <motion.div style={{ y, scale }} className="absolute inset-0">
        {/* object-bottom, não object-center: a foto é RETRATO (1126x1280) num
            hero deitado, então o object-cover descarta ~50% da altura. O cavalo
            está no terço de baixo — centralizado, aparecia só o céu. */}
        <img
          src={heroHaras}
          alt="Cavalo em um haras ao entardecer"
          className="h-full w-full object-cover object-bottom"
          width={1126}
          height={1280}
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
            O cuidado <em className="italic text-cream/95">veterinário</em>
            <br />
            por trás da clínica moderna.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.6, ease: easeOut, delay: 0.9 }}
            className="mt-8 max-w-xl text-lg text-white"
          >
            Um software veterinário desenhado para far mobilidade ao Veterinário. Evolução automática, prescrição digital e relatórios de precisão — em uma interface simples e interativa.
          </motion.p>
        </div>
      </motion.div>
    </section>
  );
}
