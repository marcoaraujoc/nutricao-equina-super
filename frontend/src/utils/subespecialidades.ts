// Vocabulário oficial de especialidades do veterinário (Cadastro Pessoal).
// Fonte única para o Cadastro Pessoal e para a Agenda — evita divergência entre
// o que o profissional cadastra e o que a agenda exibe. Entradas fora desta lista
// (legado de vocabulários antigos) são ignoradas na exibição.
export const SUBESPECIALIDADES = [
  'Clínico', 'Quiroprata', 'Fisioterapeuta', 'Oftalmologista',
  'Dermatologista', 'Cardiologista', 'Ortopedista', 'Neurologista',
  'Oncologista', 'Nutricionista', 'Anestesiologista', 'Radiologista',
  'Reprodução Animal',
] as const;

const SET = new Set<string>(SUBESPECIALIDADES.map(s => s.toLowerCase()));

/** true se `nome` é uma especialidade do vocabulário oficial (case-insensitive). */
export function isSubespecialidadeValida(nome: string): boolean {
  return SET.has((nome ?? '').trim().toLowerCase());
}
