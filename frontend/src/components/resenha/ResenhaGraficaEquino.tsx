// src/components/resenha/ResenhaGraficaEquino.tsx

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { FOCOS_VISTA, TIPOS_MARCACAO } from '../../types/resenhaGrafica';
import type {
  TipoMarcacaoResenha,
  TracoResenha,
  VistaResenha,
  VistaSelecionavel,
} from '../../types/resenhaGrafica';
import { buscarResenhaPorVista, salvarResenhaPorVista } from '../../services/ResenhaGraficaApi';
import { ResenhaStage } from './ResenhaStage';
import { ResenhaToolbar } from './ResenhaToolbar';
import { ResenhaImpressao } from './ResenhaImpressao';
import type { useResenhaCanvas, FerramentaDesenho } from './useResenhaCanvas';

interface ResenhaGraficaEquinoProps {
  animalId: number;
  somenteLeitura?: boolean;
}

const VISTAS_REAIS: VistaResenha[] = [
  'LATERAL',
  'CABECA_FRONTAL',
  'FOCINHO',
  'PESCOCO_INFERIOR',
  'MEMBROS_ANTERIORES',
  'MEMBROS_POSTERIORES',
];

/**
 * Módulo de resenha gráfica equina — ficha de identificação visual
 * (equivalente ao documento oficial de identificação do animal).
 *
 * Arquitetura (revisada após dois rounds de bug de viewBox/vazamento):
 * - O documento SVG fiel é SEMPRE renderizado completo, nunca recortado.
 * - Cada vista real (as 6 persistidas no banco) aplica pan/zoom + clip-path
 *   via CSS, calibrado para nunca vazar partes de vistas vizinhas.
 * - A aba "Todos" mostra o documento completo com os traços de TODAS as
 *   vistas agregados — é somente-leitura: desenhar precisa acontecer numa
 *   vista específica, porque é isso que ancora a detecção de região.
 * - Na impressão, o documento sai sempre completo, com todos os traços de
 *   todas as vistas sobrepostos, exatamente como o documento oficial.
 */
export function ResenhaGraficaEquino({ animalId, somenteLeitura = false }: ResenhaGraficaEquinoProps) {
  const [vistaAtiva, setVistaAtiva] = useState<VistaSelecionavel>('LATERAL');
  const [tipoMarcacaoAtivo, setTipoMarcacaoAtivo] = useState<TipoMarcacaoResenha>('PELO_BRANCO');
  const [ferramenta, setFerramenta] = useState<FerramentaDesenho>('caneta');
  const [controladorAtivo, setControladorAtivo] = useState<ReturnType<typeof useResenhaCanvas> | null>(
    null,
  );
  const [modoImpressao, setModoImpressao] = useState(false);

  const ehVistaTodos = vistaAtiva === 'TODOS';

  const focoAtivo = useMemo(() => FOCOS_VISTA.find((f) => f.vista === vistaAtiva)!, [vistaAtiva]);

  const queryClient = useQueryClient();

  // Para vistas reais: busca só a vista ativa.
  const { data, isLoading } = useQuery({
    queryKey: ['resenha-grafica', animalId, vistaAtiva],
    queryFn: () => buscarResenhaPorVista(animalId, vistaAtiva as VistaResenha),
    enabled: !ehVistaTodos,
  });

  // Para a aba "Todos" e para a impressão: busca as 6 vistas reais em
  // paralelo e agrega. Volume pequeno e fixo (6 vistas), não justifica
  // um endpoint agregador dedicado no backend.
  const queryTodasVistas = useQuery({
    queryKey: ['resenha-grafica-completa', animalId],
    queryFn: async () => {
      const resultados = await Promise.all(
        VISTAS_REAIS.map((vista) => buscarResenhaPorVista(animalId, vista)),
      );
      return VISTAS_REAIS.map((vista, indice) => ({
        vista,
        tracos: resultados[indice].resenha?.vetorTracos ?? [],
      }));
    },
    enabled: ehVistaTodos || modoImpressao,
  });

  const regioesDaVista = data?.regioesDisponiveis ?? [];

  const mutationSalvar = useMutation({
    mutationFn: async () => {
      if (!controladorAtivo || ehVistaTodos) return;
      const vetorTracos = controladorAtivo.tracos.map(({ pontos, cor, tipo }) => ({
        pontos,
        cor,
        tipo,
      }));
      const snapshotPng = controladorAtivo.canvasRef.current?.toDataURL('image/png') ?? null;
      await salvarResenhaPorVista(animalId, vistaAtiva as VistaResenha, vetorTracos, snapshotPng);
    },
    onSuccess: () => {
      toast.success('Resenha gráfica salva com sucesso.');
      queryClient.invalidateQueries({ queryKey: ['resenha-grafica', animalId, vistaAtiva] });
      queryClient.invalidateQueries({ queryKey: ['resenha-grafica-completa', animalId] });
    },
    onError: () => {
      toast.error('Não foi possível salvar a resenha gráfica. Tente novamente.');
    },
  });

  if (modoImpressao) {
    return (
      <ResenhaImpressao
        carregando={queryTodasVistas.isLoading}
        vistasComTracos={queryTodasVistas.data ?? []}
        onVoltar={() => setModoImpressao(false)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {FOCOS_VISTA.map((foco) => (
            <button
              key={foco.vista}
              type="button"
              onClick={() => setVistaAtiva(foco.vista)}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm border transition-colors ${
                vistaAtiva === foco.vista
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {foco.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setModoImpressao(true)}
          className="whitespace-nowrap rounded-full px-3 py-1.5 text-sm border border-slate-200 text-slate-600 hover:bg-slate-50"
        >
          Imprimir
        </button>
      </div>

      {ehVistaTodos && (
        <p className="text-xs text-slate-400 -mt-2">
          Visão geral somente leitura — selecione uma vista específica para desenhar.
        </p>
      )}

      {!somenteLeitura && !ehVistaTodos && (
        <ResenhaToolbar
          tipoMarcacaoAtivo={tipoMarcacaoAtivo}
          onTipoMarcacaoChange={setTipoMarcacaoAtivo}
          ferramenta={ferramenta}
          onFerramentaChange={(f) => {
            setFerramenta(f);
            controladorAtivo?.setFerramenta(f);
          }}
          onDesfazer={() => controladorAtivo?.desfazerUltimoTraco()}
          onLimpar={() => controladorAtivo?.limparTudo()}
          desabilitado={isLoading}
        />
      )}

      {ehVistaTodos ? (
        queryTodasVistas.isLoading ? (
          <div className="h-64 flex items-center justify-center text-slate-400 text-sm">
            Carregando visão geral…
          </div>
        ) : (
          <ResenhaTodosPreview vistasComTracos={queryTodasVistas.data ?? []} />
        )
      ) : isLoading ? (
        <div className="h-64 flex items-center justify-center text-slate-400 text-sm">
          Carregando resenha gráfica…
        </div>
      ) : (
        <ResenhaStage
          key={vistaAtiva}
          foco={focoAtivo}
          regioesDaVista={regioesDaVista}
          tipoMarcacaoAtivo={tipoMarcacaoAtivo}
          somenteLeitura={somenteLeitura}
          onCanvasReady={setControladorAtivo}
        />
      )}

      {!somenteLeitura && !ehVistaTodos && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => mutationSalvar.mutate()}
            disabled={mutationSalvar.isPending || isLoading}
            className="rounded-full bg-emerald-600 text-white px-5 py-2 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {mutationSalvar.isPending ? 'Salvando…' : 'Salvar resenha desta vista'}
          </button>
        </div>
      )}

      {!ehVistaTodos && controladorAtivo && controladorAtivo.tracos.length > 0 && (
        <div className="rounded-2xl border border-slate-200 p-3 text-sm">
          <p className="text-slate-500 mb-2">
            Marcações nesta vista: {controladorAtivo.tracos.length}
          </p>
          <ul className="space-y-1">
            {controladorAtivo.tracos.map((traco, indice) => {
              const tipoInfo = TIPOS_MARCACAO.find((t) => t.tipo === traco.tipo);
              const labelsRegioes = (traco as TracoResenha & { regioesDetectadas: string[] }).regioesDetectadas
                .map((codigo) => regioesDaVista.find((r) => r.codigo === codigo)?.labelPt ?? codigo)
                .join(', ');
              return (
                <li key={indice} className="flex items-center gap-2 text-slate-600">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: traco.cor }}
                  />
                  <span className="font-medium">{tipoInfo?.label}</span>
                  <span className="text-slate-400">
                    {labelsRegioes || 'fora das regiões mapeadas'}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Preview somente-leitura do documento completo com todos os traços de
 * todas as vistas, usado na aba "Todos". Reaproveita a mesma renderização
 * do componente de impressão, mas sem a barra de ações de impressão.
 */
function ResenhaTodosPreview({
  vistasComTracos,
}: {
  vistasComTracos: { vista: VistaResenha; tracos: TracoResenha[] }[];
}) {
  return (
    <ResenhaImpressao
      carregando={false}
      vistasComTracos={vistasComTracos}
      onVoltar={() => {}}
      ocultarBarraAcoes
    />
  );
}
