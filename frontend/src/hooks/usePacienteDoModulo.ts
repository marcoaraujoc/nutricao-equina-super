import { useCallback, useEffect, useState } from 'react';

/**
 * O paciente escolhido vale DENTRO do módulo, nunca entre módulos.
 *
 * Escolher o Thor no Atendimento mantém o Thor em Agenda, Evolução, Prescrição,
 * Exames e Encaminhamento; ir ao Nutricional abre em BUSCA. Cada módulo tem a
 * sua memória — nenhuma tela lê a de outra, nem o `selectedAnimal` global.
 *
 * sessionStorage: sobrevive ao recarregar a aba e morre com ela. Troca de
 * empresa e login/logout limpam tudo (`esquecerPacientesDosModulos`), porque o
 * paciente lembrado é daquela empresa e daquela pessoa.
 */
export type ModuloPaciente = 'atendimento' | 'vacina' | 'exames' | 'nutricional';

const PREFIXO = 's2vet_paciente_modulo_';
const MODULOS: ModuloPaciente[] = ['atendimento', 'vacina', 'exames', 'nutricional'];

function ler(modulo: ModuloPaciente): string | null {
  try { return sessionStorage.getItem(PREFIXO + modulo); } catch { return null; }
}

function gravar(modulo: ModuloPaciente, animalId: string | null) {
  try {
    if (animalId) sessionStorage.setItem(PREFIXO + modulo, animalId);
    else          sessionStorage.removeItem(PREFIXO + modulo);
  } catch { /* storage bloqueado: a tela só volta a abrir em busca */ }
}

export function esquecerPacientesDosModulos() {
  MODULOS.forEach(m => gravar(m, null));
}

/**
 * `idDaUrl` vence (é escolha explícita: seletor, "Iniciar" da agenda, link do
 * paciente) e passa a ser o lembrado do módulo. Sem id na URL — menu lateral,
 * aba Agenda, troca entre sub-itens do módulo — usa o lembrado.
 * `esquecer` é para o id que respondeu 403 (paciente de outra empresa).
 */
export function usePacienteDoModulo(modulo: ModuloPaciente, idDaUrl: string | undefined) {
  const [lembrado, setLembrado] = useState<string | null>(() => ler(modulo));

  useEffect(() => {
    if (!idDaUrl) return;
    gravar(modulo, idDaUrl);
    setLembrado(idDaUrl);
  }, [modulo, idDaUrl]);

  const esquecer = useCallback(() => {
    gravar(modulo, null);
    setLembrado(null);
  }, [modulo]);

  // Escolha feita SEM navegar (ex.: clicar no paciente na aba Agenda, cuja rota não
  // tem id). Com id na URL ele continua vencendo — é a URL que a tela está exibindo.
  const lembrar = useCallback((animalId: string) => {
    gravar(modulo, animalId);
    setLembrado(animalId);
  }, [modulo]);

  return { animalId: idDaUrl ?? lembrado ?? '', esquecer, lembrar };
}
