// frontend/src/utils/orcamentoImportLock.ts
// "Orçamento em andamento" por animal — trava a importação em UM orçamento assim que
// ela é INICIADA (itens inseridos numa prescrição/vacina), antes mesmo de salvar.
//
// Por que localStorage: prescrição (/clinica/prescricao/:id) e vacina (/clinica/vacina/:id)
// são ROTAS separadas — não compartilham estado React. A marcação definitiva de
// "importado" (importadoEm, no backend) continua acontecendo só ao salvar; este lock é
// só o sinal efêmero de sessão que faz TODAS as categorias mostrarem apenas o orçamento
// que já começou a ser importado. Auto-cura: quem lê deve limpar o lock quando o
// orçamento não estiver mais disponível para importar (concluído/sumiu).

const KEY = (animalId: number) => `s2vet_orc_import_${animalId}`;

export function getOrcamentoLock(animalId: number): number | null {
  try {
    const v = localStorage.getItem(KEY(animalId));
    const n = v ? Number(v) : NaN;
    return Number.isInteger(n) ? n : null;
  } catch { return null; }
}

export function setOrcamentoLock(animalId: number, orcamentoId: number): void {
  try { localStorage.setItem(KEY(animalId), String(orcamentoId)); } catch { /* ignore */ }
}

export function clearOrcamentoLock(animalId: number): void {
  try { localStorage.removeItem(KEY(animalId)); } catch { /* ignore */ }
}
