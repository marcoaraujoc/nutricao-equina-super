// src/utils/exameClinico.ts
// Regras de leitura do ExameClinico compartilhadas entre a tela de Pedido de Exames
// (SubModuloExames) e a de Resultado de Exame (ExamesSolicitadosPanel).
//
// Mora aqui, e não na página: o painel é um componente, e importá-lo da página
// arrastaria o módulo inteiro da tela de Atendimento para dentro do chunk do
// componente — além de inverter a direção da dependência.

/**
 * O pedido tem resultado lançado? Laudo escrito, tabela de parâmetros ou imagens —
 * qualquer um serve.
 *
 * É o que distingue o exame FINALIZADO com resultado do encerrado SEM resultado (o
 * laboratório não entregou, o tutor desistiu, a amostra perdeu-se): os dois têm
 * status CONCLUIDO no banco, e só o conteúdo os separa.
 */
export function temResultadoExame(ex: {
  resultado?:      string | null;
  resultadoItens?: { id: number }[];
  imagens?:        { id: number }[];
}): boolean {
  return !!ex.resultado?.trim()
    || (ex.resultadoItens?.length ?? 0) > 0
    || (ex.imagens?.length ?? 0) > 0;
}
