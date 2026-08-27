// src/modules/documentos/campos.ts
//
// LACUNAS — os campos em branco do papel, e o que a tela de emissão preenche.
//
// Uma LACUNA é `[[Rótulo]]` dentro de qualquer texto do bloco. Diferente de uma
// VARIÁVEL (`{{animal.nome}}`), que é dado do cadastro e o sistema resolve sozinho, a
// lacuna é o que o sistema NÃO tem: tatuagem, brinco, nº da partida da vacina, hora
// do óbito. Antes ela era literalmente `______` dentro da string — invisível para o
// código, e por isso não havia como listar "o que falta preencher".
//
// ⚠️ A PESSOA NUNCA DIGITA `[[...]]`. Quem escreve a lacuna é o modelo (o catálogo do
// CFMV ou o botão "Campo para preencher" do editor). Na tela de emissão ela vê o
// rótulo e um campo; na folha, o valor ou o traço em branco.
//
// 🔴 QUEM COLETA a lista de campos é o BACKEND (`POST /documentos/campos`) — decidir
// se um campo está vazio exige saber o que as variáveis resolveram, e quem resolve é
// o servidor. Aqui mora só o APLICADOR, para a pré-visualização ao vivo enquanto a
// pessoa digita. Aplicar é trivial e reversível; coletar é que é a regra.

import type { Bloco } from './types';
import type { ContextoVariaveis } from './catalogo';

/** `[[Rótulo]]` — ver a nota do topo. */
export const RE_LACUNA = /\[\[\s*([^\]]+?)\s*\]\]/g;

/** Normaliza o rótulo para chave: é o que faz "Tatuagem" e " tatuagem " casarem. */
export const chaveDaLacuna = (rotulo: string): string => String(rotulo ?? '').trim().toLowerCase();

/** Um campo a preencher, como o backend o descreve. */
export interface CampoDocumento {
  chave:   string;
  rotulo:  string;
  /** Seção da folha (o subtítulo mais próximo acima) — agrupa o formulário. */
  secao:   string | null;
  /**
   * LACUNA     → campo em branco do papel
   * CADASTRO   → variável que resolveu VAZIA (o animal não tem microchip, p.ex.)
   * OBSERVACAO → área livre de observações
   */
  origem:  'LACUNA' | 'CADASTRO' | 'OBSERVACAO';
  multilinha: boolean;
}

export type Preenchimento = Record<string, string>;

/** Texto que o preview mostra no lugar de uma lacuna ainda vazia. */
const TRACO = '____________';

/**
 * Aplica o preenchimento a um texto, para a PRÉ-VISUALIZAÇÃO.
 *
 * ⚠️ Lacuna vazia vira um traço VISÍVEL, não string vazia: no preview a pessoa
 * precisa enxergar que ali existe um espaço a preencher. Na emissão real o backend
 * resolve para vazio — que é o espaço em branco do papel impresso.
 */
export function aplicarLacunas(texto: string, preenchimento?: Preenchimento | null): string {
  if (!texto) return '';
  return texto.replace(RE_LACUNA, (_todo, rotulo: string) => {
    const v = preenchimento?.[chaveDaLacuna(rotulo)];
    return v && v.trim() ? v : TRACO;
  });
}

/**
 * Percorre os blocos aplicando o preenchimento — espelho do `aplicarEmBlocos` do
 * backend, mas SÓ para o preview.
 *
 * ⚠️ O `rotulo` do bloco NÃO recebe o preenchimento: ele é o NOME do campo
 * ("Tatuagem"), e resolver a lacuna dentro dele apagaria justamente o rótulo.
 * ⚠️ `campoAuto` sem valor e `observacoes` sem texto são chaveados pelo RÓTULO — é a
 * mesma chave que o backend usa, e é o que faz o preview bater com o papel.
 */
export function aplicarPreenchimento(
  blocos: Bloco[],
  preenchimento: Preenchimento,
  contexto?: ContextoVariaveis | null,
): Bloco[] {
  const ap = (t: string) => aplicarLacunas(t, preenchimento);
  const doCampo = (rotulo?: string) => {
    const v = rotulo ? preenchimento[chaveDaLacuna(rotulo)] : '';
    return v && v.trim() ? v : '';
  };

  return blocos.map((b) => {
    const c = { ...b.conteudo };
    if (typeof c.texto === 'string') c.texto = ap(c.texto);
    if (typeof c.url   === 'string') c.url   = ap(c.url);
    if (Array.isArray(c.itens))   c.itens   = c.itens.map(ap);
    if (Array.isArray(c.colunas)) c.colunas = c.colunas.map(ap);
    if (Array.isArray(c.linhas))  c.linhas  = c.linhas.map(l => (Array.isArray(l) ? l.map(ap) : l));

    if (b.tipo === 'campoAuto' && typeof c.variavel === 'string') {
      // Se a variável não resolve (o cadastro não tem o dado), o valor vem do que a
      // pessoa digitou. `BlocoView` continua resolvendo a variável quando ela tem
      // valor — por isso só sobrescrevemos quando há preenchimento.
      const digitado = doCampo(c.rotulo);
      const resolvido = contexto ? (contexto[String(c.variavel).replace(/[{}]/g, '').trim()] ?? '') : '';
      if (digitado && !resolvido.trim()) c.variavel = digitado;
    }
    if (b.tipo === 'observacoes' && !String(c.texto ?? '').trim()) {
      c.texto = doCampo(c.rotulo);
    }
    return { ...b, conteudo: c };
  });
}

/** Quantos campos já têm valor — alimenta o "3 de 11" da tela de emissão. */
export function contarPreenchidos(campos: CampoDocumento[], preenchimento: Preenchimento): number {
  return campos.filter(c => (preenchimento[c.chave] ?? '').trim()).length;
}

/** Agrupa os campos pela seção da folha, PRESERVANDO a ordem em que aparecem nela. */
export function agruparPorSecao(campos: CampoDocumento[]): { secao: string; campos: CampoDocumento[] }[] {
  const grupos: { secao: string; campos: CampoDocumento[] }[] = [];
  for (const c of campos) {
    const nome = c.secao ?? 'Documento';
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.secao === nome) ultimo.campos.push(c);
    else grupos.push({ secao: nome, campos: [c] });
  }
  return grupos;
}
