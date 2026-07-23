// frontend/src/components/RelatorioAtendimentoModal.tsx
//
// Pré-visualização + edição do relatório de evolução (body-map + scores).
// - Imprimir: usa o relatório SALVO (cache da extração IA em resumoIaData) —
//   reimprimir não gasta tokens de IA.
// - Editar relatório: o veterinário corrige o resumo clínico (claudicação, dor,
//   tensão muscular, simetria, ROM, treino, observação). Ao salvar, SOBRESCREVE
//   o relatório salvo (PUT /clinica/evolucoes/:id/resumo-ia) e a edição manual
//   passa a ter precedência sobre a IA (nunca é re-extraída por cima).
// - O mapa corporal (imagem) NÃO é editável aqui: ele é gerado a partir do
//   texto da evolução — o botão "Alterar evolução" abre a edição da evolução,
//   e salvar um novo texto regenera o mapa na próxima impressão.

import { useState } from 'react';
import toast from 'react-hot-toast';
import { X, Printer, Pencil, Loader2, Plus, Trash2, FileText } from 'lucide-react';
import api from '../services/api';
import {
  gerarHtmlRelatorioAtendimento,
  imprimirHtml,
  buscarRelatorioAtendimento,
  type RelatorioAtendimentoDados,
  type ResumoClinico,
  type TensaoMuscularItem,
  type RomItem,
  type TreinoItem,
} from '../utils/RelatorioAtendimento';
import InlineError from './InlineError';

interface Props {
  dadosIniciais:     RelatorioAtendimentoDados;
  podeEditar:        boolean;
  onClose:           () => void;
  /** Presente apenas quando o usuário pode alterar a evolução (regra de autoria/status). */
  onEditarEvolucao?: () => void;
}

const LABEL = 'block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1';
const INPUT = 'w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-emerald-500';

export default function RelatorioAtendimentoModal({ dadosIniciais, podeEditar, onClose, onEditarEvolucao }: Props) {
  const [dados,    setDados]    = useState<RelatorioAtendimentoDados>(dadosIniciais);
  const [modo,     setModo]     = useState<'preview' | 'editar'>('preview');
  const [salvando, setSalvando] = useState(false);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);

  // ── Form (inicializado ao entrar no modo edição) ───────────────────────────
  const [claudicacao, setClaudicacao] = useState('');
  const [dor,         setDor]         = useState('');
  const [simetria,    setSimetria]    = useState('');
  const [tensao,      setTensao]      = useState<TensaoMuscularItem[]>([]);
  const [rom,         setRom]         = useState<RomItem[]>([]);
  const [treino,      setTreino]      = useState<TreinoItem[]>([]);
  const [observacao,  setObservacao]  = useState('');

  const abrirEdicaoRelatorio = () => {
    const rc = dados.atual.resumoClinico ?? {};
    setClaudicacao(rc.claudicacao?.grauAAEP != null ? String(rc.claudicacao.grauAAEP) : '');
    setDor(rc.dor?.valor != null ? String(rc.dor.valor) : '');
    setSimetria(rc.simetria ?? '');
    setTensao((rc.tensaoMuscular ?? []).map(t => ({ ...t })));
    setRom((rc.rom ?? []).map(r => ({ ...r })));
    setTreino((rc.treino ?? []).map(t => ({ ...t })));
    setObservacao(rc.observacaoFechamento ?? '');
    setModo('editar');
  };

  const montarResumo = (): ResumoClinico | null => {
    const rc: ResumoClinico = {};
    if (claudicacao.trim() !== '' && !isNaN(Number(claudicacao))) rc.claudicacao = { grauAAEP: Number(claudicacao) };
    if (dor.trim() !== '' && !isNaN(Number(dor)))                 rc.dor = { valor: Number(dor) };
    if (simetria.trim()) rc.simetria = simetria.trim();
    const t  = tensao.filter(x => x.regiao.trim());
    const r  = rom.filter(x => x.teste.trim());
    const tr = treino.filter(x => x.titulo.trim());
    if (t.length)  rc.tensaoMuscular = t;
    if (r.length)  rc.rom = r;
    if (tr.length) rc.treino = tr;
    if (observacao.trim()) rc.observacaoFechamento = observacao.trim();
    return Object.keys(rc).length ? rc : null;
  };

  const handleSalvar = async () => {
    setSalvando(true);
    try {
      await api.put(`/clinica/evolucoes/${dados.atual.id}/resumo-ia`, { resumoClinico: montarResumo() });
      const novos = await buscarRelatorioAtendimento(dados.atual.id);
      setDados(novos);
      setModo('preview');
      toast.success('Relatório atualizado');
    } catch (err) {
      const e = err as { isPermissionError?: boolean };
      if (!e.isPermissionError) setErroInline('Erro ao salvar o relatório');
    } finally { setSalvando(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-2 lg:p-4" onClick={onClose}>
      {/* Celular e tablet: quase tela cheia. Desktop (lg+): folha A4. */}
      <div className="bg-white rounded-2xl shadow-xl w-full h-full lg:w-[794px] lg:h-[90vh] lg:max-h-[1123px] flex flex-col"
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-shrink-0">
          <span className="font-bold text-gray-900 text-sm">
            Relatório de Evolução {dados.atual.atendimentoNumero ? `· ${dados.atual.atendimentoNumero}` : ''}
          </span>
          <div className="flex items-center gap-2">
            {modo === 'preview' && (
              <>
                {podeEditar && (
                  <button onClick={abrirEdicaoRelatorio}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
                    <Pencil size={13} /> Editar relatório
                  </button>
                )}
                <button onClick={() => imprimirHtml(gerarHtmlRelatorioAtendimento(dados))}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors">
                  <Printer size={13} /> Imprimir
                </button>
              </>
            )}
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
              <X size={18} />
            </button>
          </div>
        </div>

        {modo === 'preview' ? (
          <iframe
            title="Pré-visualização do relatório de evolução"
            srcDoc={gerarHtmlRelatorioAtendimento(dados)}
            className="flex-1 w-full rounded-b-2xl"
            style={{ border: 'none' }}
          />
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

            <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
              <FileText size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 flex-1">
                O <b>mapa corporal (imagem)</b> é gerado a partir do texto da evolução e não é editável aqui.
                {onEditarEvolucao
                  ? ' Para alterá-lo, altere a evolução — o mapa será regenerado.'
                  : ' Para alterá-lo é preciso alterar a evolução.'}
              </p>
              {onEditarEvolucao && (
                <button onClick={onEditarEvolucao}
                  className="flex-shrink-0 px-2.5 py-1 text-xs font-semibold text-amber-800 border border-amber-300 rounded-lg hover:bg-amber-100 transition-colors">
                  Alterar evolução
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={LABEL}>Claudicação (AAEP 0–5)</label>
                <input type="number" min={0} max={5} value={claudicacao}
                  onChange={e => setClaudicacao(e.target.value)} placeholder="—" className={INPUT} />
              </div>
              <div>
                <label className={LABEL}>Dor à palpação (0–10)</label>
                <input type="number" min={0} max={10} value={dor}
                  onChange={e => setDor(e.target.value)} placeholder="—" className={INPUT} />
              </div>
              <div>
                <label className={LABEL}>Simetria</label>
                <input type="text" value={simetria}
                  onChange={e => setSimetria(e.target.value)} placeholder="Ex: Simétrica" className={INPUT} />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className={`${LABEL} mb-0`}>Tensão muscular por região (0–3)</label>
                <button onClick={() => setTensao(prev => [...prev, { regiao: '', valor: 0 }])}
                  className="flex items-center gap-1 text-xs text-emerald-700 font-semibold hover:text-emerald-900">
                  <Plus size={12} /> Adicionar
                </button>
              </div>
              {tensao.length === 0 && <p className="text-xs text-gray-300">Nenhuma região registrada.</p>}
              <div className="space-y-2">
                {tensao.map((t, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input type="text" value={t.regiao} placeholder="Região (ex: Longuíssimo lombar)"
                      onChange={e => setTensao(prev => prev.map((x, idx) => idx === i ? { ...x, regiao: e.target.value } : x))}
                      className={`${INPUT} flex-1`} />
                    <input type="number" min={0} max={3} step={0.5} value={t.valor}
                      onChange={e => setTensao(prev => prev.map((x, idx) => idx === i ? { ...x, valor: Number(e.target.value) } : x))}
                      className={`${INPUT} w-20 text-center`} />
                    <button onClick={() => setTensao(prev => prev.filter((_, idx) => idx !== i))}
                      className="p-1.5 text-red-400 hover:text-red-600 flex-shrink-0"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className={`${LABEL} mb-0`}>Amplitude de movimento (ROM)</label>
                <button onClick={() => setRom(prev => [...prev, { teste: '', resultado: '' }])}
                  className="flex items-center gap-1 text-xs text-emerald-700 font-semibold hover:text-emerald-900">
                  <Plus size={12} /> Adicionar
                </button>
              </div>
              {rom.length === 0 && <p className="text-xs text-gray-300">Nenhum teste registrado.</p>}
              <div className="space-y-2">
                {rom.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input type="text" value={r.teste} placeholder="Teste (ex: Flexão lateral)"
                      onChange={e => setRom(prev => prev.map((x, idx) => idx === i ? { ...x, teste: e.target.value } : x))}
                      className={`${INPUT} flex-1`} />
                    <input type="text" value={r.resultado} placeholder="Resultado"
                      onChange={e => setRom(prev => prev.map((x, idx) => idx === i ? { ...x, resultado: e.target.value } : x))}
                      className={`${INPUT} flex-1`} />
                    <button onClick={() => setRom(prev => prev.filter((_, idx) => idx !== i))}
                      className="p-1.5 text-red-400 hover:text-red-600 flex-shrink-0"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className={`${LABEL} mb-0`}>Orientações para o treino</label>
                <button onClick={() => setTreino(prev => [...prev, { status: 'liberado', titulo: '', detalhe: '' }])}
                  className="flex items-center gap-1 text-xs text-emerald-700 font-semibold hover:text-emerald-900">
                  <Plus size={12} /> Adicionar
                </button>
              </div>
              {treino.length === 0 && <p className="text-xs text-gray-300">Nenhuma orientação registrada.</p>}
              <div className="space-y-2">
                {treino.map((t, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <select value={t.status}
                      onChange={e => setTreino(prev => prev.map((x, idx) => idx === i ? { ...x, status: e.target.value as TreinoItem['status'] } : x))}
                      className={`${INPUT} w-32 flex-shrink-0`}>
                      <option value="liberado">Liberado</option>
                      <option value="restrito">Restrito</option>
                      <option value="suspenso">Suspenso</option>
                    </select>
                    <div className="flex-1 space-y-1.5">
                      <input type="text" value={t.titulo} placeholder="Título (ex: Trote leve)"
                        onChange={e => setTreino(prev => prev.map((x, idx) => idx === i ? { ...x, titulo: e.target.value } : x))}
                        className={INPUT} />
                      <input type="text" value={t.detalhe} placeholder="Detalhe"
                        onChange={e => setTreino(prev => prev.map((x, idx) => idx === i ? { ...x, detalhe: e.target.value } : x))}
                        className={INPUT} />
                    </div>
                    <button onClick={() => setTreino(prev => prev.filter((_, idx) => idx !== i))}
                      className="p-1.5 text-red-400 hover:text-red-600 flex-shrink-0 mt-1"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className={LABEL}>Observação de fechamento</label>
              <textarea value={observacao} onChange={e => setObservacao(e.target.value)} rows={3}
                placeholder="Síntese/conclusão exibida no relatório…"
                className={`${INPUT} resize-none`} />
            </div>

            <InlineError message={erroInline} className="mt-2" />

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
              <button onClick={() => setModo('preview')} disabled={salvando}
                className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50">
                Cancelar
              </button>
              <button onClick={handleSalvar} disabled={salvando}
                className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-1.5">
                {salvando && <Loader2 size={13} className="animate-spin" />}
                Salvar relatório
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
