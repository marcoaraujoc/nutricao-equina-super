// src/modules/documentos/vazios.ts
// O QUE NÃO FOI PREENCHIDO NÃO APARECE NO DOCUMENTO EMITIDO — nem na tela, nem na
// impressão, nem no PDF que vai por WhatsApp/e-mail.
//
// 🔴 ESPELHO de `backend/src/lib/documentoVariaveis.js#removerVazios`. Lá a regra é
// aplicada ao GRAVAR o snapshot; aqui, ao EXIBIR. Os dois existem porque cobrem coisas
// diferentes:
//   • o backend limpa o que nasce de agora em diante;
//   • este limpa o que JÁ ESTÁ GRAVADO — os documentos emitidos antes da regra existir
//     continuam com os blocos vazios dentro do snapshot, e reimprimir um deles traria
//     de volta o "Tatuagem: ____" que a regra veio tirar.
// ⚠️ O snapshot NÃO é reescrito: o documento entregue é imutável (é o ponto de ser um
// snapshot). O que muda é o que se desenha a partir dele.
// ⚠️ Mudou a regra de um lado, mude do outro.
//
// ⚠️ VALE TAMBÉM PARA A PRÉ-VISUALIZAÇÃO (2026-09-03): "campo sem preenchimento não
// aparece na visualização, impressão ou encaminhamento" é regra de TODO documento, e a
// pré-visualização existe para mostrar o papel como ele vai sair. Lá os blocos ainda
// são os do MODELO — o valor mora em `{{variável}}`, não em `texto` —, e por isso a
// decisão precisa do CONTEXTO e do PREENCHIMENTO: filtrar por `texto` cru apagaria
// todos os campos, inclusive os preenchidos.
// ⚠️ O que NÃO passa por aqui é o `ModalPreencher` do editor, onde a folha fica ao
// lado do formulário: ali o traço em branco é clicável e leva ao campo, e some-lo
// tiraria a única pista de ONDE cada campo cai no papel.

import { resolverVariaveis } from './catalogo';
import type { ContextoVariaveis } from './catalogo';
import { aplicarLacunas, chaveDaLacuna } from './campos';
import type { Preenchimento } from './campos';
import { linhasDoBloco, ehLista } from './listas';
import type { PreenchimentoListas } from './listas';
import type { Bloco } from './types';

/**
 * Como avaliar "está preenchido?" — o que a tela sabe além do bloco.
 *
 * Vazio (o documento EMITIDO): os blocos já vêm resolvidos e o valor está em `texto`.
 * Preenchido (a PRÉ-VISUALIZAÇÃO): o bloco ainda é o do modelo, e o valor sai do
 * contexto do paciente, do que a pessoa digitou ou das linhas do repetidor.
 */
export interface FonteDeValor {
  contexto?:      ContextoVariaveis | null;
  preenchimento?: Preenchimento | null;
  listas?:        PreenchimentoListas | null;
}

/** Sobrou só o rótulo ("Tatuagem:") e nada depois dele. */
const SO_ROTULO = /^[^:\n]{1,80}:\s*$/;

/**
 * Pontuação que a variável vazia deixou para trás — "Local e data: , 03/09/2026."
 *
 * Limpeza MÍNIMA e literal: só o separador grudado onde não há valor antes dele. O
 * bloco `texto` carrega a declaração normativa do documento, e reescrevê-la seria
 * alterar o que o papel afirma.
 */
export const limparPontuacaoOrfa = (t: string): string =>
  String(t ?? '')
    .replace(/:\s*,\s*/g, ': ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*\./g, '.')
    .replace(/\s{2,}/g, ' ')
    .trim();

function semConteudo(b: Bloco, fonte: FonteDeValor = {}): boolean {
  const c = b?.conteudo ?? {};
  const t = String(c.texto ?? '').trim();
  const { contexto, preenchimento, listas } = fonte;
  const digitado = (rotulo?: string) =>
    String(preenchimento?.[chaveDaLacuna(rotulo ?? '')] ?? '').trim();

  switch (b?.tipo) {
    case 'campoAuto':
      // O GRAVADO vence (emitido); no modelo, o que a variável resolver ou a pessoa
      // digitou. Mesma ordem do `BlocoView`, senão a folha e o filtro discordam.
      return !(t
        || resolverVariaveis(c.variavel ?? '', contexto).trim()
        || digitado(c.rotulo));

    case 'observacoes':
      return !(t || digitado(c.rotulo));

    case 'texto': {
      // Resolve variáveis E lacunas antes de julgar: "Tatuagem: [[Tatuagem]]" só está
      // vazio depois de saber que ninguém preencheu a lacuna.
      const resolvido = aplicarLacunas(resolverVariaveis(t, contexto), preenchimento)
        .replace(/\[\[[^\]]*\]\]/g, '')   // lacuna não preenchida não conta como texto
        .trim();
      return !resolvido || SO_ROTULO.test(resolvido);
    }

    // No emitido a lista já virou `tabela`; na pré-visualização ainda é o bloco de
    // lista, e as linhas estão no repetidor.
    case 'tabela':
      return Array.isArray(c.linhas) && c.linhas.length === 0;

    default:
      if (ehLista(b)) {
        const preenchidas = linhasDoBloco(b, listas ?? undefined);
        // `null` = editor sem valores nenhum (mostra os exemplos) — não é vazio.
        if (!preenchidas) return false;
        return preenchidas.length === 0;
      }
      return false;
  }
}

/**
 * Os blocos que de fato têm o que mostrar.
 *
 * Duas passadas: primeiro o que está vazio, depois o SUBTÍTULO que ficou sem nenhum
 * conteúdo até o próximo — uma seção inteira vazia deixaria no papel um cabeçalho
 * anunciando nada. `linha` e `rodape` não contam como conteúdo: são separadores.
 */
export function semBlocosVazios(blocos: Bloco[], fonte: FonteDeValor = {}): Bloco[] {
  if (!Array.isArray(blocos)) return [];

  const mantidos = blocos
    .map(b => (b?.tipo === 'texto' && typeof b?.conteudo?.texto === 'string'
      ? { ...b, conteudo: { ...b.conteudo, texto: limparPontuacaoOrfa(b.conteudo.texto) } }
      : b))
    .filter(b => !semConteudo(b, fonte));

  const naoConta = new Set(['subtitulo', 'linha', 'rodape']);
  return mantidos.filter((b, i) => {
    if (b?.tipo !== 'subtitulo') return true;
    for (let j = i + 1; j < mantidos.length; j += 1) {
      const t = mantidos[j]?.tipo;
      if (t === 'subtitulo') return false;
      if (!naoConta.has(t)) return true;
    }
    return false;
  });
}
