// src/components/SeletorContexto.tsx
// Seletor de contexto ativo (empresa/equipe) do header — troca a empresa CNPJ ou a
// equipe da empresa pessoal em que o usuário está trabalhando agora. Antes era um
// <select> simples no topo da Sidebar; virou um popover com busca porque quem tem
// muitos vínculos (profissional multi-clínica) precisa achar a empresa certa sem
// rolar uma lista longa.
// Só aparece com mais de uma opção — sem para quê trocar, não há o que mostrar.
//
// Modo `embedded` (2026-08-18): vive DENTRO do dropdown do usuário (AppHeader), não
// mais como botão próprio na barra do header — a lista fica sempre visível, sem o
// botão-gatilho nem o popover próprio (quem abre/fecha é o menu que o hospeda).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, ChevronDown, Check, Star } from 'lucide-react';
import { useEmpresa, type ContextoOpcao } from '../contexts/EmpresaContext';
import { chaveContexto, getUltimosAcessos, getFavoritos, alternarFavorito, formatarUltimoAcesso } from '../utils/contextoAcessos';

const CORES_AVATAR = [
  'bg-emerald-100 text-emerald-700',
  'bg-blue-100 text-blue-700',
  'bg-purple-100 text-purple-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-teal-100 text-teal-700',
  'bg-indigo-100 text-indigo-700',
  'bg-orange-100 text-orange-700',
];

/** Cor determinística por chave (empresaId:equipeId) — mesma empresa sempre com a mesma cor. */
function corAvatar(chave: string): string {
  let hash = 0;
  for (let i = 0; i < chave.length; i++) hash = (hash * 31 + chave.charCodeAt(i)) >>> 0;
  return CORES_AVATAR[hash % CORES_AVATAR.length];
}

function iniciaisDe(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

/** O `label` já vem como "Nome · Cargo" — `nome` é a forma estruturada (options
 *  novas do backend); fallback para o pedaço antes do " · " nas opções legadas. */
function nomeDe(o: ContextoOpcao): string {
  return o.nome ?? o.label.split(' · ')[0] ?? o.label;
}

function cargoLabelDe(o: ContextoOpcao): string {
  const partes = o.label.split(' · ');
  return partes.length > 1 ? partes[partes.length - 1] : (o.cargo ?? '');
}

interface SeletorContextoProps {
  /** true = renderizado dentro de outro menu já aberto (dropdown do usuário):
   *  sem botão-gatilho, sem popover próprio — busca + lista ficam sempre visíveis. */
  embedded?: boolean;
  /** embedded only: chamado ao trocar de contexto, para o menu hospedeiro se fechar junto. */
  onTrocar?: () => void;
}

export default function SeletorContexto({ embedded = false, onTrocar }: SeletorContextoProps = {}) {
  const { opcoes, contextoAtivo, trocarContexto } = useEmpresa();
  const [aberto, setAberto]         = useState(false);
  const [favoritos, setFavoritos]   = useState<Set<string>>(() => getFavoritos());
  const [acessos, setAcessos]       = useState<Record<string, string>>({});

  const containerRef = useRef<HTMLDivElement>(null);

  const visivel = embedded || aberto;

  useEffect(() => {
    if (embedded || !aberto) return;
    const aoClicar = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener('mousedown', aoClicar);
    return () => document.removeEventListener('mousedown', aoClicar);
  }, [embedded, aberto]);

  useEffect(() => {
    if (!visivel) return;
    // Lido de novo a cada abertura (não só no mount) — no primeiro carregamento da
    // página o registro do acesso ATIVO acontece de forma assíncrona no EmpresaContext,
    // então uma leitura só no mount deste componente poderia vir antes dele existir.
    setAcessos(getUltimosAcessos());
  }, [visivel]);

  const listaOrdenada = useMemo(() => {
    return [...opcoes].sort((a, b) => {
      const ta = acessos[chaveContexto(a)] ?? '';
      const tb = acessos[chaveContexto(b)] ?? '';
      return tb.localeCompare(ta); // mais recente primeiro
    });
  }, [opcoes, acessos]);

  if (opcoes.length <= 1 || !contextoAtivo) return null;

  const subtituloAtivo = [cargoLabelDe(contextoAtivo), contextoAtivo.cidade, contextoAtivo.estado]
    .filter(Boolean).join(' · ');

  const escolher = (o: ContextoOpcao) => {
    if (!embedded) setAberto(false);
    trocarContexto(o);
    onTrocar?.();
  };

  const listaConteudo = (
    <>
      <div className={embedded ? 'max-h-64 overflow-y-auto py-1' : 'overflow-y-auto py-1'}>
        {listaOrdenada.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500 text-center">Nada encontrado.</p>
        ) : (
          listaOrdenada.map((o) => {
            const k       = chaveContexto(o);
            const ativa   = o.empresaId === contextoAtivo.empresaId && o.equipeId === contextoAtivo.equipeId;
            const favorita = favoritos.has(k);
            return (
              <div key={k} className={`flex items-center gap-2 px-2 py-1 ${ativa ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}>
                <button
                  type="button"
                  onClick={() => escolher(o)}
                  className="flex items-center gap-3 flex-1 min-w-0 text-left px-1 py-1.5"
                >
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold text-gray-900 truncate">{nomeDe(o)}</span>
                      {ativa && <Check size={14} className="text-emerald-600 flex-shrink-0" />}
                    </span>
                    <span className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full flex-shrink-0">
                        {cargoLabelDe(o)}
                      </span>
                      <span className="text-[11px] text-gray-400 truncate">
                        {ativa ? 'Agora há pouco' : formatarUltimoAcesso(acessos[k])}
                      </span>
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setFavoritos(alternarFavorito(o))}
                  aria-label={favorita ? 'Remover dos favoritos' : 'Marcar como favorita'}
                  title={favorita ? 'Remover dos favoritos' : 'Marcar como favorita'}
                  className="p-1.5 rounded-lg text-gray-300 hover:text-amber-500 hover:bg-amber-50 flex-shrink-0"
                >
                  <Star size={16} className={favorita ? 'fill-amber-400 text-amber-400' : ''} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </>
  );

  if (embedded) {
    // Sem botão-gatilho nem popover: o menu hospedeiro (dropdown do usuário) já
    // controla abrir/fechar. Um rótulo de seção substitui o botão para dar contexto.
    return (
      <div role="group" aria-label="Trocar empresa ou equipe">
        <p className="px-4 pt-1 pb-2 text-[11px] font-bold text-gray-400 uppercase tracking-wide">
          Trocar empresa/equipe
        </p>
        {listaConteudo}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={aberto}
        className="flex items-center gap-2 pl-1.5 pr-2.5 py-1.5 rounded-2xl border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
      >
        <span className="hidden lg:flex w-7 h-7 rounded-xl bg-emerald-50 text-emerald-600 items-center justify-center flex-shrink-0">
          <Building2 size={15} />
        </span>
        <span className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs flex-shrink-0 ${corAvatar(chaveContexto(contextoAtivo))}`}>
          {iniciaisDe(nomeDe(contextoAtivo))}
        </span>
        <span className="hidden md:block text-left leading-tight max-w-[10rem]">
          <span className="block text-sm font-semibold text-gray-900 truncate">{nomeDe(contextoAtivo)}</span>
          {subtituloAtivo && <span className="block text-[11px] text-gray-500 truncate">{subtituloAtivo}</span>}
        </span>
        <ChevronDown size={16} className={`hidden md:block text-gray-400 transition-transform flex-shrink-0 ${aberto ? 'rotate-180' : ''}`} />
      </button>

      {aberto && (
        <div role="menu" className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] max-h-[75vh] flex flex-col bg-white border border-gray-200 rounded-2xl shadow-lg z-50 overflow-hidden">
          {listaConteudo}
        </div>
      )}
    </div>
  );
}
