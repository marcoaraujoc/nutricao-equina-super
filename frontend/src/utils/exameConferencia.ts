// frontend/src/utils/exameConferencia.ts
// Confere se o que foi PEDIDO é o que está sendo CARREGADO.
//
// POR QUE EXISTE: quem pede e quem lança o resultado costumam ser pessoas diferentes,
// e o modal de "Carregar Resultados" aceita qualquer arquivo. Dava para anexar um
// laudo de albumina — ou um raio-x inteiro — no pedido de FERRO: o resultado entrava
// vinculado ao pedido errado, e o erro só aparecia depois, no prontuário, sem nenhuma
// pista de onde tinha vindo.
//
// 🔴 A CONFERÊNCIA É PELO CONTEÚDO, NÃO PELO NOME DO ARQUIVO. Não se compara o nome do
// exame pedido com o TÍTULO que a IA leu no laudo — título de laboratório é texto livre
// e o painel muitas vezes se chama diferente do exame específico (pediu "Ferro", o
// arquivo é um "Perfil Bioquímico" que CONTÉM ferro). A pergunta certa é: o exame
// pedido APARECE no que está sendo carregado? Ou seja, entre os RESULTADOS lidos — as
// linhas da tabela (laboratorial) ou o texto do laudo (imagem).
//
// 🔴 NUNCA BLOQUEIA. Devolve o diagnóstico para a tela PERGUNTAR se prossegue: a
// leitura da IA não é perfeita, e recusar trancaria um lançamento legítimo — aí não
// haveria saída pela tela.
//
// ⚠️ A única divergência que NÃO olha o conteúdo é a de FAMÍLIA (categoria): pediu
// laboratorial e anexou um laudo de imagem, ou vice-versa. Isso vem do TIPO, não do
// nome do exame.

/** Grupo do exame para efeito de conferência: laboratorial e bioquímico são a mesma
 *  família (a IA escolhe entre os dois lendo o laudo, e o vet pede genericamente),
 *  imagem é outro mundo. */
type Familia = 'laboratorial' | 'imagem' | 'outro';

const ROTULO_FAMILIA: Record<Familia, string> = {
  laboratorial: 'laboratorial',
  imagem:       'de imagem',
  outro:        '',
};

function familiaDoTipo(tipo?: string | null): Familia {
  const t = (tipo ?? '').toLowerCase();
  if (t.includes('imagem')) return 'imagem';
  if (t.includes('laborator') || t.includes('bioqu')) return 'laboratorial';
  return 'outro';
}

/** minúsculas, sem acento, sem pontuação, espaços colapsados. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Palavras que não distinguem exame nenhum. Servem a DOIS propósitos e os dois foram
// medidos contra casos reais:
//   1. não deixar "Perfil de Ferro" casar com "Perfil Hepático" só pelo "perfil";
//   2. calar o alarme quando o PEDIDO é genérico ("Exames de rotina", "Bioquímico"):
//      sem palavra distintiva do lado do pedido não há divergência a afirmar, e
//      avisar ali seria ruído em todo lançamento — o caminho mais rápido para o
//      usuário aprender a clicar "prosseguir" sem ler.
// ⚠️ Nome de família (laboratorial/bioquímico/imagem) entra aqui de propósito: é
// CATEGORIA, não exame. A divergência de categoria já é pega antes, pelo tipo.
const VAZIAS = new Set([
  'de', 'do', 'da', 'dos', 'das', 'e', 'em', 'com', 'para', 'por',
  'exame', 'exames', 'perfil', 'painel', 'teste', 'dosagem', 'analise',
  'serico', 'serica', 'total', 'completo', 'completa', 'simples',
  'rotina', 'checkup', 'check', 'geral', 'gerais', 'avaliacao', 'controle',
  'laboratorial', 'laboratoriais', 'laboratorio', 'bioquimico', 'bioquimica',
  'imagem', 'clinico', 'clinica', 'veterinario', 'veterinaria',
  'sangue', 'soro', 'amostra', 'material',
]);

function palavrasUteis(texto: string): string[] {
  return normalizar(texto).split(' ').filter(p => p.length >= 3 && !VAZIAS.has(p));
}

export interface ConferenciaExame {
  /** false = a tela deve perguntar antes de prosseguir. */
  combina: boolean;
  /** Frase pronta explicando a divergência (vazia quando combina). */
  motivo: string;
}

const COMBINA: ConferenciaExame = { combina: true, motivo: '' };

/**
 * O exame PEDIDO aparece no que está sendo CARREGADO?
 *
 * @param pedido   o que foi solicitado (tipo + descrição do `ExameClinico`)
 * @param lido     o TIPO que a IA sugeriu para o arquivo — usado só para a divergência
 *                 de FAMÍLIA (laboratorial × imagem). O nome/título lido NÃO é
 *                 comparado com o do pedido (ver o cabeçalho do arquivo).
 * @param conteudo o CONTEÚDO lido do arquivo: os nomes das linhas da tabela de
 *                 resultado (laboratorial) ou o texto do laudo (imagem). É AQUI que se
 *                 procura o exame pedido — pediu "Ferro", combina se "Ferro" for uma
 *                 das linhas do resultado, mesmo que o arquivo se chame "Perfil
 *                 Bioquímico".
 */
export function conferirExame(
  pedido:   { tipo: string; descricao: string },
  lido:     { tipo?: string | null },
  conteudo: string[] = [],
): ConferenciaExame {
  // 1. DIVERGÊNCIA DE FAMÍLIA (categoria, não nome): pediu laboratorial e anexou um
  //    laudo de imagem, ou vice-versa. Vem do tipo, e é a única que não olha o conteúdo.
  const famPedida = familiaDoTipo(pedido.tipo);
  const famLida   = familiaDoTipo(lido.tipo);
  if (famPedida !== 'outro' && famLida !== 'outro' && famPedida !== famLida) {
    return {
      combina: false,
      motivo: `O pedido é de exame ${ROTULO_FAMILIA[famPedida]} e o arquivo anexado é um laudo ${ROTULO_FAMILIA[famLida]}.`,
    };
  }

  // 2. Pedido sem nenhuma palavra distintiva ("Exames de rotina", "Bioquímico"): não há
  //    o que procurar no conteúdo, então não se afirma divergência.
  const pedidas = palavrasUteis(pedido.descricao);
  if (pedidas.length === 0) return COMBINA;

  // 3. Sem conteúdo lido (a IA não extraiu resultado/laudo): não dá para conferir —
  //    silêncio é melhor que um alarme cego. O usuário revisa a tabela na tela.
  const noConteudo = conteudo.flatMap(palavrasUteis);
  if (noConteudo.length === 0) return COMBINA;

  // 4. ✅ O EXAME PEDIDO ESTÁ NO CONTEÚDO CARREGADO? Basta uma palavra distintiva do
  //    pedido aparecer entre os resultados lidos: "Ferro sérico" casa com a linha
  //    "Ferro", e um painel casa por qualquer um de seus itens.
  if (noConteudo.some(p => pedidas.includes(p))) return COMBINA;

  return {
    combina: false,
    motivo: `O exame pedido ("${pedido.descricao}") não aparece nos resultados do arquivo carregado.`,
  };
}
