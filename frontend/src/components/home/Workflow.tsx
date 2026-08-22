// components/home/Workflow.tsx
import Reveal from './Reveal';

const workflow = [
  { t: 'Chegada', d: 'O tutor faz check-in. O prontuário se abre antes do primeiro cumprimento.' },
  { t: 'Consulta', d: 'SOAP ditado por voz. Dados vitais registrados em segundos.' },
  { t: 'Prescrição', d: 'Medicação sugerida com base no histórico. Envio direto para retirada.' },
  { t: 'Laudo', d: 'Relatório clínico gerado ao final da consulta, pronto para o tutor.' },
  { t: 'Retorno', d: 'Evolução comparada automaticamente. Nada se perde entre visitas.' },
];

export default function Workflow() {
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
