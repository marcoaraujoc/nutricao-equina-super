// src/utils/numeroClinico.ts
// Número de um registro clínico na formatação da PRESCRIÇÃO — a referência da aplicação.
//
// FORMATO: 3 dígitos com zero à esquerda, exibidos com "#" na frente → #074.
// É o que o backend já devolve para a prescrição (`formatNumero` do
// PrescricaoGrupoController: `String(n).padStart(3, '0')`) e o que o Histórico do
// Paciente escreve nos títulos ("Prescrição nº 003", "Vacina nº 003").
//
// POR QUÊ existe: a VACINA vinha de outro molde no frontend — `VC-0001`, com 4 dígitos e
// o `tipoAtendimento` como prefixo. Dois problemas:
//   1. aquele molde é o do número de ATENDIMENTO (`formatAtendimentoNum` → AG-0012,
//      EV-0007), então a vacina se disfarçava de atendimento na tela;
//   2. o MESMO registro aparecia com duas caras — "VC-0004" na lista de vacinas e
//      "Vacina nº 004" no histórico do paciente.
// A coluna `tipo_atendimento = 'VC'` continua existindo: ela é o que separa a sequência
// da vacina das demais em `registrar`. O que mudou é só a EXIBIÇÃO.
//
// Registro sem número (legado) devolve `null` — quem exibe decide o vazio ("—" na lista,
// linha omitida no detalhe). Nunca fabricar um número a partir do `id`: id 812 viraria
// "#812" e seria lido como a vacina nº 812 do paciente.

/** '074' — sem o "#". Use quando o componente já escreve o "#" (ex.: impressão). */
export function formatNumeroClinico(numero: number | null | undefined): string | null {
  if (numero == null) return null;
  return String(numero).padStart(3, '0');
}

/** '#074' — para texto pronto (WhatsApp, e-mail, título de janela). */
export function numeroClinicoComHash(numero: number | null | undefined): string | null {
  const n = formatNumeroClinico(numero);
  return n ? `#${n}` : null;
}
