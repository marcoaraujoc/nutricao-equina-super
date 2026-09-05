// components/login/VitrineLogin.tsx
//
// Painel de destaque ao LADO do formulário de login (70% da tela no desktop).
//
// ⚠️ ERA UM CARROSSEL de duas abas com rotação automática e barra de progresso
// (modelo de 2026-08-29). Virou UMA FOTO SÓ a pedido do usuário em 2026-09-04:
// a imagem é um mockup de uso (o produto na mão de quem atende), e não uma
// captura de tela — trocá-la a cada 5s com uma segunda captura misturava dois
// registros visuais na mesma vitrine. Saíram as abas, o cronômetro e o deslize;
// nada aqui anima, então o tratamento de `prefers-reduced-motion` também saiu.
// Para voltar a rodar mais de um destaque, o histórico do git tem a versão com
// abas; não reintroduzir carrossel para exibir um único slide.
//
// ⚠️ NO MOBILE ESTE PAINEL NÃO APARECE (2026-09-04): a foto vira PLANO DE FUNDO
// atrás do formulário (`FundoVitrineMobile`, abaixo), para o login caber em UMA
// TELA. Empilhar a vitrine embaixo do formulário era o que fazia a página rolar.
import destaque from '../../assets/login/atendimento-mobile.jpg';

const TITULO    = 'A sua clínica em movimento';
const SUBTITULO =
  'Todo o atendimento em uma tela só - Evolução, prescrição, exames e encaminhamento no mesmo lugar';

const ALT =
  'Profissional segurando um celular com a tela de Evolução Clínica do S2Vet: '
  + 'card do paciente, abas do atendimento e histórico ao lado';

/**
 * A MESMA foto como plano de fundo, para o mobile.
 *
 * ⚠️ `opacity` bem baixa + véu branco por cima: é FUNDO, e o que tem de ser legível
 * são os campos de login. Foto a plena carga atrás de um formulário derruba o
 * contraste do texto e dos rótulos — e aqui não há como o usuário desligar.
 * ⚠️ `aria-hidden` + `pointer-events-none`: é decoração, não conteúdo. O alt da
 * versão desktop já descreve a imagem para quem usa leitor de tela.
 */
export function FundoVitrineMobile() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden lg:hidden">
      <img
        src={destaque}
        alt=""
        className="h-full w-full object-cover opacity-[0.09]"
      />
      {/* Véu de cima para baixo: mais opaco onde ficam os campos, mais leve nas
          bordas — sem ele a foto compete com o texto no meio da tela. */}
      <div className="absolute inset-0 bg-gradient-to-b from-white/80 via-white/60 to-white/85" />
    </div>
  );
}

// `className` fica a cargo de QUEM POSICIONA: no login é a coluna de 70% (>= lg).
// Fixar largura aqui dentro brigaria com o flex do pai.
export default function VitrineLogin({ className = '' }: { className?: string }) {
  return (
    <section
      aria-label="Destaque do S2Vet"
      className={`hidden lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:overflow-hidden ${className}`}
    >
      {/* 🔴 TEXTO E FOTO NO MESMO BLOCO, e é o BLOCO que é centralizado — não cada
          um por si. É isso que alinha o começo do título e do subtítulo com a
          BORDA ESQUERDA da foto (pedido de 2026-09-04). Centralizar a foto sozinha
          (`justify-center`) a deslocava para dentro da coluna enquanto o texto
          continuava colado na margem, e os dois começavam em pontos diferentes.
          ⚠️ A largura vem do BLOCO e a foto é `w-full` dele: assim os três
          compartilham exatamente a mesma caixa, em qualquer tamanho de tela.
          Amarrar a foto pela ALTURA (`max-h-full`) quebraria isso — ela encolheria
          sozinha e o texto ficaria mais largo que ela.

          🔴 A FOTO PREENCHE A COLUNA INTEIRA — largura E altura (2026-09-05).
          Antes a largura dela saía de um cálculo sobre a altura da janela
          (`(100vh-13rem)*1.43`), o que deixava uma FAIXA VAZIA na borda direita
          sempre que a janela era baixa: a foto não podia crescer para ocupá-la sem
          estourar a altura. Agora a coluna toma todo o espaço que o formulário não
          usa e a foto ocupa a coluna; o que sobra de proporção é resolvido por
          `object-cover`, recortando o mínimo necessário.
          ⚠️ `object-cover` aqui é seguro porque o recorte é PEQUENO e simétrico — a
          caixa fica perto da proporção da foto (1,43). O que se corta é o fundo
          desfocado em cima e a manga do jaleco embaixo; o celular está centralizado.
          NÃO usar `cover` numa caixa muito mais larga que alta (foi por isso que ele
          foi recusado quando a foto vivia numa coluna fixa de 70%): ali o recorte
          passava de 40% e cortava o celular ao meio.
          ⚠️ Texto e foto continuam `w-full` do MESMO bloco — é o que mantém o
          começo do título alinhado com a borda esquerda da foto. */}
      <div className="flex w-full flex-col lg:h-full lg:min-h-0">
        {/* Fonte de título (Instrument Serif, `font-display`) — a mesma da página
            institucional; esta tela é pública e pertence ao mesmo conjunto. */}
        <h2 className="font-display text-3xl leading-tight text-gray-900 sm:text-4xl">
          {TITULO}
        </h2>
        <p className="mt-2 text-sm italic leading-relaxed text-gray-500 sm:text-base">
          {SUBTITULO}
        </p>

        {/* 🔴 A CAIXA É A PRÓPRIA FOTO — sem moldura com fundo por baixo. Com um
            retângulo esticando junto da coluna, o `object-contain` deixava uma
            faixa do fundo de cada lado (a coluna de 70% é mais larga que a
            proporção da foto): era a "margem de branco nas laterais" relatada.
            ⚠️ O ARQUIVO NÃO É RECORTADO. Recortar foi tentado e RECUSADO — o
            enquadramento do mockup está certo como veio. Ao TROCAR a foto, meça
            antes se ela tem faixa lisa nas bordas e reduza o arquivo (a atual veio
            com 1,9 MB e foi reamostrada para 2000px / ~180 kB; a tela nunca passa
            de ~1400px e a vitrine carrega com `eager`, na primeira tela). */}
        <img
          src={destaque}
          alt={ALT}
          loading="eager"
          className="mt-5 w-full flex-1 rounded-2xl object-cover shadow-sm lg:min-h-0"
        />
      </div>
    </section>
  );
}
