// src/utils/animalInfo.ts
// Resolução dos dados de identificação do paciente que aparecem sob o nome dele nas
// listas: LOCAL, PESO e IDADE.
//
// POR QUÊ existe: `localDoAnimal` já vivia copiado em Agendamentos (e vivia numa segunda
// cópia na agenda do Atendimento, que foi removida junto com aquela tela), e
// `calcularIdade` está copiado em AnimalCard, AnimaisVet e Animal. Toda cópia nova é uma
// divergência esperando acontecer.

export interface AnimalLocalizavel {
  local?:       string | null;
  localizacao?: { nome: string } | null;
}

export interface AnimalComIdade {
  dataNascimento?: string | Date | null;
  idadeAnos?:      number | null;
}

/** Localização cadastrada > campo textual legado > null. */
export function localDoAnimal(a: AnimalLocalizavel | null | undefined): string | null {
  return a?.localizacao?.nome?.trim() || a?.local?.trim() || null;
}

/**
 * Idade por extenso a partir da data de nascimento: dias no 1º mês, meses no 1º ano,
 * anos daí em diante (mesma regra do `calcularIdade` do AnimalCard).
 */
export function idadePorExtenso(dataNascimento: string): string {
  const [anoNasc, mesNasc, diaNasc] = dataNascimento.split('T')[0].split('-').map(Number);
  const hoje     = new Date();
  const nasc     = new Date(anoNasc, mesNasc - 1, diaNasc);
  const diffDias = Math.floor((hoje.getTime() - nasc.getTime()) / 86400000);

  let meses = (hoje.getFullYear() - anoNasc) * 12 + (hoje.getMonth() - (mesNasc - 1));
  if (hoje.getDate() < diaNasc) meses--;

  let anos = hoje.getFullYear() - anoNasc;
  if (hoje.getMonth() < mesNasc - 1 ||
      (hoje.getMonth() === mesNasc - 1 && hoje.getDate() < diaNasc)) anos--;

  if (diffDias < 30) return `${diffDias} ${diffDias === 1 ? 'dia'  : 'dias'}`;
  if (meses    < 12) return `${meses} ${meses === 1 ? 'mês'  : 'meses'}`;
  return `${anos} ${anos === 1 ? 'ano' : 'anos'}`;
}

/** Data de nascimento (preferida, porque envelhece sozinha) > `idadeAnos` > null. */
export function idadeDoAnimal(a: AnimalComIdade | null | undefined): string | null {
  if (a?.dataNascimento) return idadePorExtenso(String(a.dataNascimento));
  if (a?.idadeAnos != null) return `${a.idadeAnos} ${a.idadeAnos === 1 ? 'ano' : 'anos'}`;
  return null;
}

/** Peso formatado — "600kg". */
export function pesoDoAnimal(peso: number | null | undefined): string | null {
  return peso != null ? `${peso}kg` : null;
}

/**
 * A linha de identificação do paciente: **Local • Peso • Idade**.
 * Campo ausente é OMITIDO junto com o separador — nunca "• •" nem "—" solto.
 */
export function linhaInfoAnimal(
  a: (AnimalLocalizavel & AnimalComIdade & { peso?: number | null }) | null | undefined,
): string {
  return [localDoAnimal(a), pesoDoAnimal(a?.peso), idadeDoAnimal(a)]
    .filter(Boolean)
    .join(' • ');
}

export interface AnimalInativavel {
  nome:     string;
  /**
   * Paciente INATIVO — prontuário CONGELADO, em somente leitura.
   * ⚠️ Nada a ver com `Animal.ativo` (exclusão lógica), em que o paciente SOME de
   * tudo e por isso nem chega às listas.
   */
  inativo?: boolean | null;
  user?:    { fullName?: string | null } | null;
}

/**
 * Rótulo do paciente dentro de um `<option>`: o nome, o proprietário quando pedido
 * (desempate de XARÁS) e o selo de INATIVO.
 *
 * 🔴 O paciente inativo CONTINUA no seletor — ele não some, fica em SOMENTE
 * LEITURA. Mas sem marca na lista ele é indistinguível de um paciente normal, e a
 * pessoa só descobre depois de escolher, ao não achar os botões: é a mesma razão do
 * selo "Somente leitura" no card da lista de Pacientes.
 * ⚠️ No `<option>` o selo tem de ser TEXTO — o elemento não aceita filho nem estilo
 * de forma confiável entre navegadores. Onde a lista é desenhada à mão, use badge.
 */
export function rotuloOpcaoAnimal(
  a: AnimalInativavel,
  { comProprietario = false }: { comProprietario?: boolean } = {},
): string {
  let rotulo = a.nome;
  if (comProprietario) rotulo += ' — ' + (a.user?.fullName ?? '?');
  if (a.inativo)       rotulo += ' · Inativo';
  return rotulo;
}

/**
 * Paciente que a tela adota SOZINHA quando ninguém escolheu: o primeiro ATIVO da
 * lista e, não havendo nenhum, o primeiro INATIVO.
 *
 * 🔴 O inativo NÃO sai da auto-seleção (a pedido): a clínica cujos pacientes
 * estão todos congelados abriria a tela sem paciente nenhum, e "nenhum paciente" é
 * lido como "não tenho pacientes" — que é falso. Ele apenas perde a PREFERÊNCIA:
 * abrir direto num prontuário congelado, com todos os botões de escrita apagados,
 * parece defeito de permissão para quem chega na tela.
 * ⚠️ A ordem da lista continua mandando dentro de cada grupo — este helper escolhe
 * o GRUPO, não reordena nada.
 */
export function animalParaAutoSelecao<T extends { inativo?: boolean | null }>(
  animais: T[],
): T | null {
  return animais.find(a => !a.inativo) ?? animais[0] ?? null;
}
