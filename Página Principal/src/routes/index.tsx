import { createFileRoute } from "@tanstack/react-router";
import { motion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
import heroClinic from "@/assets/hero-clinic.jpg";
import productEvolution from "@/assets/product-evolution.jpg";
import productPrescription from "@/assets/product-prescription.jpg";
import productReport from "@/assets/product-report.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VetMind — Software clínico veterinário de alto padrão" },
      {
        name: "description",
        content:
          "Evolução automática, prescrição digital e relatórios elegantes. O software veterinário desenhado para clínicas que exigem precisão, ritmo e requinte.",
      },
      { property: "og:title", content: "VetMind — Software clínico veterinário" },
      {
        property: "og:description",
        content:
          "Precisão clínica em uma interface silenciosa. Evolução automática, prescrição digital e relatórios que respiram.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <Nav />
      <Hero />
      <Marquee />
      <Features />
      <Workflow />
      <Differentiators />
      <ClosingCTA />
      <Footer />
    </main>
  );
}

/* -------------------- Motion helpers -------------------- */

const easeOut = [0.22, 1, 0.36, 1] as const;

function Reveal({
  children,
  delay = 0,
  y = 24,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 1.1, ease: easeOut, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* -------------------- Nav -------------------- */

function Nav() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50">
      <div className="mx-auto max-w-[1400px] px-8 pt-6">
        <nav className="flex items-center justify-between rounded-full border border-border/60 bg-cream/70 px-6 py-3 backdrop-blur-xl">
          <a href="#" className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-forest" />
            <span className="font-display text-2xl leading-none text-ink">VetMind</span>
          </a>
          <div className="hidden items-center gap-10 text-sm text-ink-soft md:flex">
            <a href="#recursos" className="transition-colors hover:text-ink">Recursos</a>
            <a href="#fluxo" className="transition-colors hover:text-ink">Fluxo</a>
            <a href="#diferenciais" className="transition-colors hover:text-ink">Diferenciais</a>
          </div>
          <a
            href="#demo"
            className="rounded-full bg-forest px-5 py-2 text-sm text-cream transition-colors hover:bg-forest-deep"
          >
            Agendar demonstração
          </a>
        </nav>
      </div>
    </header>
  );
}

/* -------------------- Hero (Rolls-Royce cinematic) -------------------- */

function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], ["0%", "18%"]);
  const scale = useTransform(scrollYProgress, [0, 1], [1, 1.08]);
  const opacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

  return (
    <section ref={ref} className="relative h-[100vh] min-h-[720px] w-full overflow-hidden">
      <motion.div style={{ y, scale }} className="absolute inset-0">
        <img
          src={heroClinic}
          alt="Veterinário examinando um cão em uma clínica clássica com paredes verde-escuro"
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
            VetMind — Clínica em movimento
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
              className="rounded-full bg-cream px-7 py-3 text-sm text-ink transition-transform hover:-translate-y-0.5"
            >
              Agendar demonstração
            </a>
            <a
              href="#recursos"
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

/* -------------------- Whisper marquee -------------------- */

function Marquee() {
  const items = [
    "Evolução automática",
    "Prescrição digital",
    "Relatórios clínicos",
    "Prontuário SOAP",
    "Agenda inteligente",
    "Integração laboratorial",
  ];
  return (
    <section className="border-y border-border bg-cream py-8">
      <div className="mx-auto max-w-[1400px] overflow-hidden px-8">
        <div className="flex items-center gap-16 whitespace-nowrap text-sm uppercase tracking-[0.2em] text-ink-soft">
          {[...items, ...items].map((label, i) => (
            <span key={i} className="flex items-center gap-16">
              <span className="h-1 w-1 rounded-full bg-sage" />
              {label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------- Features (three product moments) -------------------- */

const features = [
  {
    n: "01",
    kicker: "Evolução",
    title: "A recuperação, contada em uma única linha.",
    body: "Sinais vitais, notas de acompanhamento e resultados laboratoriais convergem em uma linha do tempo visual. O que antes exigia comparação manual, agora se apresenta em silêncio.",
    image: productEvolution,
  },
  {
    n: "02",
    kicker: "Prescrição",
    title: "Prescrever com o gesto de quem já conhece a resposta.",
    body: "Sugestões contextuais, alertas de contraindicação em tempo real e envio direto à farmácia parceira. A prescrição digital reduzida ao mínimo essencial — sem perder um único detalhe clínico.",
    image: productPrescription,
  },
  {
    n: "03",
    kicker: "Relatórios",
    title: "Relatórios que o tutor guarda.",
    body: "Cada laudo é composto com tipografia refinada, hierarquia clara e a exatidão dos dados originais. Um documento que comunica confiança antes de ser lido.",
    image: productReport,
  },
];

function Features() {
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
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], ["6%", "-6%"]);

  return (
    <div
      ref={ref}
      className={`grid gap-12 md:grid-cols-12 md:items-center ${
        reverse ? "md:[&>*:first-child]:order-2" : ""
      }`}
    >
      <Reveal className="md:col-span-7">
        <motion.div
          style={{ y }}
          className="relative overflow-hidden rounded-3xl border border-border bg-white shadow-[0_40px_80px_-40px_rgba(15,44,29,0.18)]"
        >
          <img
            src={feature.image}
            alt={feature.title}
            loading="lazy"
            width={1600}
            height={1200}
            className="h-full w-full object-cover"
          />
          <div className="absolute left-5 top-5 flex items-center gap-2 rounded-full border border-border/70 bg-cream/90 px-3 py-1.5 text-xs text-ink-soft backdrop-blur">
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

/* -------------------- Workflow -------------------- */

const workflow = [
  { t: "Chegada", d: "O tutor faz check-in. O prontuário se abre antes do primeiro cumprimento." },
  { t: "Consulta", d: "SOAP ditado por voz. Dados vitais registrados em segundos." },
  { t: "Prescrição", d: "Medicação sugerida com base no histórico. Envio direto para retirada." },
  { t: "Laudo", d: "Relatório clínico gerado ao final da consulta, pronto para o tutor." },
  { t: "Retorno", d: "Evolução comparada automaticamente. Nada se perde entre visitas." },
];

function Workflow() {
  return (
    <section id="fluxo" className="bg-forest-deep py-32 text-cream md:py-48">
      <div className="mx-auto max-w-[1400px] px-8">
        <Reveal>
          <div className="mb-20 grid gap-8 md:grid-cols-12 md:items-end">
            <div className="md:col-span-7">
              <p className="mb-6 text-xs uppercase tracking-[0.25em] text-sage">Fluxo de trabalho</p>
              <h2 className="font-display text-5xl leading-[1.02] md:text-7xl">
                Uma consulta, cinco movimentos.
              </h2>
            </div>
            <p className="text-lg text-cream/70 md:col-span-4 md:col-start-9">
              Cada etapa foi coreografada para que o clínico permaneça no paciente — não na tela.
            </p>
          </div>
        </Reveal>

        <div className="grid gap-px overflow-hidden rounded-3xl bg-cream/10 md:grid-cols-5">
          {workflow.map((step, i) => (
            <Reveal key={step.t} delay={i * 0.08}>
              <div className="group h-full bg-forest-deep p-8 transition-colors hover:bg-forest">
                <div className="mb-16 flex items-center justify-between">
                  <span className="font-display text-3xl italic text-sage">0{i + 1}</span>
                  <span className="h-px w-8 bg-cream/30 transition-all group-hover:w-14 group-hover:bg-sage" />
                </div>
                <h4 className="font-display text-3xl">{step.t}</h4>
                <p className="mt-4 text-sm leading-relaxed text-cream/70">{step.d}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------- Differentiators -------------------- */

const diffs = [
  {
    t: "Navegabilidade sem atrito",
    d: "Atalhos de teclado, arquitetura de informação enxuta e três cliques até qualquer registro. Feito para clínicas de alto volume.",
  },
  {
    t: "Silêncio como padrão",
    d: "Nada pisca sem propósito. Alertas aparecem apenas quando importam — e desaparecem quando não.",
  },
  {
    t: "Sincronização instantânea",
    d: "Tablet, workstation e celular sempre no mesmo instante. Sub-milissegundos entre dispositivos.",
  },
  {
    t: "Suporte clínico dedicado",
    d: "Especialistas que já viveram o dia a dia da clínica. Resposta em minutos, não em tickets.",
  },
];

function Differentiators() {
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

        <div className="grid gap-px bg-border md:grid-cols-2">
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

/* -------------------- Closing CTA -------------------- */

function ClosingCTA() {
  return (
    <section id="demo" className="relative overflow-hidden bg-cream py-40 md:py-56">
      <div className="mx-auto max-w-[1200px] px-8 text-center">
        <Reveal>
          <p className="mb-8 text-xs uppercase tracking-[0.25em] text-forest">Comece devagar</p>
          <h2 className="mx-auto max-w-3xl font-display text-6xl leading-[0.98] text-ink md:text-[104px]">
            Um <em className="italic">novo silêncio</em> na sua clínica.
          </h2>
          <p className="mx-auto mt-10 max-w-xl text-lg text-ink-soft">
            Agende uma demonstração privada. Um especialista VetMind conduz você pelo software, no ritmo da sua clínica.
          </p>
          <div className="mt-12 flex flex-wrap justify-center gap-4">
            <a
              href="mailto:hello@vetmind.app"
              className="rounded-full bg-forest px-8 py-4 text-sm text-cream transition-colors hover:bg-forest-deep"
            >
              Agendar demonstração
            </a>
            <a
              href="#recursos"
              className="rounded-full border border-border px-8 py-4 text-sm text-ink transition-colors hover:bg-cream-deep"
            >
              Rever recursos
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* -------------------- Footer -------------------- */

function Footer() {
  return (
    <footer className="border-t border-border bg-cream">
      <div className="mx-auto max-w-[1400px] px-8 py-14">
        <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-center">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-forest" />
            <span className="font-display text-2xl text-ink">VetMind</span>
          </div>
          <div className="flex flex-wrap gap-8 text-sm text-ink-soft">
            <a href="#recursos" className="hover:text-ink">Recursos</a>
            <a href="#fluxo" className="hover:text-ink">Fluxo</a>
            <a href="#diferenciais" className="hover:text-ink">Diferenciais</a>
            <a href="#demo" className="hover:text-ink">Demonstração</a>
          </div>
          <p className="text-xs uppercase tracking-[0.2em] text-ink-soft">
            © {new Date().getFullYear()} VetMind
          </p>
        </div>
      </div>
    </footer>
  );
}
