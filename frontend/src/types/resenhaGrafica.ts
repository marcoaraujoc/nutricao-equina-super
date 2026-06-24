// src/types/resenhaGrafica.ts

/**
 * As 6 vistas de desenho persistidas no banco (cada uma vira uma linha em
 * tb_resenha_grafica). "Todos" NÃO é uma vista de persistência — é uma
 * composição visual das 6 vistas reais, renderizada na UI a partir dos
 * dados das 6 (ver FOCOS_VISTA e VistaSelecionavel abaixo). Misturar um
 * valor "TODOS" aqui criaria um estado de persistência sem sentido
 * (o que significaria salvar traços na vista "TODOS"?).
 */
export type VistaResenha =
  | 'LATERAL'
  | 'CABECA_FRONTAL'
  | 'FOCINHO'
  | 'PESCOCO_INFERIOR'
  | 'MEMBROS_ANTERIORES'
  | 'MEMBROS_POSTERIORES';

/**
 * Vistas que aparecem como abas selecionáveis na UI de edição. Estende
 * VistaResenha com 'TODOS', que é tratado de forma especial pelo
 * componente orquestrador (mostra o documento completo agregando as
 * 6 vistas reais, sem ter um foco de câmera próprio com clip-path).
 */
export type VistaSelecionavel = VistaResenha | 'TODOS';

export type TipoMarcacaoResenha = 'PELO_BRANCO' | 'CICATRIZ' | 'MANCHA' | 'REDEMOINHO';

export interface RegiaoAnatomicaEquino {
  id: number;
  codigo: string;
  labelPt: string;
  labelEn: string | null;
  labelEs: string | null;
  vista: VistaResenha;
  poligono: [number, number][];
  ativo: boolean;
  ordem: number;
}

export interface TracoResenha {
  pontos: [number, number][];
  cor: string;
  tipo: TipoMarcacaoResenha;
}

export interface ResenhaGrafica {
  id: number;
  animalId: number;
  vista: VistaResenha;
  vetorTracos: TracoResenha[];
  snapshotPng: string | null;
  versao: number;
  criadoPorId: number;
  createdAt: string;
  updatedAt: string;
}

export interface ResenhaGraficaResponse {
  resenha: ResenhaGrafica | null;
  regioesDisponiveis: RegiaoAnatomicaEquino[];
}

export interface MarcacaoResumo {
  vista: VistaResenha;
  regiaoCodigo: string;
  regiaoLabel: string;
  tipoMarcacao: TipoMarcacaoResenha;
  percentualOverlap: number | null;
}

/**
 * Dimensões totais do documento de referência fiel (viewBox completo do
 * SVG vetorizado). NUNCA recortar este SVG por viewBox parcial — essa
 * abordagem foi tentada e causou cortes incorretos em produção, porque
 * qualquer pequeno erro de calibração de borda corta partes do desenho.
 * A abordagem correta é manter o SVG inteiro sempre montado no DOM e usar
 * pan/zoom via CSS transform para focar visualmente uma área, sem nunca
 * alterar o que está de fato desenhado.
 */
export const DOCUMENTO_RESENHA_DIMENSOES = { width: 1165.441, height: 815.391 };

/**
 * Foco de câmera (pan + zoom + clip) para cada vista, usado SOMENTE para
 * a experiência de edição em tela (especialmente mobile, onde desenhar
 * com precisão exige aproximar a região de interesse). Nunca recorta o
 * SVG via viewBox — apenas centra, amplia e oculta visualmente partes
 * vizinhas via CSS (transform + clip-path).
 *
 * IMPORTANTE: estes valores foram calibrados de forma ITERATIVA E VISUAL
 * (renderizando cada vista isoladamente com Chromium real e ajustando até
 * a área de interesse aparecer completa, centrada, e SEM vazar nenhuma
 * parte de vistas vizinhas), não calculados por fórmula a partir de
 * bounding boxes simples. A primeira tentativa (só scale+translate, sem
 * clip-path) deixava vazar partes de vistas adjacentes nas bordas — bug
 * relatado em produção. A correção definitiva usa clip-path para ocultar
 * deliberadamente as áreas vizinhas antes do zoom, não apenas confiar na
 * margem do enquadramento.
 *
 * "LATERAL" é um caso especial: a cabeça frontal central se entrelaça
 * visualmente com o pescoço dos dois cavalos de perfil na mesma faixa de
 * coordenadas Y, então o clip-path usa um polígono (não um simples inset)
 * para preservar o topo das cabeças laterais enquanto oculta a cabeça
 * frontal central a partir de uma altura específica.
 *
 * Se o asset SVG for re-vetorizado ou as proporções do documento mudarem,
 * estes valores precisam ser recalibrados visualmente de novo.
 */
export interface FocoVista {
  vista: VistaSelecionavel;
  label: string;
  escala: number;
  tx: number;
  ty: number;
  /** CSS clip-path aplicado ANTES do transform de zoom, em % do documento. */
  clipPath: string | null;
  /**
   * Fração da altura do documento a exibir (0..1). O container externo usa
   * esse valor para cortar o espaço vazio abaixo da região de interesse —
   * sem alterar zoom nem coordenadas do canvas.
   * Exemplo: LATERAL=0.58 → mostra só os cavalos (Y 0–58% do documento).
   * Default: 1.0 (documento completo, sem corte).
   */
  cropHeight?: number;
}

export const FOCOS_VISTA: FocoVista[] = [
  {
    vista: 'TODOS',
    label: 'Todos',
    escala: 1.0,
    tx: 0,
    ty: 0,
    clipPath: null,
  },
  {
    vista: 'LATERAL',
    label: 'Lateral',
    escala: 0.92,
    tx: 0.0,
    ty: 17.0,
    cropHeight: 0.58,
    clipPath:
      'polygon(1.03% 24.76%, 0.64% 28.48%, 0.00% 39.01%, 0.86% 39.47%, 0.90% 42.56%, 1.24% 43.99%, 1.24% 47.99%, 0.94% 50.57%, 1.63% 52.17%, 2.10% 55.66%, 2.32% 55.83%, 4.29% 55.83%, 4.55% 55.66%, 4.46% 53.94%, 3.30% 52.00%, 3.09% 51.03%, 3.00% 49.54%, 3.13% 46.33%, 3.48% 43.24%, 4.81% 39.75%, 4.25% 46.79%, 4.38% 48.11%, 4.29% 49.25%, 4.51% 49.77%, 5.11% 50.45%, 5.15% 53.26%, 7.30% 53.31%, 7.64% 53.03%, 7.60% 52.00%, 7.08% 51.08%, 6.91% 50.05%, 6.52% 49.11%, 6.35% 48.71%, 6.22% 47.80%, 6.22% 44.94%, 6.39% 43.22%, 6.91% 40.82%, 8.84% 35.96%, 8.97% 35.33%, 10.09% 32.07%, 11.97% 29.78%, 12.36% 29.90%, 14.12% 30.98%, 16.01% 31.95%, 18.07% 32.81%, 21.37% 33.79%, 22.66% 34.01%, 23.69% 34.01%, 23.86% 34.19%, 24.21% 34.24%, 24.46% 34.53%, 24.76% 35.17%, 24.89% 35.98%, 25.49% 49.31%, 26.70% 51.14%, 26.91% 53.49%, 29.18% 53.54%, 29.36% 53.37%, 29.36% 53.03%, 29.14% 52.23%, 28.33% 50.22%, 27.38% 48.39%, 27.73% 36.20%, 28.03% 35.63%, 28.33% 37.46%, 28.88% 43.24%, 29.14% 50.85%, 29.48% 51.77%, 30.04% 52.63%, 30.17% 54.06%, 30.73% 54.86%, 32.62% 54.69%, 32.32% 53.43%, 31.20% 50.51%, 31.20% 38.89%, 31.76% 35.46%, 31.89% 33.23%, 33.39% 30.14%, 34.42% 25.79%, 35.36% 22.76%, 36.05% 21.50%, 37.47% 19.49%, 38.15% 17.32%, 38.97% 16.69%, 39.83% 16.46%, 42.36% 16.69%, 44.51% 17.32%, 45.45% 17.89%, 46.39% 19.04%, 46.82% 19.27%, 47.73% 19.09%, 48.45% 18.24%, 48.50% 18.01%, 51.29% 16.63%, 51.29% 17.55%, 51.63% 18.52%, 51.97% 18.98%, 52.75% 19.27%, 53.39% 19.15%, 54.16% 18.18%, 55.15% 17.43%, 58.11% 16.58%, 60.43% 16.52%, 61.46% 17.03%, 61.93% 17.61%, 62.19% 18.87%, 62.53% 19.67%, 63.73% 21.27%, 64.64% 22.93%, 65.11% 24.36%, 66.52% 30.20%, 68.07% 33.29%, 68.24% 36.20%, 68.84% 39.12%, 68.76% 50.34%, 67.30% 54.29%, 67.30% 54.69%, 69.31% 54.69%, 69.83% 53.89%, 69.96% 52.40%, 70.56% 51.54%, 70.77% 50.85%, 71.12% 42.16%, 71.72% 36.26%, 71.89% 35.63%, 72.15% 36.03%, 72.49% 48.45%, 71.46% 50.45%, 70.69% 52.51%, 70.56% 53.43%, 70.90% 53.54%, 72.96% 53.49%, 73.13% 53.14%, 73.22% 51.14%, 74.42% 49.25%, 75.11% 35.44%, 75.11% 35.22%, 75.36% 34.64%, 75.88% 34.19%, 78.88% 33.73%, 81.20% 33.04%, 83.61% 32.07%, 85.97% 30.87%, 87.64% 29.84%, 87.94% 29.84%, 89.53% 31.61%, 89.83% 32.13%, 91.55% 37.27%, 93.00% 40.82%, 93.30% 41.91%, 93.56% 43.62%, 93.73% 45.88%, 93.73% 48.16%, 92.92% 50.34%, 92.79% 51.14%, 92.32% 52.06%, 92.32% 53.09%, 92.83% 53.31%, 94.51% 53.31%, 94.81% 53.03%, 94.85% 50.51%, 95.45% 49.71%, 95.58% 49.31%, 95.49% 43.36%, 95.15% 39.69%, 95.71% 41.75%, 96.18% 42.50%, 96.39% 43.19%, 96.74% 45.82%, 96.91% 48.74%, 96.87% 50.45%, 96.61% 52.00%, 95.67% 53.43%, 95.36% 54.34%, 95.28% 55.15%, 95.45% 55.89%, 97.81% 55.77%, 98.20% 52.57%, 98.97% 50.45%, 98.67% 48.28%, 98.54% 44.44%, 99.06% 42.27%, 99.06% 39.47%, 99.96% 38.95%, 99.14% 26.59%, 98.76% 24.30%, 97.94% 21.84%, 96.95% 20.07%, 95.79% 18.58%, 93.82% 16.86%, 91.72% 16.18%, 87.30% 16.18%, 84.51% 16.75%, 81.72% 17.66%, 80.00% 17.78%, 77.55% 17.55%, 75.58% 16.58%, 72.58% 16.06%, 71.50% 15.37%, 69.79% 13.43%, 66.09% 10.57%, 64.25% 9.48%, 62.88% 8.97%, 61.59% 8.16%, 60.47% 7.71%, 59.87% 5.88%, 59.06% 4.90%, 58.93% 5.02%, 58.84% 5.65%, 57.98% 4.79%, 57.73% 4.85%, 57.64% 7.25%, 56.74% 8.85%, 51.59% 15.66%, 51.33% 16.58%, 48.54% 17.95%, 48.54% 15.89%, 43.22% 8.85%, 42.15% 7.08%, 42.15% 4.90%, 41.97% 4.73%, 41.20% 5.53%, 41.03% 5.42%, 40.90% 4.96%, 40.47% 5.19%, 39.96% 6.05%, 39.44% 7.71%, 37.00% 9.02%, 34.89% 9.88%, 30.34% 13.26%, 28.33% 15.43%, 27.12% 16.12%, 24.72% 16.46%, 22.19% 17.61%, 20.86% 17.72%, 18.11% 17.66%, 16.35% 16.98%, 12.66% 16.18%, 8.03% 16.18%, 6.39% 16.69%, 4.81% 17.89%, 2.79% 20.30%, 1.85% 22.18%)',
  },
  {
    vista: 'CABECA_FRONTAL',
    label: 'Cabeça frontal',
    escala: 1.85,
    tx: -6.0,
    ty: 9.0,
    clipPath: 'inset(17% 36% 30% 44%)',
  },
  {
    vista: 'FOCINHO',
    label: 'Focinho',
    escala: 4.3,
    tx: -8.5,
    ty: -29.5,
    clipPath: 'inset(60% 25% 8% 45%)',
  },
  {
    vista: 'PESCOCO_INFERIOR',
    label: 'Pescoço inferior',
    escala: 1.4,
    tx: 13.5,
    ty: -10.0,
    // Recalibrado em 22/06/2026 — três problemas corrigidos juntos:
    // 1) Braço direito da bifurcação inferior do pescoço cortado (o degrau
    //    antigo 41%→44% não acompanhava a abertura real da forquilha).
    // 2) Palavra "inferior" (2ª linha do rótulo "Pescoço vista inferior")
    //    cortada — o texto fica coladíssimo na borda inferior do documento
    //    (~99.97% de docH), exigindo y de base em 100% e ty mais negativo
    //    (-10 em vez de -5) para trazê-la para dentro da área visível.
    // 3) Linha residual no topo direito, identificada como o contorno do
    //    pescoço/peito da vista lateral do cavalo (figura acima, à
    //    esquerda do documento) vazando para dentro do clip — corrigida
    //    recuando o lado esquerdo do polígono (38%→41% conforme sobe)
    //    apenas na faixa superior, onde essa curva vizinha passa perto;
    //    do meio para baixo o lado esquerdo volta a 33%, que já estava
    //    correto e não precisa de folga adicional.
    clipPath:
      'polygon(39% 20%, 41% 20%, 41% 30%, 44% 45%, 46% 65%, 47% 100%, 33% 100%, 33% 32%, 37% 25%)',
  },
  {
    vista: 'MEMBROS_ANTERIORES',
    label: 'Membros anteriores',
    escala: 1.85,
    tx: 37.0,
    ty: -36.0,
    clipPath: 'inset(58% 72% 2% 0%)',
  },
  {
    vista: 'MEMBROS_POSTERIORES',
    label: 'Membros posteriores',
    escala: 1.85,
    tx: -37.0,
    ty: -36.0,
    clipPath: 'inset(58% 0% 2% 72%)',
  },
];

export const TIPOS_MARCACAO: { tipo: TipoMarcacaoResenha; label: string; cor: string }[] = [
  { tipo: 'PELO_BRANCO', label: 'Pelo branco', cor: '#1D9E75' },
  { tipo: 'CICATRIZ',    label: 'Cicatriz',    cor: '#D85A30' },
  { tipo: 'MANCHA',      label: 'Mancha',      cor: '#378ADD' },
  { tipo: 'REDEMOINHO',  label: 'Redemoinho',  cor: '#7F77DD' },
];
