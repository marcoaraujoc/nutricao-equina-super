// frontend/src/utils/laudoPendente.ts
// Passa os arquivos de laudo/imagem escolhidos na tela de Exames para a página
// de novo exame nutricional (File não é serializável no state do router — vivem
// aqui em memória apenas durante a navegação).

let arquivos: File[] = [];

export const setLaudosPendentes = (fs: File[]): void => { arquivos = fs; };

/** Retorna os arquivos pendentes (se houver) e limpa — consumo único. */
export const consumirLaudosPendentes = (): File[] => {
  const fs = arquivos;
  arquivos = [];
  return fs;
};
