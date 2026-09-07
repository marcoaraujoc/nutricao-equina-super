// src/utils/evolucaoAtiva.ts
// FONTE ÚNICA de "qual das evoluções EM ANDAMENTO deste paciente é a de agora".
//
// O mesmo paciente pode ter MAIS DE UMA evolução aberta ao mesmo tempo — consultas
// distintas no mesmo dia (ex.: Clínica e Dermatologia), possivelmente com o mesmo
// profissional (regra de 2026-08-18: o que prova a distinção é o `agendamentoId`).
// Prescrição, exame, encaminhamento e vacina lançados no shell se vinculam à evolução
// ATIVA, então errar essa escolha vincula o registro clínico ao atendimento errado.
//
// A regra vivia COPIADA em Atendimento.tsx, SubModuloEvolucao.tsx e Vacina.tsx, e as
// três já divergiram na prática. Aqui ela é uma só.
//
// Ordem de decisão:
//   1. ESCOLHA EXPLÍCITA do usuário (clique no banner "Atendimento ... em andamento")
//   2. a MINHA cujo agendamento bate com o contexto (o "Iniciar" da agenda propaga o
//      `agendamentoId` pela URL/localStorage)
//   3. a primeira MINHA
//   4. a primeira de qualquer profissional (o shell abre em leitura — ver `evolucaoDeOutro`)

export interface EvolucaoAbertaResumo {
  id:                number;
  atendimentoNumero: string | null;
  veterinarioId:     number | null;
  agendamentoId?:    number | null;
}

interface OpcoesEscolha {
  /** Evolução escolhida à mão no banner. Vence tudo enquanto ainda estiver aberta. */
  selecionadaId?: number | null;
  /** Agendamento do contexto (URL `?agendamentoId=` ou `s2vet_ag_<animalId>`). */
  agendamentoId?: number | null;
  /** Id do usuário logado — "a minha vence". */
  meuUserId?:     number | null;
}

export function escolherEvolucaoAtiva<T extends EvolucaoAbertaResumo>(
  abertas: T[],
  { selecionadaId, agendamentoId, meuUserId }: OpcoesEscolha = {},
): T | null {
  if (abertas.length === 0) return null;

  // A escolha explícita só vale enquanto a evolução continuar aberta: finalizada ou
  // cancelada, ela some da lista e a decisão volta ao automático (senão o shell
  // ficaria preso a um id que não existe mais e nada seria vinculado).
  if (selecionadaId != null) {
    const escolhida = abertas.find(e => e.id === selecionadaId);
    if (escolhida) return escolhida;
  }

  const minhas = abertas.filter(e => e.veterinarioId === (meuUserId ?? 0));
  const porAgendamento = agendamentoId != null
    ? minhas.find(e => e.agendamentoId === agendamentoId)
    : undefined;

  return porAgendamento ?? minhas[0] ?? abertas[0];
}

// ── Como o atendimento se DESCREVE no banner ─────────────────────────────────
// A evolução ASSUMIDA passa a dizer QUEM a assumiu, no lugar do título/especialidade:
// "Atendimento EV-0004 de 05/09/2026 22:54 - Evolução assumida por Fulano - Em
// andamento". Quem responde pelo atendimento mudou, e é isso que a faixa precisa
// dizer primeiro — o título ali era o do registro de quem abriu, e não acusava a
// troca de responsável.
//
// ⚠️ Assumida = `autorId` (quem CRIOU, imutável) diferente de `veterinarioId` (o
// responsável ATUAL, que `assumir` transfere). Não existe coluna "assumida": são
// essas duas que a distinguem — ver CLAUDE.md, sessão 2026-09-05 (parte 4).
// ⚠️ Sem o NOME de quem assumiu (autor removido do sistema, ou lista de servidor
// antigo que não traz o campo), cai no rótulo de sempre: "assumida por" sem nome
// não informa nada que o banner já não diga.

export interface EvolucaoDescritivel {
  titulo?:        string | null;
  especialidade?: string | null;
  veterinarioId:  number | null;
  /** Quem CRIOU a evolução — imutável. */
  autorId?:       number | null;
  /** Nome do responsável ATUAL (é ele quem assumiu, quando houve assunção). */
  veterinarioNome?: string | null;
}

export function foiAssumida(ev: EvolucaoDescritivel): boolean {
  return ev.autorId != null && ev.veterinarioId != null && ev.autorId !== ev.veterinarioId;
}

/** Trecho do meio do rótulo do banner. `null` = não há o que dizer ali. */
export function descricaoAtendimento(ev: EvolucaoDescritivel): string | null {
  const nome = ev.veterinarioNome?.trim();
  if (foiAssumida(ev) && nome) return `Evolução assumida por ${nome}`;
  return ev.titulo?.trim() || ev.especialidade?.trim() || null;
}

// ── Persistência da escolha ──────────────────────────────────────────────────
// A escolha é ESTADO do shell, mas o shell é DESMONTADO ao navegar para a tela
// apartada de Vacina (e para a Execução de Prescrição). Sem persistir, voltar de lá
// reabriria em outro atendimento e a vacina seguinte nasceria vinculada ao errado.
// Chave por ANIMAL, no mesmo formato do `s2vet_ag_<animalId>` que o "Iniciar" da
// agenda já usa.

const chave = (animalId: number | string) => `s2vet_ev_sel_${animalId}`;

export function lerEvolucaoSelecionada(animalId: number | string | null | undefined): number | null {
  if (!animalId) return null;
  try {
    const v = localStorage.getItem(chave(animalId));
    return v ? Number(v) : null;
  } catch { return null; }
}

export function salvarEvolucaoSelecionada(
  animalId: number | string | null | undefined,
  evolucaoId: number | null,
): void {
  if (!animalId) return;
  try {
    if (evolucaoId == null) localStorage.removeItem(chave(animalId));
    else                    localStorage.setItem(chave(animalId), String(evolucaoId));
  } catch { /* modo privado / storage cheio — a escolha só não sobrevive à navegação */ }
}
