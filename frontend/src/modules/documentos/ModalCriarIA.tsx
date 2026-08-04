// src/modules/documentos/ModalCriarIA.tsx
// "Criar com IA": o vet descreve o documento e recebe o template montado.
//
// ⚠️ GERAÇÃO LOCAL POR ENQUANTO. O backend tem toda a infraestrutura de IA
// (src/ai/geminiClient.ts, catálogo de prompts versionados, log em AiUsageLog e gate
// de quota por empresa), mas NÃO existe ainda o prompt `gerar_template_documento` nem
// a rota que o exponha. Enquanto isso, `montarPorHeuristica` lê a descrição e monta um
// esqueleto plausível — o vet sai com um template real para ajustar, não com um erro.
//
// Ao ligar no Gemini, trocar apenas `gerar()`: a interface e o resto do módulo não
// mudam. O prompt precisa devolver EXATAMENTE o formato `Bloco[]` de ./types.

import { useState } from 'react';
import { Sparkles, X, Loader2, Wand2 } from 'lucide-react';
import { criarBloco } from './catalogo';
import type { Bloco, EspecieAlvo, Template, TipoBloco } from './types';

const EXEMPLO =
  'Quero um relatório de exame locomotor de equinos contendo histórico, escala AAEP, '
  + 'flexões, bloqueios anestésicos, conclusão e assinatura.';

/** Palavras-chave → blocos. Ordem importa: é a ordem em que entram na folha. */
const GATILHOS: { termos: string[]; blocos: [TipoBloco, string?][] }[] = [
  { termos: ['histórico', 'historico', 'anamnese'],
    blocos: [['subtitulo', 'Histórico'], ['texto', '{{consulta.anamnese}}']] },
  { termos: ['escala', 'aaep', 'claudica'],
    blocos: [['subtitulo', 'Escala AAEP por membro'], ['tabela']] },
  { termos: ['flex'],
    blocos: [['subtitulo', 'Testes de flexão'], ['tabela']] },
  { termos: ['bloqueio', 'anestés', 'anestes'],
    blocos: [['subtitulo', 'Bloqueios anestésicos'], ['tabela']] },
  { termos: ['medicament', 'receita', 'prescri'],
    blocos: [['subtitulo', 'Prescrição'], ['medicamentos']] },
  { termos: ['vacina'],
    blocos: [['subtitulo', 'Vacinação'], ['vacinas']] },
  { termos: ['exame', 'laborat', 'hemograma'],
    blocos: [['subtitulo', 'Exames'], ['exames']] },
  { termos: ['procedimento', 'cirurg'],
    blocos: [['subtitulo', 'Procedimentos'], ['procedimentos']] },
  { termos: ['checklist', 'verifica'],
    blocos: [['subtitulo', 'Checklist'], ['checklist']] },
  { termos: ['linha do tempo', 'evolução', 'evolucao'],
    blocos: [['subtitulo', 'Linha do tempo'], ['linhaTempo']] },
  { termos: ['imagem', 'foto', 'radiograf', 'ultrass'],
    blocos: [['subtitulo', 'Imagens'], ['imagem']] },
  { termos: ['conclus', 'diagnóstic', 'diagnostic', 'parecer'],
    blocos: [['subtitulo', 'Conclusão'], ['texto', '{{consulta.diagnostico}}']] },
  { termos: ['observa'],
    blocos: [['observacoes']] },
  { termos: ['financ', 'valor', 'orçament', 'orcament'],
    blocos: [['subtitulo', 'Valores'], ['tabelaDinamica']] },
];

function tituloDe(descricao: string): string {
  // Primeira oração, sem o "quero um/uma" — vira o título da folha.
  const limpo = descricao
    .replace(/^\s*(quero|preciso de|gostaria de|criar|faça|faca)\s+(um|uma|o|a)?\s*/i, '')
    .split(/[.,;\n]/)[0]
    .trim();
  return (limpo || 'Documento').toUpperCase().slice(0, 60);
}

function especieDe(descricao: string): EspecieAlvo {
  const d = descricao.toLowerCase();
  const eq = /equin|cavalo|égua|egua|potr/.test(d);
  const bo = /bovin|boi|vaca|gado|bezerr|novilh/.test(d);
  if (eq && !bo) return 'EQUINO';
  if (bo && !eq) return 'BOVINO';
  return 'AMBOS';
}

function montarPorHeuristica(descricao: string): Bloco[] {
  const d = descricao.toLowerCase();
  const saida: Bloco[] = [];

  const push = (tipo: TipoBloco, texto?: string) => {
    const b = criarBloco(tipo);
    if (texto !== undefined) {
      if (tipo === 'subtitulo' || tipo === 'texto' || tipo === 'titulo') b.conteudo.texto = texto;
    }
    saida.push(b);
  };

  // Cabeçalho: todo documento veterinário identifica animal e proprietário.
  push('titulo', tituloDe(descricao));
  saida.push(Object.assign(criarBloco('campoAuto'), {
    conteudo: { variavel: '{{cliente.nome}}', rotulo: 'Proprietário' },
  }));
  saida.push(Object.assign(criarBloco('campoAuto'), {
    conteudo: { variavel: '{{animal.nome}}', rotulo: 'Animal' },
  }));

  let achou = false;
  for (const g of GATILHOS) {
    if (!g.termos.some(t => d.includes(t))) continue;
    achou = true;
    g.blocos.forEach(([tipo, texto]) => push(tipo, texto));
  }

  // Descrição que não casou com nada ainda precisa render um documento útil.
  if (!achou) {
    push('subtitulo', 'Descrição');
    push('texto', descricao.trim());
  }

  // Assinatura e rodapé entram SEMPRE: documento veterinário sem assinatura do
  // responsável técnico não vale, mesmo que a descrição não peça.
  push('assinatura');
  push('rodape');
  return saida;
}

export default function ModalCriarIA({ aberto, onFechar, onGerado }: {
  aberto:   boolean;
  onFechar: () => void;
  onGerado: (dados: Pick<Template, 'nome' | 'descricao' | 'especie' | 'blocos'>) => void;
}) {
  const [descricao, setDescricao] = useState('');
  const [gerando,   setGerando]   = useState(false);

  if (!aberto) return null;

  const gerar = async () => {
    if (descricao.trim().length < 12) return;
    setGerando(true);
    // Espera curta proposital: a montagem é síncrona, mas o resultado aparecendo
    // instantaneamente passa a impressão de que nada foi processado.
    await new Promise(r => setTimeout(r, 550));
    onGerado({
      nome:      tituloDe(descricao).slice(0, 40),
      descricao: descricao.trim().slice(0, 160),
      especie:   especieDe(descricao),
      blocos:    montarPorHeuristica(descricao),
    });
    setGerando(false);
    setDescricao('');
    onFechar();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-[60] p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-xl border border-gray-100 max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gray-900 flex items-center justify-center">
              <Sparkles size={15} className="text-white" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900">Criar com IA</h3>
              <p className="text-[11px] text-gray-500">Descreva o documento e ele abre pronto no editor.</p>
            </div>
          </div>
          <button onClick={onFechar} className="p-1 text-gray-400 hover:text-gray-600" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
              Descreva o documento
            </label>
            <textarea
              value={descricao}
              onChange={e => setDescricao(e.target.value)}
              rows={5}
              placeholder={EXEMPLO}
              autoFocus
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500 resize-none"
            />
          </div>

          <button
            onClick={() => setDescricao(EXEMPLO)}
            className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-800"
          >
            <Wand2 size={12} /> Usar o exemplo
          </button>

          <p className="text-[11px] text-gray-400 leading-relaxed">
            Gera layout, campos, tabelas, variáveis, cabeçalho, rodapé e assinatura.
            Tudo fica editável depois — a IA dá o ponto de partida, não a palavra final.
          </p>
        </div>

        <div className="flex justify-end gap-2 px-5 pb-5 pt-3 border-t border-gray-100">
          <button onClick={onFechar} disabled={gerando}
            className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
            Cancelar
          </button>
          <button
            onClick={gerar}
            disabled={gerando || descricao.trim().length < 12}
            className="flex items-center gap-1.5 px-5 py-2 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-colors"
          >
            {gerando ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {gerando ? 'Gerando…' : 'Gerar template'}
          </button>
        </div>
      </div>
    </div>
  );
}
