// src/modules/documentos/ModalPreencher.tsx
//
// A tela que abre ao clicar em GERAR: preenche o que falta e emite.
//
// 🔴 A IDEIA: o veterinário não deve pensar em "variável" nenhuma. Ele escolhe o
// paciente, clica em Gerar, e recebe uma lista curta — só o que o sistema NÃO sabe
// (tatuagem, nº da partida da vacina, hora do óbito) e o que o cadastro daquele animal
// não tinha (microchip em branco). Tudo o mais já vem preenchido e ele só confere.
//
// A interatividade é nos DOIS SENTIDOS, e é isso que a torna útil numa folha A4 densa:
//   · focar um campo no formulário DESTACA e ROLA até ele na folha;
//   · clicar no traço na folha FOCA o campo no formulário.
// Sem isso, "Localidade do óbito" é um input no meio de onze, e a pessoa não faz ideia
// de onde aquilo cai no papel.
//
// ⚠️ Campo em branco NÃO bloqueia a emissão. O papel sempre teve linha para preencher
// à mão, e travar a emissão porque falta o nº do brinco pararia o atendimento por um
// dado que o vet talvez vá anotar na hora. O que a tela faz é AVISAR quantos vão sair
// em branco — decidir é de quem assina.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { X, Loader2, FileCheck2, PenLine, Eye, ListChecks, AlertTriangle, Sparkles } from 'lucide-react';

import BlocoView from './BlocoView';
import type { MarcaFolha } from './BlocoView';
import { agruparPorSecao, chaveDaLacuna, contarPreenchidos } from './campos';
import type { CampoDocumento, Preenchimento } from './campos';
import type { ContextoVariaveis } from './catalogo';
import type { Bloco } from './types';

/** Rótulos que pedem data — o input vira `date` e o vet ganha o calendário do SO. */
const PISTA_DATA = /\bdata\b|nascimento|validade|fabrica[çc][ãa]o|vencimento/i;
/** Rótulos que pedem hora. */
const PISTA_HORA = /\bhora\b|hor[áa]rio/i;

function tipoDoCampo(campo: CampoDocumento): 'text' | 'date' | 'time' {
  if (campo.multilinha) return 'text';
  if (PISTA_HORA.test(campo.rotulo)) return 'time';
  // "Data de fabricação / Data de validade" são DUAS datas num rótulo só (é assim no
  // anexo XI do CFMV) — ali um `date` mentiria sobre o que cabe. Só vira `date` quando
  // o rótulo fala de UMA data.
  if (PISTA_DATA.test(campo.rotulo) && !campo.rotulo.includes('/')) return 'date';
  return 'text';
}

const AJUDA_ORIGEM: Record<CampoDocumento['origem'], string> = {
  LACUNA:     'Campo do formulário oficial',
  CADASTRO:   'Não consta no cadastro do paciente',
  OBSERVACAO: 'Texto livre — opcional',
};

export default function ModalPreencher({
  aberto, onFechar, templateNome, animalNome, blocos, campos, contexto, marca,
  carregando, emitindo, erro, onEmitir,
}: {
  aberto:       boolean;
  onFechar:     () => void;
  templateNome: string;
  animalNome:   string;
  blocos:       Bloco[];
  campos:       CampoDocumento[];
  contexto:     ContextoVariaveis | null;
  marca:        MarcaFolha | null;
  carregando:   boolean;
  emitindo:     boolean;
  erro:         string | null;
  onEmitir:     (preenchimento: Preenchimento) => void;
}) {
  const [valores, setValores] = useState<Preenchimento>({});
  const [focado,  setFocado]  = useState<string | null>(null);
  const [abaMobile, setAbaMobile] = useState<'campos' | 'folha'>('campos');

  const folhaRef  = useRef<HTMLDivElement>(null);
  const inputsRef = useRef<Record<string, HTMLElement | null>>({});

  // Abrir de novo (outro modelo, outro paciente) recomeça do zero — carregar o que foi
  // digitado para o documento ANTERIOR poria dado do paciente errado no papel.
  useEffect(() => {
    if (aberto) { setValores({}); setFocado(null); setAbaMobile('campos'); }
  }, [aberto, templateNome, animalNome]);

  const preenchidos = contarPreenchidos(campos, valores);
  const faltando    = campos.length - preenchidos;
  const grupos      = useMemo(() => agruparPorSecao(campos), [campos]);

  const definir = useCallback((chave: string, v: string) => {
    setValores(prev => ({ ...prev, [chave]: v }));
  }, []);

  /**
   * Clicar no traço na FOLHA foca o campo no formulário.
   * No celular, troca para a aba do formulário antes — focar um input que está numa
   * aba escondida não leva a lugar nenhum.
   */
  const focarDaFolha = useCallback((chave: string) => {
    setFocado(chave);
    setAbaMobile('campos');
    // `requestAnimationFrame`: no mobile o input só existe depois da troca de aba.
    requestAnimationFrame(() => {
      const el = inputsRef.current[chave];
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      (el as HTMLInputElement | null)?.focus?.();
    });
  }, []);

  /** Focar o campo no FORMULÁRIO rola a folha até onde ele cai no papel. */
  useEffect(() => {
    if (!focado || !folhaRef.current) return;
    const alvo = folhaRef.current.querySelector('[data-focado="1"]');
    alvo?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focado]);

  if (!aberto) return null;

  const folha: CSSProperties = {
    width: '210mm', minHeight: '297mm', padding: '18mm 16mm',
    background: '#fff', color: '#111827',
    fontFamily: 'Inter, system-ui, sans-serif',
    transform: 'scale(0.62)', transformOrigin: 'top center',
    // A folha é 210mm mas exibida a 62%: sem compensar a altura, o container ficaria
    // com o espaço da folha inteira e sobraria um vão enorme embaixo.
    marginBottom: '-113mm',
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-0 sm:p-6">
      <div className="bg-white w-full h-full sm:h-[92vh] sm:max-w-6xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden">

        {/* ── Cabeçalho ── */}
        <header className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-gray-100 flex-shrink-0">
          <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
            <PenLine size={17} className="text-emerald-700" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-bold text-gray-900 text-sm sm:text-base truncate">{templateNome}</h2>
            <p className="text-[11px] sm:text-xs text-gray-500 truncate">
              Emitir para <strong className="text-gray-700">{animalNome}</strong>
            </p>
          </div>
          <button onClick={onFechar} className="p-1.5 text-gray-400 hover:text-gray-600 flex-shrink-0" aria-label="Fechar">
            <X size={18} />
          </button>
        </header>

        {/* ── Abas (só no celular) ── */}
        <div className="flex sm:hidden border-b border-gray-100 flex-shrink-0">
          {([['campos', 'Preencher', <ListChecks key="a" size={13} />],
             ['folha',  'Prévia',    <Eye key="b" size={13} />]] as const).map(([k, rotulo, icone]) => (
            <button key={k} onClick={() => setAbaMobile(k)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors ${
                abaMobile === k ? 'text-emerald-700 border-b-2 border-emerald-600' : 'text-gray-400'
              }`}>
              {icone} {rotulo}
            </button>
          ))}
        </div>

        <div className="flex-1 flex min-h-0">

          {/* ── Formulário ── */}
          <section className={`${abaMobile === 'campos' ? 'flex' : 'hidden'} sm:flex flex-col w-full sm:w-[46%] sm:border-r border-gray-100 min-h-0`}>
            {carregando ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 size={20} className="animate-spin text-gray-300" />
              </div>
            ) : campos.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
                <Sparkles size={26} className="text-emerald-300 mb-3" />
                <p className="text-sm font-semibold text-gray-700">Nada a preencher</p>
                <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                  O cadastro de {animalNome} já cobre todos os campos deste documento.
                  Confira a prévia e emita.
                </p>
              </div>
            ) : (
              <>
                {/* Progresso: diz quanto falta sem obrigar a contar inputs na tela. */}
                <div className="px-4 sm:px-5 pt-3 pb-2 flex-shrink-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                      Campos a preencher
                    </p>
                    <span className="text-[11px] font-semibold text-gray-500 tabular-nums">
                      {preenchidos} de {campos.length}
                    </span>
                  </div>
                  <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-300"
                      style={{ width: `${campos.length ? (preenchidos / campos.length) * 100 : 0}%` }}
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-4 sm:px-5 pb-4 min-h-0">
                  {grupos.map(g => (
                    <div key={g.secao} className="mt-4 first:mt-2">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                        {g.secao}
                      </p>
                      <div className="space-y-2.5">
                        {g.campos.map(campo => {
                          const valor = valores[campo.chave] ?? '';
                          const ativo = focado === campo.chave;
                          return (
                            <div key={campo.chave}>
                              <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 mb-1">
                                {campo.rotulo}
                                {campo.origem === 'CADASTRO' && (
                                  <span
                                    title={AJUDA_ORIGEM.CADASTRO}
                                    className="text-[9px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full"
                                  >
                                    fora do cadastro
                                  </span>
                                )}
                              </label>
                              {campo.multilinha ? (
                                <textarea
                                  ref={el => { inputsRef.current[campo.chave] = el; }}
                                  value={valor} rows={3}
                                  onChange={e => definir(campo.chave, e.target.value)}
                                  onFocus={() => setFocado(campo.chave)}
                                  placeholder={AJUDA_ORIGEM[campo.origem]}
                                  className={`w-full border rounded-xl px-3 py-2 text-sm resize-none transition-colors focus:outline-none ${
                                    ativo ? 'border-emerald-500 ring-2 ring-emerald-100' : 'border-gray-200 focus:border-emerald-500'
                                  }`}
                                />
                              ) : (
                                <input
                                  ref={el => { inputsRef.current[campo.chave] = el; }}
                                  type={tipoDoCampo(campo)}
                                  value={valor}
                                  onChange={e => definir(campo.chave, e.target.value)}
                                  onFocus={() => setFocado(campo.chave)}
                                  placeholder={campo.origem === 'LACUNA' ? 'Deixe em branco para preencher à mão' : ''}
                                  className={`w-full border rounded-xl px-3 py-2 text-sm transition-colors focus:outline-none ${
                                    ativo ? 'border-emerald-500 ring-2 ring-emerald-100' : 'border-gray-200 focus:border-emerald-500'
                                  }`}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          {/* ── Folha ── */}
          <section className={`${abaMobile === 'folha' ? 'flex' : 'hidden'} sm:flex flex-1 min-w-0 bg-gray-100 overflow-auto justify-center py-5`}>
            <div ref={folhaRef} style={folha} className="shadow-lg rounded-sm flex-shrink-0">
              {(marca?.logoUrl || marca?.empresaNome) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid #e5e7eb',
                              paddingBottom: 10, marginBottom: 14 }}>
                  {marca.logoUrl
                    ? <img src={marca.logoUrl} alt="" style={{ maxHeight: 48, maxWidth: 170, objectFit: 'contain' }} />
                    : <p style={{ fontSize: 14, fontWeight: 700 }}>{marca.empresaNome}</p>}
                </div>
              )}
              {blocos.map(b => (
                <BlocoView
                  key={b.id}
                  bloco={b} contexto={contexto} marca={marca}
                  preenchimento={valores}
                  campoFocado={focado}
                  onFocarCampo={focarDaFolha}
                />
              ))}
            </div>
          </section>
        </div>

        {/* ── Rodapé ── */}
        <footer className="flex-shrink-0 border-t border-gray-100 px-4 sm:px-5 py-3">
          {/* Erro na superfície da AÇÃO: acima do botão que a disparou (§6). */}
          {erro && (
            <div className="mb-2 px-3 py-2 rounded-xl bg-red-50 border border-red-100 text-xs text-red-700">
              {erro}
            </div>
          )}
          <div className="flex items-center gap-3">
            {/* Aviso, nunca bloqueio: o papel sempre teve linha para preencher à mão. */}
            {faltando > 0 && campos.length > 0 && (
              <p className="flex items-center gap-1.5 text-[11px] text-amber-700 min-w-0">
                <AlertTriangle size={13} className="flex-shrink-0" />
                <span className="truncate">
                  {faltando} {faltando === 1 ? 'campo sairá em branco' : 'campos sairão em branco'} no documento
                </span>
              </p>
            )}
            <div className="flex gap-2 ml-auto flex-shrink-0">
              <button onClick={onFechar} disabled={emitindo}
                className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
                Cancelar
              </button>
              <button
                onClick={() => onEmitir(valores)}
                disabled={emitindo || carregando}
                className="flex items-center gap-1.5 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-colors"
              >
                {emitindo ? <Loader2 size={14} className="animate-spin" /> : <FileCheck2 size={14} />}
                {emitindo ? 'Emitindo…' : 'Emitir documento'}
              </button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

export { chaveDaLacuna };
