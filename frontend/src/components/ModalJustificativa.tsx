// src/components/ModalJustificativa.tsx
// Modal padrão de confirmação de exclusão/cancelamento COM justificativa obrigatória.
// Toda ação destrutiva da aplicação deve usar este modal — o motivo é exigido pelo
// backend e registrado na Auditoria (módulo Geral).
//
// DOIS MODOS:
//   · sem `motivos` → texto livre obrigatório (o comportamento de sempre; é o que os
//     ~15 usos existentes continuam tendo, sem tocar em nenhum deles);
//   · com `motivos` → SELETOR de motivo padronizado + descrição abaixo. A descrição só
//     é obrigatória nas opções marcadas com `exigeDescricao` (na prática, "Outro").
//
// POR QUE O SELETOR: em texto livre o mesmo fato vira "troca de vet", "mudou de
// veterinário" e "TROCA VET" — impossível de agrupar depois, e é esse agrupamento que
// responde "por que perdemos pacientes?". O que chega ao backend continua sendo UMA
// string (o contrato não muda), composta como `Motivo — descrição`.

import { useState, useEffect } from 'react';
import ErroAcao, { type ErroAcaoDados } from './ErroAcao';
import { AlertTriangle, X, ChevronDown } from 'lucide-react';

/** Uma opção do seletor de motivo. */
export interface MotivoOpcao {
  valor: string;
  /** Quando true, a descrição vira obrigatória ao escolher esta opção. */
  exigeDescricao?: boolean;
}

interface ModalJustificativaProps {
  aberto: boolean;
  titulo: string;              // ex: "Excluir exame?"
  descricao?: string;          // ex: nome/identificação do registro
  acaoLabel?: string;          // rótulo do botão de confirmação (default "Excluir")
  placeholder?: string;
  /** Presente = modo SELETOR (ver o cabeçalho). Ausente = texto livre, como sempre. */
  motivos?: MotivoOpcao[];
  /** Rótulo do seletor. */
  motivoLabel?: string;
  processando?: boolean;
  /** Erro da própria ação (ex.: 400 do backend). Renderizado AQUI, junto ao botão —
      no topo da página ficaria atrás deste overlay e o usuário não veria. */
  erro?: ErroAcaoDados | string | null;
  /**
   * `motivo` = a DESCRIÇÃO livre. `motivoTipo` = a CATEGORIA escolhida no seletor
   * (undefined no modo texto livre).
   *
   * ⚠️ Vêm SEPARADOS de propósito. Antes o modal entregava tudo concatenado
   * (`"Falecimento — no pasto"`), e a tela gravava numa coluna TEXT só; relatório em
   * cima disso exige `LIKE '%...%'`, que com curinga à esquerda não usa índice e vira
   * Seq Scan. Separado, a categoria vai para coluna própria e indexada.
   */
  onConfirmar: (motivo: string, motivoTipo?: string) => void | Promise<void>;
  onFechar: () => void;
}

export default function ModalJustificativa({
  aberto,
  titulo,
  descricao,
  acaoLabel = 'Excluir',
  placeholder = 'Descreva o motivo (obrigatório)...',
  motivos,
  motivoLabel = 'Motivo',
  processando = false,
  erro = null,
  onConfirmar,
  onFechar,
}: ModalJustificativaProps) {
  const [motivo,    setMotivo]    = useState('');   // texto livre / descrição
  const [selecionado, setSelecionado] = useState('');

  // Limpa os campos sempre que o modal abre — reabrir com o motivo da exclusão
  // anterior é o caminho mais curto para gravar a justificativa errada.
  useEffect(() => { if (aberto) { setMotivo(''); setSelecionado(''); } }, [aberto]);

  if (!aberto) return null;

  const usaSeletor = Array.isArray(motivos) && motivos.length > 0;
  const opcao = motivos?.find(m => m.valor === selecionado) ?? null;
  const descricaoObrigatoria = !!opcao?.exigeDescricao;
  const temDescricao = motivo.trim().length >= 3;

  const motivoValido = usaSeletor
    ? (!!selecionado && (!descricaoObrigatoria || temDescricao))
    : temDescricao;



  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col max-h-[88vh] overflow-hidden">
        <div className="bg-red-600 px-5 py-3.5 rounded-t-2xl flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} className="text-white/90" />
            <p className="font-bold text-sm text-white">{titulo}</p>
          </div>
          <button onClick={onFechar} className="text-white/60 hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {descricao && <p className="text-sm text-gray-700">{descricao}</p>}

          {usaSeletor && (
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                {motivoLabel} <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <select
                  autoFocus
                  value={selecionado}
                  onChange={(e) => setSelecionado(e.target.value)}
                  className="w-full appearance-none border border-gray-300 rounded-xl px-3 py-2 pr-9 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="">Selecione o motivo...</option>
                  {motivos!.map(m => <option key={m.valor} value={m.valor}>{m.valor}</option>)}
                </select>
                <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              {usaSeletor ? 'Descrição' : 'Justificativa'}
              {/* O asterisco acompanha a REGRA: no modo seletor, a descrição só é
                  exigida na opção marcada (na prática, "Outro") — pedir descrição em
                  "Falecimento" seria burocracia sem informação nova. */}
              {(!usaSeletor || descricaoObrigatoria) && <span className="text-red-500"> *</span>}
            </label>
            <textarea
              autoFocus={!usaSeletor}
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder={
                usaSeletor
                  ? (descricaoObrigatoria ? 'Descreva o motivo (obrigatório)...' : 'Detalhe, se quiser (opcional)...')
                  : placeholder
              }
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
            />
            <p className="text-[10px] text-gray-400 mt-1">
              {usaSeletor && !descricaoObrigatoria
                ? 'O motivo escolhido fica registrado na auditoria.'
                : 'A justificativa é obrigatória e fica registrada na auditoria.'}
            </p>
          </div>
        </div>

        <div className="p-4 border-t border-gray-100 flex-shrink-0">
          <ErroAcao
            erro={typeof erro === 'string' ? { mensagem: erro } : (erro ?? null)}
            className="mb-3"
          />
          {/* Rodapé no padrão da aplicação: ações à DIREITA, tamanho padrão, Cancelar
              ao lado da ação. Eram dois botões de largura desigual (o de ação em
              `flex-1`) — o Cancelar com o mesmo peso visual da ação. */}
          <div className="flex items-center justify-end gap-3">
          <button onClick={onFechar} disabled={processando}
            className="px-4 py-2.5 border border-gray-300 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50 disabled:opacity-50">
            Cancelar
          </button>
          <button
            onClick={() => onConfirmar(motivo.trim(), usaSeletor ? selecionado : undefined)}
            disabled={processando || !motivoValido}
            className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-semibold disabled:opacity-50">
            {processando ? 'Processando...' : acaoLabel}
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}
