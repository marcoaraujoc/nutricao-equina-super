// components/login/VitrineLogin.tsx
//
// Painel de destaques ao LADO do formulário de login (70% da tela no desktop),
// no formato do modelo gravado em 2026-08-29: ABAS no topo, título, subtítulo e
// a captura da tela ocupando todo o resto — trocando sozinha.
//
// ⚠️ São DUAS abas, não três. A referência (app.simples.vet) tem três; aqui o par
// cobre o que o S2Vet quer mostrar de cara — como se registra (Praticidade) e o
// que se enxerga depois (Históricos Analíticos). Slide novo entra em `SLIDES`;
// nada mais precisa mudar.
import { useEffect, useRef, useState } from 'react';
import evolucao from '../../assets/login/evolucao.png';
import painel from '../../assets/login/painel.png';

interface Slide {
  chave:  string;
  aba:    string;   // rótulo curto, na aba
  titulo: string;   // manchete do painel
  texto:  string;   // uma linha explicando
  img:    string;
  alt:    string;
}

const SLIDES: Slide[] = [
  {
    chave:  'praticidade',
    aba:    'Praticidade',
    titulo: 'Todo o atendimento em uma tela só',
    texto:  'Evolução, prescrição, exames e encaminhamento no mesmo lugar — com ditado por voz e anexos, sem sair do paciente.',
    img:    evolucao,
    alt:    'Tela de Evolução Clínica do S2Vet, com as abas do atendimento e o histórico do paciente ao lado',
  },
  {
    chave:  'historicos',
    aba:    'Históricos Analíticos',
    titulo: 'O histórico do paciente, analisado',
    texto:  'Linha do tempo completa e a Memória Clínica destacando os padrões entre um atendimento e outro.',
    img:    painel,
    alt:    'Tela de Detalhamento do Animal do S2Vet, com histórico, memória clínica e agendamentos',
  },
];

const INTERVALO_MS = 5000;

// `className` fica a cargo de QUEM POSICIONA: no login é a coluna de 70% (>= lg)
// e o bloco empilhado abaixo do formulário (< lg). Fixar largura aqui dentro
// brigaria com o flex do pai.
export default function VitrineLogin({ className = '' }: { className?: string }) {
  const [atual, setAtual] = useState(0);
  const [semAnimacao, setSemAnimacao] = useState(false);
  const barraRef = useRef<HTMLSpanElement>(null);

  // ⚠️ A rotação é SEMPRE automática (pedido de 2026-08-29). Havia aqui uma
  // pausa ao passar o mouse — o padrão de carrossel — e ela era um tiro no pé
  // NESTA tela: o painel ocupa 70% da largura, então o cursor parado em
  // qualquer lugar congelava a troca e a vitrine parecia quebrada.
  useEffect(() => {
    const t = setInterval(() => setAtual(i => (i + 1) % SLIDES.length), INTERVALO_MS);
    return () => clearInterval(t);
    // `atual` na lista reinicia a contagem quando alguém escolhe uma aba na mão:
    // sem isso o próximo salto automático poderia vir no instante seguinte ao
    // clique, tirando da tela o slide que a pessoa acabou de pedir.
  }, [atual]);

  // ── Relógio da barra ───────────────────────────────────────────────
  // A barra enche por JS, escrevendo `transform` DIRETO no nó a cada quadro.
  //
  // ⚠️ Era uma animação de keyframe do CSS e NÃO enchia na máquina do usuário
  // (relatado em 2026-08-29). Animação de CSS morre calada por vários motivos —
  // `prefers-reduced-motion` ligado no sistema, o nó sendo reaproveitado em vez
  // de remontado, a classe não chegando ao CSS gerado. O relógio em JS não
  // depende de nada disso: ou o quadro roda, ou a página inteira travou.
  //
  // ⚠️ Escreve no DOM por `ref`, NÃO por estado: `setState` a 60fps
  // re-renderizaria a vitrine inteira — imagens e tudo — sessenta vezes por
  // segundo, para mexer 2px de barra.
  //
  // A barra é CRONÔMETRO, não enfeite: responde "quanto falta para trocar". Por
  // isso corre mesmo com `prefers-reduced-motion`; o que aquele ajuste desliga
  // aqui é o DESLIZE do slide, no efeito abaixo.
  useEffect(() => {
    const el = barraRef.current;
    if (!el) return;
    let quadro = 0;
    const inicio = performance.now();
    const passo = (agora: number) => {
      const fracao = Math.min((agora - inicio) / INTERVALO_MS, 1);
      el.style.transform = `scaleX(${fracao})`;
      if (fracao < 1) quadro = requestAnimationFrame(passo);
    };
    el.style.transform = 'scaleX(0)';
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
    // `atual` reinicia o relógio junto com o slide — inclusive quando a troca
    // vem de um clique na aba, e não do temporizador.
  }, [atual]);

  // Quem pediu menos movimento no sistema continua vendo os dois destaques — o
  // que sai é o DESLIZE, não a troca. Parar a rotação esconderia conteúdo; tirar
  // a animação atende o pedido de acessibilidade sem custo nenhum.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const aplicar = () => setSemAnimacao(mq.matches);
    aplicar();
    mq.addEventListener('change', aplicar);
    return () => mq.removeEventListener('change', aplicar);
  }, []);

  return (
    <section
      aria-roledescription="carrossel"
      aria-label="Destaques do S2Vet"
      className={`flex flex-col lg:h-full lg:min-h-0 ${className}`}
    >
      {/* ── Abas ───────────────────────────────────────────────────
          São a navegação do carrossel (o modelo usa abas, não pontinhos): dizem
          QUAIS são os destaques mesmo sem esperar a rotação chegar neles.

          Cada aba ocupa METADE da largura (`flex-1`) e leva o próprio pedaço da
          barra embaixo — juntos os dois trilhos formam uma linha contínua de
          ponta a ponta, dividida ao meio. O título fica alinhado à ESQUERDA do
          seu pedaço, como no modelo gravado. */}
      <div role="tablist" aria-label="Destaques" className="flex flex-shrink-0">
        {SLIDES.map((s, i) => (
          <button
            key={s.chave}
            type="button"
            role="tab"
            aria-selected={i === atual}
            onClick={() => setAtual(i)}
            className={`relative flex-1 pb-3 pr-4 text-left text-sm transition-colors ${
              i === atual
                ? 'font-semibold text-emerald-700'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {s.aba}

            {/* Trilho da metade. `aria-hidden`: é cronômetro visual, e o leitor de
                tela já sabe qual aba está ativa pelo `aria-selected`. */}
            <span
              aria-hidden="true"
              className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden rounded-full bg-gray-200"
            >
              {i === atual && (
                // `scaleX` a partir da esquerda — transform não dispara layout,
                // então a barra corre sem concorrer com o deslize do slide.
                // Começa em 0 no próprio atributo: se o primeiro quadro demorar,
                // a barra aparece VAZIA e enche — nunca cheia voltando ao zero.
                <span
                  ref={barraRef}
                  className="block h-full w-full origin-left bg-emerald-600"
                  style={{ transform: 'scaleX(0)' }}
                />
              )}
            </span>
          </button>
        ))}
      </div>

      {/* ── Conteúdo ──────────────────────────────────────────────────────────
          A janela recorta; a esteira desliza. `translateX` por índice mantém os
          dois slides montados, então a imagem do seguinte já vem carregada e a
          troca não pisca.
          ⚠️ `lg:min-h-0` é o que permite a imagem encolher para caber na altura
          da coluna: sem ele o item de flex assume `min-height:auto` e estoura. */}
      <div className="overflow-hidden pt-6 lg:min-h-0 lg:flex-1">
        <div
          className={`flex lg:h-full ${
            semAnimacao ? '' : 'transition-transform duration-700 ease-out'
          }`}
          style={{ transform: `translateX(-${atual * 100}%)` }}
        >
          {SLIDES.map((s, i) => (
            <div
              key={s.chave}
              className="flex w-full min-w-0 flex-shrink-0 flex-col px-1 lg:h-full"
              // O slide fora de vista sai da ordem de tabulação e do leitor de
              // tela: sem isto, o Tab some para dentro de um conteúdo invisível.
              aria-hidden={i !== atual}
              {...(i !== atual ? { inert: '' } : {})}
            >
              <h2 className="flex-shrink-0 text-xl font-semibold text-gray-900 sm:text-2xl">
                {s.titulo}
              </h2>
              <p className="mt-2 flex-shrink-0 text-sm leading-relaxed text-gray-500">
                {s.texto}
              </p>

              {/* Caixa da captura. No MOBILE a altura vem da proporção da imagem
                  (`aspect-*`) — ali o pai não tem altura definida e `flex-1` daria
                  zero. No desktop ela ocupa a sobra da coluna. */}
              <div className="mt-5 aspect-[1231/730] overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 shadow-sm lg:aspect-auto lg:min-h-0 lg:flex-1">
                {/* `object-contain`: a captura é a tela INTEIRA do produto, e
                    recortá-la para preencher esconderia justamente o que se quer
                    mostrar. `loading` só no segundo — adiar o primeiro atrasaria
                    o que já está visível. */}
                <img
                  src={s.img}
                  alt={s.alt}
                  loading={i === 0 ? 'eager' : 'lazy'}
                  className="h-full w-full object-contain"
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
