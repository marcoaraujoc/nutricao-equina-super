// src/modules/documentos/receitaControlada.ts
// O receituário de CONTROLE ESPECIAL da tela de Prescrição.
//
// 🔴 POR QUE ISTO EXISTE: medicamento sujeito a controle especial não sai no mesmo
// papel do resto. A prescrição comum continua imprimindo os demais itens, e os
// controlados vão para um DOCUMENTO da Central — que tem a identificação do
// comprador, a via da farmácia e a numeração da emissão. Este módulo é o elo entre
// as duas telas: acha o modelo no acervo e monta a URL da emissão.
//
// ⚠️ O modelo é procurado PELO NOME, não por um id fixo: ele é criado pela própria
// clínica (envio de arquivo ou montagem no editor), então não há id a cravar em
// código — e cada clínica tem o seu.

import { listarTemplates } from './api';
import type { Template } from './types';

/** Nome esperado do modelo. É o que a tela sugere quando ele não existe. */
export const NOME_RECEITA_CONTROLADA = 'Receita Controlada';

const normalizar = (v: string) =>
  v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/**
 * Modelo do receituário de controle especial no acervo da clínica, ou `null`.
 *
 * Ordem de preferência: nome exato → nome que contenha "receita controlada" →
 * qualquer um que fale de "controle especial". Os apelidos existem porque o modelo é
 * cadastrado à mão e "Receituário de Controle Especial" é como a norma o chama —
 * exigir o nome exato deixaria o vet com um documento cadastrado que a tela insiste
 * em dizer que não existe.
 *
 * ⚠️ Devolve `null` também quando falta permissão para ler o acervo
 * (`listarTemplates` responde `[]` no 403, ver o interceptor do axios em §6). Isso é
 * deliberado: quem não alcança a Central cai na impressão de sempre, em vez de
 * receber um erro que não tem como resolver.
 */
export async function buscarModeloReceitaControlada(): Promise<Template | null> {
  const templates = await listarTemplates(false).catch(() => [] as Template[]);
  const vivos = templates.filter(t => !t.excluido);
  const alvo  = normalizar(NOME_RECEITA_CONTROLADA);

  return vivos.find(t => normalizar(t.nome) === alvo)
    ?? vivos.find(t => normalizar(t.nome).includes(alvo))
    ?? vivos.find(t => normalizar(t.nome).includes('controle especial'))
    ?? null;
}

/**
 * Rota da emissão já apontada para o paciente, o modelo e a PRESCRIÇÃO de origem.
 *
 * `prescricaoGrupoId` não é enfeite: é ele que faz a tabela de medicamentos nascer
 * com os itens DAQUELA receita. Sem ele o backend cai na prescrição do atendimento em
 * curso (ou na mais recente), e reimprimir o receituário de uma receita antiga
 * traria os medicamentos de outra.
 */
export function rotaReceitaControlada(
  animalId: number, templateId: string, prescricaoGrupoId: number,
): string {
  const q = new URLSearchParams({
    animalId: String(animalId),
    templateId,
    prescricaoGrupoId: String(prescricaoGrupoId),
  });
  return `/documentos?${q.toString()}`;
}
