// src/modules/documentos/Emitidos.tsx
// O DOCUMENTO JÁ EMITIDO: visualização, impressão, envio e cancelamento.
//
// FONTE ÚNICA das duas telas que mostram documentos emitidos — o "Histórico de
// Documentos" da Central (`pages/Documentos.tsx`) e o card "Documentos" da tela do
// paciente (`pages/AnimalDetail.tsx`). Duas listas separadas divergiriam na primeira
// correção, que é a lição do `SubModuloMinhaAgenda` (armadilha 28-g do CLAUDE.md):
// para variar o comportamento entre as telas, passe uma prop — não copie a lista.
//
// ⚠️ O emitido é SNAPSHOT: os blocos já vêm com as variáveis resolvidas pelo backend,
// e `marca` guarda o timbre do DIA DA EMISSÃO. Nada aqui resolve variável nem busca a
// marca de hoje — reimprimir tem de devolver o papel que o cliente recebeu.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, Printer, Ban, FileText, X, Loader2, ZoomIn, ZoomOut } from 'lucide-react';

import AcaoRegistro, { AcoesRegistro } from '../../components/AcaoRegistro';
import CompartilharPdfBotoes from '../../components/CompartilharPdfBotoes';
import JanelaLista from '../../components/JanelaLista';
import JustificativaCancelamento from '../../components/JustificativaCancelamento';
import { formatDataHora } from '../../utils/dateUtils';
import { carregarComoDataUri } from '../../utils/printUrl';
import {
  gerarHtmlDocumento, imprimirDocumento, nomeArquivoDocumento,
} from '../../utils/DocumentoPrint';
import type { ImagensDocumento } from '../../utils/DocumentoPrint';
import BlocoView from './BlocoView';
import CabecalhoFolha from './CabecalhoFolha';
import { prepararFolha } from './cabecalho';
import { semBlocosVazios } from './vazios';
import type { PreenchimentoListas } from './listas';
import type { DocumentoEmitido } from './types';

/**
 * Converte as imagens do timbre (logo e assinatura) em `data:` URI.
 *
 * 🔴 NÃO é otimização — é o que faz o PDF do WhatsApp/e-mail sair com logo. O gerador
 * do backend (Puppeteer) BLOQUEIA toda requisição que não seja `data:`, então uma
 * `<img src="/api/midia/...">` imprime bem no navegador (tem sessão) e nasce QUEBRADA
 * no PDF do servidor. Ver `utils/printUrl.ts#carregarComoDataUri`.
 *
 * ⚠️ Resolve de uma vez as URLs DISTINTAS da lista inteira: cada documento guarda o
 * timbre do seu dia, mas na prática quase todos repetem a mesma logo — uma busca por
 * documento pagaria a mesma ida e volta dezenas de vezes.
 */
export function useImagensDocumento(docs: DocumentoEmitido[]): ImagensDocumento {
  const [imagens, setImagens] = useState<ImagensDocumento>({});

  const urls = useMemo(() => {
    const set = new Set<string>();
    for (const d of docs) {
      if (d.marca?.logoUrl)       set.add(d.marca.logoUrl);
      if (d.marca?.assinaturaUrl) set.add(d.marca.assinaturaUrl);
    }
    return [...set].sort();
  }, [docs]);

  // A chave da dependência é a LISTA de URLs, não o array de documentos: recarregar a
  // lista cria objetos novos a cada busca e o efeito rodaria sem nada ter mudado.
  const chave = urls.join('|');

  useEffect(() => {
    if (!urls.length) return;
    let vivo = true;
    void (async () => {
      const pares = await Promise.all(urls.map(async u => [u, await carregarComoDataUri(u)] as const));
      if (!vivo) return;
      setImagens(prev => {
        const novo = { ...prev };
        for (const [u, dataUri] of pares) if (dataUri) novo[u] = dataUri;
        return novo;
      });
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  return imagens;
}

// ─── Visualização ────────────────────────────────────────────────────────────

/**
 * A folha como ela foi entregue, em A4.
 *
 * Usa o MESMO `BlocoView` do editor e da tela de emissão — o vet confere na tela
 * exatamente o desenho que sai no papel.
 *
 * O que a folha do EMITIDO recebe é o SNAPSHOT (`doc.contexto`), nunca o cadastro de
 * hoje — ver `ctxFolha` abaixo. O que NÃO pode acontecer é ela receber contexto
 * NENHUM: aí o resolvedor cai no modo EXEMPLO do catálogo e o documento real passa a
 * exibir "Thor"/"Haras Boa Vista".
 */
/**
 * Níveis da lupa da visualização. 0,62 é o do preview de sempre (a folha A4 inteira
 * cabendo na largura do modal) e é onde ele abre — a lupa amplia a partir do que a
 * pessoa já conhece, em vez de trocar a primeira impressão da tela.
 *
 * Passos DISCRETOS, não um `+0,15` livre: assim "100%" existe de verdade na escala
 * (é o tamanho real do papel, o que se quer conferir antes de imprimir) e cada clique
 * dá um salto perceptível — de 5% em 5% a pessoa clica dez vezes e desiste.
 */
const ZOOMS = [0.4, 0.5, 0.62, 0.8, 1, 1.25, 1.5, 2] as const;
const ZOOM_PADRAO = 0.62;

/** 210mm (a largura de uma A4) em px a 96dpi — a caixa da folha é fixa nessa medida. */
const LARGURA_FOLHA_PX = 794;

export function VisualizarDocumentoModal({
  doc, onFechar, imagens, contexto, preenchimento, listas, titulo,
}: {
  doc:      DocumentoEmitido;
  onFechar: () => void;
  imagens?: ImagensDocumento;
  /**
   * SÓ para a PRÉ-VISUALIZAÇÃO antes de emitir, onde os blocos ainda são os do MODELO
   * (com `{{...}}` e `[[...]]` crus) e precisam ser resolvidos na tela. No documento
   * já emitido fica ausente: os blocos dele já estão resolvidos, e aplicar o contexto
   * de HOJE reabriria a porta para o papel antigo mudar sozinho. Ausente aqui NÃO
   * significa "sem contexto" na folha — ver `ctxFolha`, que cai no snapshot.
   */
  contexto?:      Record<string, string> | null;
  preenchimento?: Record<string, string> | null;
  /**
   * Linhas dos grupos repetíveis — SÓ na pré-visualização, pela mesma razão do
   * `contexto`: no documento emitido a lista já virou uma `tabela` com as linhas
   * daquele dia (ver `lib/documentoListas.js#aplicarListasEmBlocos`), e reaplicar as
   * de hoje reabriria a porta para o papel antigo mudar sozinho.
   */
  listas?:        PreenchimentoListas | null;
  /** Sobrescreve o cabeçalho ("Pré-visualização"), que no emitido é o nº do documento. */
  titulo?:        string;
}) {
  const [zoom, setZoom] = useState<number>(ZOOM_PADRAO);
  const areaRef = useRef<HTMLDivElement>(null);

  /**
   * MOBILE E TABLET: a folha abre no maior zoom que CABE na largura da tela.
   *
   * Os 62% do padrão são medida de desktop — 794px × 0,62 = 492px, mais que a largura
   * de qualquer celular. Sem isto o documento abria cortado pela metade e só a barra
   * horizontal revelava o resto, justo na tela em que arrastar é mais difícil.
   *
   * ⚠️ Roda UMA VEZ, na abertura: depois quem manda é a lupa. Reajustar a cada
   * mudança de tamanho tiraria da mão de quem ampliou de propósito para conferir uma
   * linha.
   */
  useEffect(() => {
    const largura = areaRef.current?.clientWidth ?? 0;
    if (!largura || largura >= LARGURA_FOLHA_PX * ZOOM_PADRAO) return;
    const cabe = [...ZOOMS].reverse().find(z => LARGURA_FOLHA_PX * z <= largura);
    setZoom(cabe ?? ZOOMS[0]);
  }, []);

  const nivel   = ZOOMS.indexOf(zoom as (typeof ZOOMS)[number]);
  const podeMais  = nivel < ZOOMS.length - 1;
  const podeMenos = nivel > 0;

  /**
   * O contexto da FOLHA INTEIRA — cabeçalho e corpo.
   *
   * No EMITIDO sai do SNAPSHOT (`doc.contexto`), nunca do cadastro de hoje:
   * reimprimir daqui a dois anos tem de devolver o proprietário e o paciente COMO
   * ESTAVAM. Na pré-visualização vale o `contexto` que a tela passou, que ainda não
   * virou snapshot.
   *
   * ⚠️ `?? {}` e NUNCA `?? null`/`undefined`: sem contexto, `resolverVariaveis` cai no
   * modo EXEMPLO do catálogo e o papel REAL sai com "Thor" e "Haras Boa Vista". O
   * cabeçalho já tinha essa proteção; o CORPO recebia `undefined` e por isso mentia
   * (defeito relatado em 2026-09-03). Objeto vazio mantém o modo real — o que não
   * existe sai vazio, que é o correto.
   */
  const ctxFolha = contexto ?? doc.contexto ?? {};

  const { cabecalho, corpo: corpoBruto } = prepararFolha({
    blocos:   doc.blocos,
    nome:     doc.titulo || doc.templateNome,
    contexto: ctxFolha,
    marca:    doc.marca,
  });

  /**
   * CAMPO EM BRANCO NÃO APARECE — regra de todo documento (a pedido, 2026-09-03): nem
   * aqui, nem na impressão, nem no PDF do WhatsApp/e-mail.
   *
   * Vale também para a PRÉ-VISUALIZAÇÃO, que existe justamente para mostrar o papel
   * como ele vai sair — e onde o traço em branco não leva a lugar nenhum, porque ali
   * não há formulário ao lado (esse é o `ModalPreencher` do editor, que não passa por
   * aqui). Por isso a avaliação recebe `contexto`/`preenchimento`/`listas`: no modelo
   * o valor ainda mora em `{{variável}}`, e filtrar por `texto` cru apagaria os
   * campos preenchidos junto com os vazios.
   *
   * ⚠️ Filtra o que se DESENHA, nunca o snapshot: o documento entregue é imutável.
   */
  const corpo = semBlocosVazios(corpoBruto, {
    contexto: ctxFolha, preenchimento, listas,
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-0 sm:p-6">
      <div className="bg-white w-full h-full sm:h-[92vh] sm:max-w-4xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <header className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-gray-100 flex-shrink-0">
          <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
            <FileText size={17} className="text-emerald-700" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-bold text-gray-900 text-sm sm:text-base truncate">
              {doc.titulo || doc.templateNome}
            </h2>
            <p className="text-[11px] sm:text-xs text-gray-500 truncate">
              {titulo ?? (
                `${doc.numeroFmt ? `${doc.numeroFmt} · ` : ''}${doc.animalNome}`
                + `${doc.emitidoEm ? ` · ${formatDataHora(doc.emitidoEm)}` : ''}`
              )}
            </p>
          </div>
          {/* LUPA — cromo da tela, não ação do registro: segue a paleta cinza do X
              (§6), e não o `AcaoRegistro`, que existe para o que se FAZ com o
              documento. O rótulo do meio mostra o zoom atual e, clicado, volta ao
              padrão: sem ele, quem ampliou até 200% teria de clicar quatro vezes
              para reenquadrar a folha. */}
          <div className="flex items-center flex-shrink-0 rounded-lg border border-gray-200 bg-gray-50">
            <button
              onClick={() => podeMenos && setZoom(ZOOMS[nivel - 1])}
              disabled={!podeMenos}
              className="p-1.5 text-gray-500 hover:text-gray-800 disabled:opacity-30 disabled:hover:text-gray-500"
              title="Diminuir o zoom" aria-label="Diminuir o zoom"
            >
              <ZoomOut size={16} />
            </button>
            <button
              onClick={() => setZoom(ZOOM_PADRAO)}
              className="px-1 text-[11px] font-semibold text-gray-600 hover:text-gray-900 tabular-nums w-11"
              title="Voltar ao tamanho padrão" aria-label="Voltar ao tamanho padrão"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              onClick={() => podeMais && setZoom(ZOOMS[nivel + 1])}
              disabled={!podeMais}
              className="p-1.5 text-gray-500 hover:text-gray-800 disabled:opacity-30 disabled:hover:text-gray-500"
              title="Aumentar o zoom" aria-label="Aumentar o zoom"
            >
              <ZoomIn size={16} />
            </button>
          </div>
          {/* Na pré-visualização não há o que imprimir: o documento ainda não existe,
              não tem número e imprimi-lo produziria uma via sem rastro no sistema. */}
          <AcaoRegistro tom="imprimir" icone={Printer} rotulo="Imprimir"
            visivel={!contexto}
            onClick={() => imprimirDocumento(doc, imagens)} />
          {/* O X é CROMO, não ação do registro — segue cinza (§6). */}
          <button onClick={onFechar} className="p-1.5 text-gray-400 hover:text-gray-600 flex-shrink-0" aria-label="Fechar">
            <X size={18} />
          </button>
        </header>

        {!doc.ativo && (
          <div className="px-4 sm:px-5 py-2 bg-red-50 border-b border-red-100 flex-shrink-0">
            <p className="text-xs text-red-700">
              <strong>Documento cancelado.</strong>{' '}
              {doc.canceladoMotivo ? doc.canceladoMotivo : 'Sem justificativa registrada.'}
            </p>
          </div>
        )}

        {/* ⚠️ Centralizar com `margin: auto` no filho, NUNCA com `justify-center` no
            contêiner: em caixa que ROLA, `justify-content: center` corta o começo do
            conteúdo — ampliada além da largura do modal, a folha ficaria com a margem
            ESQUERDA inalcançável, por mais que se arrastasse a barra. Com margem
            automática o excedente vira scroll dos dois lados. */}
        <div ref={areaRef} className="flex-1 bg-gray-100 overflow-auto flex py-4 sm:py-5 px-2 sm:px-0">
          <div
            className="shadow-lg rounded-sm flex-shrink-0"
            style={{
              width: '210mm', minHeight: '297mm', padding: '18mm 16mm',
              background: '#fff', color: '#111827',
              fontFamily: 'Inter, system-ui, sans-serif',
              margin: '0 auto',
              transform: `scale(${zoom})`, transformOrigin: 'top center',
              // `transform` NÃO muda a caixa do layout: a folha continua ocupando
              // 297mm de altura mesmo desenhada a 62%, e sobraria um vão enorme
              // embaixo. A margem devolve exatamente a diferença — negativa quando
              // reduz, POSITIVA quando amplia (aí a folha desenhada passa da caixa e
              // o fim dela ficaria fora do scroll).
              marginBottom: `${(297 * (zoom - 1)).toFixed(1)}mm`,
            }}
          >
            <CabecalhoFolha dados={cabecalho} />
            {corpo.map(b => (
              <BlocoView key={b.id} bloco={b} marca={doc.marca}
                contexto={ctxFolha} preenchimento={preenchimento ?? undefined}
                listas={listas ?? undefined} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Lista ───────────────────────────────────────────────────────────────────

/** Ações de UM documento — declaradas uma vez e usadas na tabela E no card (§6). */
export function AcoesDocumento({ doc, imagens, onVisualizar, onCancelar, podeCancelar }: {
  doc:          DocumentoEmitido;
  imagens?:     ImagensDocumento;
  onVisualizar: (d: DocumentoEmitido) => void;
  onCancelar?:  (d: DocumentoEmitido) => void;
  podeCancelar?: boolean;
}) {
  // Destino do envio: o contato do CLIENTE gravado no snapshot, não o cadastro de
  // hoje — é para quem o documento foi emitido.
  const telefone = doc.contexto?.['cliente.telefone'] ?? null;
  const email    = doc.contexto?.['cliente.email'] ?? null;

  const opcoesPdf = {
    gerarHtml:   () => gerarHtmlDocumento(doc, imagens),
    nomeArquivo: nomeArquivoDocumento(doc),
    documento:   doc.titulo?.trim() || doc.templateNome?.trim() || 'Documento',
    titulo:      doc.titulo || doc.templateNome,
    texto:       `${doc.titulo || doc.templateNome}${doc.numeroFmt ? ` (${doc.numeroFmt})` : ''} — ${doc.animalNome}`,
  };

  /**
   * 🔴 DOCUMENTO CANCELADO NÃO SE IMPRIME NEM SE ENVIA.
   *
   * Passou a importar em 2026-09-03, quando os cancelados voltaram a aparecer no
   * histórico: reimprimir um documento cancelado põe em circulação um papel que a
   * clínica revogou, e nada nele diria isso. VISUALIZAR continua — é assim que se
   * confere o que foi cancelado e a justificativa.
   * ⚠️ Ação indisponível NÃO vira botão cinza: ela não é renderizada (§6).
   */
  const valido = doc.ativo;

  // ORDEM CANÔNICA da §6: Visualizar → Imprimir → WhatsApp → E-mail → Cancelar.
  return (
    <AcoesRegistro>
      <AcaoRegistro tom="ver" icone={Eye} rotulo="Visualizar"
        onClick={() => onVisualizar(doc)} />
      <AcaoRegistro tom="imprimir" icone={Printer} rotulo="Imprimir" visivel={valido}
        onClick={() => imprimirDocumento(doc, imagens)} />
      {valido && <CompartilharPdfBotoes {...opcoesPdf} telefone={telefone} emailPara={email} />}
      <AcaoRegistro tom="cancelar" icone={Ban} rotulo="Cancelar" titulo="Cancelar documento"
        visivel={Boolean(podeCancelar && onCancelar && valido)}
        onClick={() => onCancelar?.(doc)} />
    </AcoesRegistro>
  );
}

/**
 * Histórico de documentos emitidos — cards no mobile, tabela no desktop (§6).
 *
 * `compacto` é o modo do CARD da tela do paciente: uma coluna estreita, sem tabela.
 * É uma prop porque a alternativa seria uma segunda lista — ver o cabeçalho.
 */
export default function ListaDocumentosEmitidos({
  documentos, carregando, compacto = false, podeCancelar = false, onCancelar, vazio,
}: {
  documentos:   DocumentoEmitido[];
  carregando?:  boolean;
  compacto?:    boolean;
  podeCancelar?: boolean;
  onCancelar?:  (d: DocumentoEmitido) => void;
  /** Texto do estado vazio — cada tela diz a sua. */
  vazio?:       string;
}) {
  const imagens = useImagensDocumento(documentos);
  const [vendo, setVendo] = useState<DocumentoEmitido | null>(null);
  const visualizar = useCallback((d: DocumentoEmitido) => setVendo(d), []);

  /**
   * FILTRO POR STATUS — só com os status que EXISTEM na lista (a pedido).
   *
   * Uma aba "Cancelados (0)" num histórico sem cancelamento nenhum é ruído: promete
   * uma gaveta vazia e faz a pessoa clicar para descobrir isso. É a mesma regra das
   * abas de status da Prescrição e da Vacina.
   *
   * ⚠️ O filtro é da TELA, não do servidor: a lista já vem inteira (`GET
   * /documentos/emitidos` devolve emitidos e cancelados desde 2026-09-03), e assim a
   * contagem de cada aba é exata sem uma ida a mais ao backend por clique.
   */
  const [status, setStatus] = useState<'TODOS' | 'EMITIDO' | 'CANCELADO'>('TODOS');
  const nEmitidos   = documentos.filter(d => d.ativo).length;
  const nCancelados = documentos.length - nEmitidos;
  const abas = ([
    { id: 'TODOS'     as const, rotulo: 'Todos',      n: documentos.length },
    { id: 'EMITIDO'   as const, rotulo: 'Emitidos',   n: nEmitidos },
    { id: 'CANCELADO' as const, rotulo: 'Cancelados', n: nCancelados },
  ]).filter(a => a.n > 0);
  // Uma aba só (ou nenhuma) não é filtro: some com a barra em vez de exibir um
  // controle que não muda nada.
  const mostrarFiltro = !compacto && abas.length > 1;
  const lista = status === 'TODOS'
    ? documentos
    : documentos.filter(d => (status === 'EMITIDO' ? d.ativo : !d.ativo));

  const filtro = mostrarFiltro && (
    <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-gray-100">
      {abas.map(a => (
        <button
          key={a.id}
          type="button"
          onClick={() => setStatus(a.id)}
          className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
            status === a.id
              ? 'bg-emerald-50 text-emerald-700'
              : 'text-gray-500 hover:bg-gray-50'
          }`}
        >
          {a.rotulo} ({a.n})
        </button>
      ))}
    </div>
  );

  if (carregando) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin text-emerald-600" />
      </div>
    );
  }

  if (documentos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-gray-300">
        <FileText size={compacto ? 26 : 34} className="mb-2" />
        <p className="text-sm text-gray-400 text-center px-4">{vazio ?? 'Nenhum documento emitido'}</p>
      </div>
    );
  }

  const modal = vendo && (
    <VisualizarDocumentoModal doc={vendo} imagens={imagens} onFechar={() => setVendo(null)} />
  );

  // ── Card estreito (tela do paciente) ──
  if (compacto) {
    return (
      <>
        <div className="space-y-2">
          {documentos.map(d => (
            <div key={d.id} className={`rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2.5 ${d.ativo ? '' : 'opacity-60'}`}>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono font-bold text-emerald-700 flex-shrink-0">
                  {d.numeroFmt ?? '—'}
                </span>
                {!d.ativo && (
                  <span className="text-[9px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">
                    Cancelado
                  </span>
                )}
              </div>
              <p className="text-sm font-semibold text-gray-900 line-clamp-2 mt-0.5">
                {d.titulo || d.templateNome}
              </p>
              <p className="text-[11px] text-gray-500 mt-0.5">
                {formatDataHora(d.emitidoEm)}{d.emitidoPor ? ` · ${d.emitidoPor}` : ''}
              </p>
              <div className="mt-2 pt-2 border-t border-gray-100">
                <AcoesDocumento doc={d} imagens={imagens} onVisualizar={visualizar}
                  onCancelar={onCancelar} podeCancelar={podeCancelar} />
              </div>
            </div>
          ))}
        </div>
        {modal}
      </>
    );
  }

  // ── Histórico completo ──
  return (
    <>
      {filtro}
      {lista.length === 0 && (
        <p className="px-4 py-8 text-center text-sm text-gray-400">
          Nenhum documento {status === 'CANCELADO' ? 'cancelado' : 'emitido'} nesta lista.
        </p>
      )}
      {/* Mobile */}
      <JanelaLista className="md:hidden divide-y divide-gray-50">
        {lista.map(d => (
          <div key={d.id} data-item-lista className={`px-4 py-3 ${d.ativo ? '' : 'opacity-60'}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-mono font-bold text-emerald-700">{d.numeroFmt ?? '—'}</span>
              {!d.ativo && (
                <span className="text-[10px] font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">Cancelado</span>
              )}
            </div>
            <p className="text-sm font-semibold text-gray-900 mt-1">{d.titulo || d.templateNome}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {d.animalNome}{d.clienteNome ? ` · ${d.clienteNome}` : ''}
            </p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {formatDataHora(d.emitidoEm)}{d.emitidoPor ? ` · ${d.emitidoPor}` : ''}
            </p>
            {!d.ativo && d.canceladoMotivo && (
              <p className="text-[11px] text-gray-400 mt-0.5">
                Justificativa:{' '}
                <JustificativaCancelamento texto={d.canceladoMotivo} className="inline-block align-bottom max-w-[70vw]" />
              </p>
            )}
            <div className="mt-2">
              <AcoesDocumento doc={d} imagens={imagens} onVisualizar={visualizar}
                onCancelar={onCancelar} podeCancelar={podeCancelar} />
            </div>
          </div>
        ))}
      </JanelaLista>

      {/* Desktop */}
      <JanelaLista className="hidden md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              {['Nº', 'Documento', 'Paciente', 'Emissão', 'Responsável', 'Justificativa', 'Ações'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {lista.map(d => (
              <tr key={d.id} className={`hover:bg-gray-50 transition-colors ${d.ativo ? '' : 'opacity-60'}`}>
                <td className="px-4 py-3 whitespace-nowrap">
                  <button onClick={() => visualizar(d)}
                    className="font-mono font-bold text-emerald-700 hover:text-emerald-800 transition-colors">
                    {d.numeroFmt ?? '—'}
                  </button>
                </td>
                <td className="px-4 py-3 text-gray-800 max-w-xs">
                  <p className="text-xs font-medium text-gray-800 line-clamp-2">{d.titulo || d.templateNome}</p>
                  {!d.ativo && (
                    <span className="inline-block mt-0.5 text-[10px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">
                      Cancelado
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <p className="text-xs font-medium text-gray-800">{d.animalNome}</p>
                  {d.clienteNome && <p className="text-[10px] text-gray-400">{d.clienteNome}</p>}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{formatDataHora(d.emitidoEm)}</td>
                <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{d.emitidoPor || '—'}</td>
                <td className="px-4 py-3">
                  {d.ativo
                    ? <span className="text-gray-300">—</span>
                    : <JustificativaCancelamento texto={d.canceladoMotivo} />}
                </td>
                <td className="px-4 py-3">
                  <AcoesDocumento doc={d} imagens={imagens} onVisualizar={visualizar}
                    onCancelar={onCancelar} podeCancelar={podeCancelar} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </JanelaLista>

      {modal}
    </>
  );
}
