// src/modules/documentos/ChatIA.tsx
// Chat da IA da Central de Documentos — painel lateral, multi-turno.
//
// 🔴 A IA TRABALHA SOBRE O ACERVO, não do zero. O backend
// (`services/documentoLLMService.js`) manda ao modelo a lista de modelos da clínica
// — os 12 globais do CFMV e os que ela criou — e o modelo escolhe um ou ajusta o que
// está aberto no editor. Documento veterinário tem conteúdo mínimo definido por
// norma; um modelo inventado sai plausível e incompleto.
//
// Substitui o `ModalCriarIA`, que não chamava modelo nenhum: era uma tabela de
// palavras-chave (`montarPorHeuristica`) rodando no bundle do navegador. Aquilo
// entregava um esqueleto; não entendia "tira a seção de exames", que é o que faz um
// chat valer a pena.

import { useEffect, useRef, useState } from 'react';
import { Sparkles, X, Loader2, Send, Wand2, FileCheck2 } from 'lucide-react';
import { conversarIA } from './api';
import type { TurnoChat } from './api';
import type { Bloco, Template } from './types';

const EXEMPLOS = [
  'Preciso de um atestado sanitário para trânsito de um equino.',
  'Monte o termo de consentimento para procedimento cirúrgico.',
  'Neste modelo, tire a seção de observações do responsável.',
  'Acrescente um campo de peso logo depois da identificação do animal.',
];

interface Mensagem extends TurnoChat {
  /** Marca o turno em que a IA efetivamente mexeu na folha. */
  aplicou?: 'AJUSTE' | 'MODELO';
}

export default function ChatIA({
  aberto, onFechar, templateAtivo, blocosAtuais, onAplicarBlocos, onEscolherTemplate,
}: {
  aberto:        boolean;
  onFechar:      () => void;
  templateAtivo: Template | null;
  blocosAtuais:  Bloco[];
  /** A IA reescreveu a folha — o editor adota estes blocos (e ganha um passo de undo). */
  onAplicarBlocos:    (blocos: Bloco[], nome: string | null) => void;
  /** A IA escolheu um modelo do acervo — a tela o abre. */
  onEscolherTemplate: (templateId: string) => void;
}) {
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [texto,     setTexto]     = useState('');
  const [pensando,  setPensando]  = useState(false);
  const [erro,      setErro]      = useState<string | null>(null);

  const fimRef = useRef<HTMLDivElement>(null);

  // Rola para a última mensagem a cada turno — sem isso a resposta nasce fora da
  // dobra num painel estreito e parece que nada aconteceu.
  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [mensagens, pensando]);

  if (!aberto) return null;

  const enviar = async (pergunta: string) => {
    const limpo = pergunta.trim();
    if (!limpo || pensando) return;

    const conversa: Mensagem[] = [...mensagens, { papel: 'usuario', texto: limpo }];
    setMensagens(conversa);
    setTexto('');
    setPensando(true);
    setErro(null);

    try {
      const r = await conversarIA({
        // Manda o histórico INTEIRO: é o que faz "agora tira a assinatura" saber do
        // que se está falando. O teto de turnos é aplicado no backend.
        conversa:   conversa.map(({ papel, texto: t }) => ({ papel, texto: t })),
        templateId: templateAtivo?.id ?? null,
        // Os blocos do EDITOR, que podem estar editados e não salvos — é sobre o
        // que o vet está vendo que o pedido de ajuste incide.
        blocos:     blocosAtuais,
      });

      let aplicou: Mensagem['aplicou'];
      if (r.acao === 'AJUSTAR' && r.blocos.length > 0) {
        onAplicarBlocos(r.blocos, r.nome);
        aplicou = 'AJUSTE';
      } else if (r.acao === 'USAR_TEMPLATE' && r.templateId) {
        onEscolherTemplate(r.templateId);
        aplicou = 'MODELO';
      }

      setMensagens(prev => [...prev, { papel: 'assistente', texto: r.resposta, aplicou }]);
    } catch (err) {
      const e = err as { response?: { status?: number; data?: { error?: string } } };
      // 429 = plano de IA da empresa estourado (gate de `iaQuotaService`). O texto do
      // backend explica o limite; o genérico esconderia o motivo real.
      setErro(e.response?.data?.error
        ?? (e.response?.status === 429
          ? 'O limite de IA da empresa foi atingido neste período.'
          : 'Não foi possível falar com a IA agora.'));
    } finally {
      setPensando(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onFechar} />
      <aside className="fixed right-0 top-0 bottom-0 w-full sm:w-[420px] bg-white shadow-2xl z-50 flex flex-col">

        <header className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-gray-900 flex items-center justify-center flex-shrink-0">
              <Sparkles size={15} className="text-white" />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-gray-900 text-sm">Assistente de documentos</p>
              <p className="text-[11px] text-gray-500 truncate">
                {templateAtivo ? `Ajustando "${templateAtivo.nome}"` : 'Trabalha sobre os seus modelos'}
              </p>
            </div>
          </div>
          <button onClick={onFechar} className="p-1 text-gray-400 hover:text-gray-600" aria-label="Fechar">
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
          {mensagens.length === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-gray-500 leading-relaxed">
                Descreva o documento que você precisa, ou peça um ajuste no que está aberto.
                O assistente parte dos <strong>modelos da sua clínica</strong> e dos modelos
                oficiais do CFMV — ele não inventa documento do zero.
              </p>
              <div className="space-y-1.5">
                {EXEMPLOS.map(ex => (
                  <button
                    key={ex}
                    onClick={() => void enviar(ex)}
                    className="w-full text-left flex items-start gap-2 px-3 py-2 rounded-xl border border-gray-100 hover:border-emerald-200 hover:bg-emerald-50/40 transition-colors"
                  >
                    <Wand2 size={12} className="text-emerald-600 mt-0.5 flex-shrink-0" />
                    <span className="text-xs text-gray-600">{ex}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {mensagens.map((m, i) => (
            <div key={i} className={m.papel === 'usuario' ? 'flex justify-end' : 'flex justify-start'}>
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${
                m.papel === 'usuario'
                  ? 'bg-emerald-600 text-white rounded-br-sm'
                  : 'bg-gray-100 text-gray-800 rounded-bl-sm'
              }`}>
                <p className="whitespace-pre-wrap leading-relaxed">{m.texto}</p>
                {m.aplicou && (
                  <p className="flex items-center gap-1.5 mt-2 text-[11px] font-semibold text-emerald-700">
                    <FileCheck2 size={12} />
                    {m.aplicou === 'AJUSTE' ? 'Documento atualizado no editor' : 'Modelo aberto no editor'}
                  </p>
                )}
              </div>
            </div>
          ))}

          {pensando && (
            <div className="flex justify-start">
              <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-3.5 py-2.5">
                <Loader2 size={15} className="animate-spin text-gray-400" />
              </div>
            </div>
          )}

          <div ref={fimRef} />
        </div>

        {/* Erro na superfície da AÇÃO: logo acima do campo que a disparou, não no
            topo da página atrás do painel (§6). */}
        {erro && (
          <div className="mx-4 mb-2 px-3 py-2 rounded-xl bg-red-50 border border-red-100 text-xs text-red-700">
            {erro}
          </div>
        )}

        <form
          onSubmit={e => { e.preventDefault(); void enviar(texto); }}
          className="flex items-end gap-2 px-4 pb-4 pt-2 border-t border-gray-100 flex-shrink-0"
        >
          <textarea
            value={texto}
            onChange={e => setTexto(e.target.value)}
            onKeyDown={e => {
              // Enter envia, Shift+Enter quebra linha — o que a mão espera de um chat.
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void enviar(texto); }
            }}
            rows={2}
            placeholder="Peça o documento ou o ajuste…"
            className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 resize-none"
          />
          <button
            type="submit"
            disabled={pensando || !texto.trim()}
            className="p-2.5 rounded-xl bg-gray-900 text-white hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            aria-label="Enviar"
          >
            {pensando ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </form>
      </aside>
    </>
  );
}
