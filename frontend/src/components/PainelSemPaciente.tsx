// frontend/src/components/PainelSemPaciente.tsx
//
// 🔴 O QUE A TELA MOSTRA ENQUANTO NENHUM PACIENTE FOI ESCOLHIDO (2026-09-22).
//
// Desde que Atendimento, Vacina, Resultado de Exame, Dieta e Relatório Nutricional
// passaram a ABRIR VAZIAS — em modo "buscar animal" (§6) —, todas precisam do mesmo
// espaço abaixo do seletor. Antes cada uma resolvia isso do seu jeito, e três delas
// faziam pior: davam `return` ANTES do seletor com "Você ainda não possui animais sob
// sua responsabilidade", que é uma AFIRMAÇÃO FALSA quando a lista está cheia e a
// pessoa só não escolheu ninguém ainda — e, pior, sem o seletor não havia como
// escolher, então a tela ficava num beco sem saída.
//
// ⚠️ Os três estados são DIFERENTES e não podem ser colapsados em um:
//   carregando → ainda não se sabe;      vazio → a base não tem paciente;
//   nenhum dos dois → há pacientes, falta escolher.
// Colapsar "falta escolher" em "não há paciente" é exatamente o bug acima.

import type { LucideIcon } from 'lucide-react';

export default function PainelSemPaciente({
  icone: Icone, carregando = false, vazio = false, acao,
}: {
  /** O ícone do MÓDULO (seringa, microscópio, prato…) — a tela continua reconhecível. */
  icone:       LucideIcon;
  carregando?: boolean;
  /** true = a lista veio vazia de verdade (não é "falta escolher"). */
  vazio?:      boolean;
  /** O que fazer depois de escolher, na voz do módulo. Ex.: "consultar vacinas". */
  acao?:       string;
}) {
  return (
    <div className="mt-4 bg-white rounded-2xl border border-gray-100 shadow-sm">
      <div className="flex flex-col items-center justify-center py-14 text-center px-6">
        <Icone size={30} className="text-gray-200 mb-3" />
        {carregando ? (
          <p className="text-sm text-gray-400">Carregando pacientes…</p>
        ) : vazio ? (
          <>
            <p className="text-sm text-gray-500">Você ainda não possui pacientes sob sua responsabilidade.</p>
            <p className="text-xs text-gray-400 mt-1">Solicite o vínculo com um paciente para começar.</p>
          </>
        ) : (
          <p className="text-sm text-gray-400">
            Busque e selecione o paciente acima{acao ? ` para ${acao}` : ''}.
          </p>
        )}
      </div>
    </div>
  );
}
