// src/modules/documentos/cabecalho.ts
// CABEÇALHO PADRÃO DA FOLHA — a mesma abertura em TODO documento da Central.
//
// Ordem fixa:
//
//   [logo, canto superior esquerdo]
//   TÍTULO DO DOCUMENTO (centralizado na folha)
//
// 🔴 AS TRÊS SEÇÕES (Veterinário · Proprietário · Paciente) FORAM REMOVIDAS a pedido
// em 2026-09-03, de TODOS os documentos. Elas nasceram em 01/09 e repetiam, no alto
// da folha, o que os 12 modelos do CFMV já trazem no corpo — a norma exige a
// identificação DENTRO do documento, então o cabeçalho a imprimia duas vezes.
// ⚠️ CONSEQUÊNCIA ACEITA: documento que NÃO repete esses dados no corpo (um modelo
// enviado pela clínica, um redigido do zero) sai sem identificar veterinário, cliente
// e paciente — quem monta o modelo precisa pôr os campos nele. Para trazer as seções
// de volta, o que falta é `SECOES` + `valorDe`, no histórico deste arquivo.
//
// 🔴 ESTE ARQUIVO É A REGRA, NÃO O DESENHO. Quem desenha são os dois espelhos de
// sempre — `CabecalhoFolha.tsx` (preview A4, visualização do emitido, mobile) e
// `utils/DocumentoPrint.ts` (impressão e PDF do Puppeteer, que recebem STRING). O que
// não podia divergir é o CONTEÚDO: qual campo entra, em que ordem, e o que acontece
// quando ele está vazio. Isso mora aqui, e os dois renderizadores consomem pronto.
//
// ⚠️ NADA DE INVENTAR VALOR (§12, 26/08). Campo sem dado NÃO vira "—" nem "N/A": ele
// simplesmente não aparece, e a seção inteira some quando nenhum dos seus campos
// resolveu. Um cabeçalho afirmando "Peso: 480 kg" porque o cadastro está em branco é
// documento falso, e nada no sistema acusaria.
//
// ⚠️ OS DOIS MODOS de `resolverVariaveis` valem aqui inteiros, e é de propósito:
//   • COM contexto (paciente escolhido, documento emitido) → valor REAL ou vazio;
//   • SEM contexto (editor, montando o modelo) → o exemplo do catálogo, só para o vet
//     ver a CARA da folha.
// Reusar aquela função em vez de inventar um terceiro modo é o que mantém o cabeçalho
// coerente com o resto do preview.

import { resolverVariaveis } from './catalogo';
import type { ContextoVariaveis } from './catalogo';
import type { Bloco } from './types';
import type { MarcaFolha } from './BlocoView';

export interface DadosCabecalho {
  logoUrl:     string | null;
  /** Usado só quando NÃO há logo — melhor o nome da clínica do que faixa vazia. */
  empresaNome: string;
  titulo:      string;
}

/**
 * Monta o cabeçalho e devolve o CORPO já sem o que ele absorveu.
 *
 * ⚠️ O PRIMEIRO bloco `titulo` visível é ABSORVIDO pelo cabeçalho, em vez de o
 * cabeçalho acrescentar um título próprio acima dele. Sem isso, os 12 modelos do CFMV
 * (que começam com "ATESTADO SANITÁRIO" e amigos, como a norma exige) sairiam com o
 * título impresso DUAS vezes, e a ordem pedida — título antes dos dados — se
 * inverteria. Absorvendo, o texto que o vet escreveu no modelo continua sendo o
 * título; o nome do documento é só o reserva de quem não tem bloco de título.
 * ⚠️ Só o PRIMEIRO, e só se vier antes de qualquer conteúdo: `titulo` no meio da folha
 * é subtítulo de seção e continua onde está.
 */
export function prepararFolha({ blocos, nome, contexto, marca }: {
  blocos:    Bloco[];
  /** Nome do documento — título reserva quando o modelo não traz bloco de título. */
  nome?:     string | null;
  contexto?: ContextoVariaveis | null;
  marca?:    MarcaFolha | null;
}): { cabecalho: DadosCabecalho; corpo: Bloco[] } {
  const lista = Array.isArray(blocos) ? blocos : [];
  const iTitulo = lista.findIndex(b => b?.visivel !== false);
  const primeiro = iTitulo >= 0 ? lista[iTitulo] : null;
  const absorve = primeiro?.tipo === 'titulo';

  const tituloDoBloco = absorve ? resolverVariaveis(primeiro?.conteudo?.texto ?? '', contexto).trim() : '';
  const titulo = tituloDoBloco || String(nome ?? '').trim();

  return {
    cabecalho: {
      logoUrl:     marca?.logoUrl ?? null,
      empresaNome: marca?.empresaNome ?? '',
      titulo,
    },
    corpo: absorve ? lista.filter((_, i) => i !== iTitulo) : lista,
  };
}

/** Cabeçalho sem nada a mostrar não vira faixa vazia no papel. */
export const cabecalhoVazio = (c: DadosCabecalho): boolean =>
  !c.logoUrl && !c.empresaNome && !c.titulo;
