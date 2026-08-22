// components/home/Differentiators.tsx
import Reveal from './Reveal';

const diffs = [
  {
    t: 'Navegabilidade sem atrito',
    d: 'Atalhos de teclado, arquitetura de informação enxuta e três cliques até qualquer registro. Feito para clínicas de alto volume.',
  },
  {
    t: 'Silêncio como padrão',
    d: 'Nada pisca sem propósito. Alertas aparecem apenas quando importam — e desaparecem quando não.',
  },
  {
    t: 'Sincronização instantânea',
    d: 'Tablet, workstation e celular sempre no mesmo instante. Sub-milissegundos entre dispositivos.',
  },
  {
    t: 'Suporte clínico dedicado',
    d: 'Especialistas que já viveram o dia a dia da clínica. Resposta em minutos, não em tickets.',
  },
];

export default function Differentiators() {
  return (
    <section id="diferenciais" className="bg-cream py-32 md:py-48">
      <div className="mx-auto max-w-[1400px] px-8">
        <Reveal>
          <div className="mb-20 max-w-3xl">
            <p className="mb-6 text-xs uppercase tracking-[0.25em] text-forest">Diferenciais</p>
            <h2 className="font-display text-5xl leading-[1.02] text-ink md:text-7xl">
              O que raramente se encontra em softwares clínicos.
            </h2>
          </div>
        </Reveal>

        <div className="grid gap-px bg-hairline md:grid-cols-2">
          {diffs.map((d, i) => (
            <Reveal key={d.t} delay={i * 0.06}>
              <div className="h-full bg-cream p-10 md:p-14">
                <div className="mb-8 h-px w-10 bg-forest" />
                <h3 className="font-display text-3xl text-ink md:text-4xl">{d.t}</h3>
                <p className="mt-5 max-w-md text-base leading-relaxed text-ink-soft">{d.d}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
