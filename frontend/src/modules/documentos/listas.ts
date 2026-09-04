// src/modules/documentos/listas.ts
// LISTAS REPETÍVEIS na tela — espelho de `backend/src/lib/documentoListas.js`.
//
// Uma LISTA é um grupo de sub-campos (as colunas) repetido N vezes (as linhas), com o
// N escolhido na hora de emitir: medicamento, vacina, exame, procedimento e qualquer
// outro grupo que se repita. É o que uma LACUNA (`[[Rótulo]]`) não dá conta de ser —
// ela é um campo e um valor, e o número de medicamentos de uma receita não é
// propriedade do MODELO, é de cada emissão.
//
// 🔴 QUEM MANDA É O BACKEND. Ele coleta as listas do documento, resolve as colunas
// canônicas de cada fonte clínica e SUGERE as linhas a partir do que o paciente tem
// registrado (`POST /documentos/campos` devolve tudo pronto). O que mora aqui é o
// mínimo para a PRÉ-VISUALIZAÇÃO ao vivo saber a qual grupo cada bloco pertence
// enquanto a pessoa digita — a mesma divisão de `campos.ts`, onde o coletor é do
// servidor e só o aplicador é local.
//
// ⚠️ Mudou a tabela `FONTES` de um lado, mude do outro: as colunas são o contrato
// entre a consulta que preenche e a tabela que imprime.

import type { Bloco, TipoBloco } from './types';

/** Fontes clínicas que o sistema sabe preencher sozinho. */
export const FONTES: Record<string, { rotulo: string; colunas: string[] }> = {
  'prescricao.medicamentos':  { rotulo: 'Medicamentos',  colunas: ['Medicamento', 'Dose', 'Via', 'Frequência', 'Duração'] },
  'prescricao.procedimentos': { rotulo: 'Procedimentos', colunas: ['Procedimento', 'Quantidade', 'Observação'] },
  // Só os medicamentos SUJEITOS A CONTROLE ESPECIAL — a fonte do receituário
  // próprio. Mesmas colunas de `prescricao.medicamentos`: o que muda é o recorte.
  'prescricao.controlados':   { rotulo: 'Medicamentos sujeitos a controle especial', colunas: ['Medicamento', 'Dose', 'Via', 'Frequência', 'Duração'] },
  'vacinas.aplicadas':        { rotulo: 'Vacinas',       colunas: ['Vacina', 'Lote', 'Aplicação', 'Próxima dose'] },
  'exames.resultados':        { rotulo: 'Exames',        colunas: ['Exame', 'Solicitado em', 'Resultado'] },
};

/** O catálogo do editor e o das variáveis usam nomes diferentes para o mesmo conjunto. */
const APELIDOS: Record<string, string> = {
  'exames.solicitados': 'exames.resultados',
  'vacinas.ultima':     'vacinas.aplicadas',
};

export function normalizarFonte(f?: string | null): string | null {
  const chave = String(f ?? '').trim();
  const canon = APELIDOS[chave] ?? chave;
  return FONTES[canon] ? canon : null;
}

/**
 * Tipos de bloco que SÃO lista.
 *
 * Os quatro clínicos já existiam e mostravam linhas de EXEMPLO com a legenda
 * "Preenchido na emissão a partir de X" — promessa que nada cumpria: no papel eles
 * saíam vazios. Entram aqui para que a legenda passe a ser verdade.
 */
export const TIPOS_LISTA: TipoBloco[] = [
  'listaCampos', 'medicamentos', 'vacinas', 'procedimentos', 'exames', 'tabelaDinamica',
];

export const ehLista = (b: Bloco): boolean => TIPOS_LISTA.includes(b.tipo);

/** MESMA normalização da lacuna — as duas convivem no mesmo formulário. */
export const chaveDaLista = (rotulo: string): string => String(rotulo ?? '').trim().toLowerCase();

/** Rótulo do grupo: o do modelo, senão o da fonte, senão um genérico. */
export function rotuloDaLista(b: Bloco): string {
  const proprio = String(b.conteudo?.rotulo ?? '').trim();
  if (proprio) return proprio;
  const fonte = normalizarFonte(b.conteudo?.fonteDados);
  return fonte ? FONTES[fonte].rotulo : 'Itens';
}

/**
 * Colunas efetivas: as da FONTE quando há fonte, senão as declaradas no modelo.
 *
 * ⚠️ As da fonte VENCEM as do modelo, e é isso que faz o preenchimento automático
 * alinhar: se o modelo pedisse ["Remédio", "Qtd"] e o dado viesse em cinco campos, a
 * dose cairia na coluna da quantidade.
 */
export function colunasDaLista(b: Bloco): string[] {
  const fonte = normalizarFonte(b.conteudo?.fonteDados);
  if (fonte) return [...FONTES[fonte].colunas];
  const declaradas = (b.conteudo?.colunas ?? []).map(c => String(c ?? '').trim()).filter(Boolean);
  return declaradas.length > 0 ? declaradas : ['Item'];
}

/** O que a pessoa preencheu, por chave de grupo. */
export type PreenchimentoListas = Record<string, string[][]>;

/** Uma lista como o backend a descreve (`POST /documentos/campos`). */
export interface ListaDocumento {
  chave:      string;
  rotulo:     string;
  colunas:    string[];
  /** `null` = grupo repetível sem origem clínica; nasce vazio. */
  fonteDados: string | null;
  /**
   * Catálogo da EMPRESA que a primeira coluna oferece ('empresa.vacinas').
   * Diferente de `fonteDados`: aquela PREENCHE linhas com o que o paciente tem; esta
   * só OFERECE o que existe no cadastro — e é ela que diz se a coluna aceita
   * CADASTRAR um item novo.
   */
  fonteOpcoes?: string | null;
  secao:      string | null;
  /** Linhas vindas do que o PACIENTE tem registrado — o "já vem preenchido". */
  sugestao:   string[][];
  /**
   * Catálogo da EMPRESA oferecido na PRIMEIRA coluna (hoje, as vacinas).
   *
   * Vazio = coluna de texto livre, como sempre. `valores` é chaveado pelo NOME da
   * coluna, e não pelo índice: o modelo pode reordenar as colunas, e por índice a
   * validade cairia na coluna do fabricante.
   */
  opcoes?:    OpcaoLista[];
}

export interface OpcaoLista {
  rotulo:  string;
  valores: Record<string, string>;
}

/** Linha totalmente em branco não conta — nem para exibir, nem para imprimir. */
export const linhaTemAlgo = (l: string[]): boolean => l.some(c => String(c ?? '').trim());

/** Uma linha vazia do tamanho certo, para o repetidor abrir com algo onde digitar. */
export const linhaVazia = (colunas: string[]): string[] => colunas.map(() => '');

/**
 * As linhas de um bloco para a PRÉ-VISUALIZAÇÃO: o que já foi preenchido, ajustado ao
 * número de colunas. Sem valores (editor, sem paciente) devolve `null` — quem chama
 * decide o que mostrar, e no editor isso é a linha de exemplo do catálogo.
 */
export function linhasDoBloco(b: Bloco, listas?: PreenchimentoListas | null): string[][] | null {
  if (!listas) return null;
  const linhas = listas[chaveDaLista(rotuloDaLista(b))];
  if (!Array.isArray(linhas)) return null;
  const colunas = colunasDaLista(b);
  return linhas.filter(linhaTemAlgo).map(l => colunas.map((_, i) => String(l?.[i] ?? '')));
}
