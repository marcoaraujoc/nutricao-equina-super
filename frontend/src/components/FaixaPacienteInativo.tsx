// src/components/FaixaPacienteInativo.tsx
//
// 🔴 A faixa do PRONTUÁRIO CONGELADO (`Animal.inativo`) — FONTE ÚNICA do aviso.
//
// POR QUE ELA EXISTE: com o paciente inativo, todo botão de escrita simplesmente
// SOME (a regra entra nas variáveis de permissão de cada submódulo). Sem a faixa,
// quem abre a tela vê os botões ausentes e conclui que perdeu permissão — o aviso
// diz o ESTADO, desde QUANDO, por QUÊ e por QUEM.
//
// ⚠️ A frase que explicava a CONSEQUÊNCIA ("Todo o histórico continua visível e pode
// ser impresso ou enviado. Nada pode ser criado, alterado, finalizado ou cancelado
// até o gestor reativar o paciente.") foi RETIRADA a pedido, em duas etapas
// (2026-09-05). A faixa ficou com o ESTADO + desde quando, e o motivo/autor na linha
// de baixo. Não reintroduzir.
//
// ⚠️ Nasceu duplicada no shell de Atendimento e na tela de Vacina, com textos que já
// divergiam ("Todo o histórico" × "O histórico de vacinas", e só uma delas mostrava a
// data e quem inativou). Texto único aqui — para variar, passe uma prop; não copie a
// faixa (armadilha 28-g do CLAUDE.md).
//
// ⚠️ `inativoEm` é um INSTANTE: formatado por `formatDataHora`, NUNCA por `formatDate`
// (que lê a data em UTC e erra o dia à noite — §6).

import { formatDataHora } from '../utils/dateUtils';

/** Só o que a faixa precisa saber — cada tela passa o seu tipo, mais rico. */
export interface PacienteInativavel {
  inativo?:       boolean | null;
  inativoEm?:     string | null;
  inativoMotivo?: string | null;
  inativoPor?:    { fullName?: string | null } | null;
}

export default function FaixaPacienteInativo({
  animal,
  className = 'mt-4',
}: {
  animal: PacienteInativavel | null | undefined;
  /** Espaçamento em relação ao que vem antes — a faixa fica DEPOIS do card do animal. */
  className?: string;
}) {
  if (!animal?.inativo) return null;

  return (
    <div className={`rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 ${className}`}>
      <p className="text-sm font-semibold text-amber-900">
        Paciente inativo — prontuário em somente leitura
        {animal.inativoEm && <> desde {formatDataHora(animal.inativoEm)}</>}.
      </p>
      {/* Motivo e autor em LINHA PRÓPRIA (a pedido): são o registro de QUEM decidiu e
          POR QUÊ. */}
      {(animal.inativoMotivo || animal.inativoPor?.fullName) && (
        <p className="text-xs text-amber-800 mt-0.5">
          {animal.inativoMotivo && <>Motivo: “{animal.inativoMotivo}”.</>}
          {animal.inativoMotivo && animal.inativoPor?.fullName && ' '}
          {animal.inativoPor?.fullName && <>Inativado por {animal.inativoPor.fullName}.</>}
        </p>
      )}
    </div>
  );
}
