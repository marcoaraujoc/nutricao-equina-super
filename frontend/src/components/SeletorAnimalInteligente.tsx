// src/components/SeletorAnimalInteligente.tsx
//
// Seletor de paciente das telas clínicas. "Inteligente" porque resolve o caso de
// XARÁS: com dois pacientes de mesmo nome, a linha mostra o PROPRIETÁRIO — sem ele a
// lista traria duas entradas idênticas e a escolha viraria adivinhação.
//
// 🔴 É um COMBOBOX, não um `<select>` (a pedido, 2026-09-05): dá para DIGITAR o nome
// do paciente. Numa clínica com centenas de pacientes, rolar um `<select>` até "Zeus"
// é o caminho longo para algo que se resolve em três letras. A busca cobre também o
// nome do PROPRIETÁRIO, que é como se desempata xará sem precisar de um segundo campo
// (era o que o antigo bloco âmbar "filtre pelo proprietário" fazia — removido, porque
// dois campos de busca para a mesma escolha é o caminho curto para a pessoa usar o
// errado).
//
// ⚠️ ARMADILHAS de combobox, todas já pagas em outras telas (CLAUDE.md, Agenda e
// Documentos):
//   · o campo exibe um RÓTULO ("Thor — Haras X"), e o filtro compara com o NOME. Se o
//     texto atual for o rótulo do já selecionado, ele NÃO conta como busca — senão
//     reabrir a lista depois de escolher mostraria "nenhum paciente encontrado" para o
//     próprio item escolhido;
//   · abre no `onClick` ALÉM do `onFocus`: a opção é escolhida em `onMouseDown` com
//     `preventDefault`, então o foco nunca sai do input, e `focus` não dispara de novo
//     num campo já focado;
//   · a busca ignora acento e caixa — "genesis" acha "Gênesis".
//
// Vivia dentro de Atendimento.tsx; foi extraído quando a tela de Vacina saiu do shell
// e passou a precisar do mesmo seletor. Duas cópias divergiriam na primeira correção.

import { useState, useEffect, useMemo, useRef } from 'react';
import { Search, ChevronDown, X } from 'lucide-react';
import FotoAnimal from './FotoAnimal';
import { rotuloOpcaoAnimal } from '../utils/animalInfo';

/** Forma MÍNIMA exigida do animal — cada tela passa o seu tipo, mais rico. */
export interface AnimalSelecionavel {
  id:        number;
  nome:      string;
  photoUrl?: string | null;
  user?:     { fullName: string } | null;
  /**
   * Paciente INATIVO — prontuário congelado, em SOMENTE LEITURA. Ele CONTINUA na
   * lista (é o ponto da regra: não some, só trava), e por isso precisa de MARCA —
   * sem ela só se descobre o estado depois de escolher, ao não achar os botões.
   * ⚠️ Nada a ver com `Animal.ativo` (exclusão lógica), que nem chega até aqui.
   * Vem de `GET /animais` (`anexarInativoEmLista`, backend/src/lib/animalInativo.js).
   */
  inativo?:  boolean | null;
}

/** Sem acento, sem caixa — é o que faz "genesis" achar "Gênesis". */
const chave = (v: string | null | undefined): string =>
  String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export default function SeletorAnimalInteligente<T extends AnimalSelecionavel>({
  animais, animalAtual, onSelecionar,
}: {
  animais:      T[];
  animalAtual:  T | null;
  onSelecionar: (a: T) => void;
}) {
  const [busca,    setBusca]    = useState('');
  const [aberto,   setAberto]   = useState(false);
  const [destaque, setDestaque] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef     = useRef<HTMLInputElement>(null);

  // Quantos pacientes dividem cada nome — decide se a linha precisa dizer de quem é.
  const nomesCount = useMemo(() => animais.reduce<Record<string, number>>((acc, a) => {
    acc[chave(a.nome)] = (acc[chave(a.nome)] ?? 0) + 1; return acc;
  }, {}), [animais]);

  const rotuloDe = (a: T) =>
    rotuloOpcaoAnimal(a, { comProprietario: (nomesCount[chave(a.nome)] ?? 0) > 1 });

  const rotuloAtual = animalAtual ? rotuloDe(animalAtual) : '';

  // Fecha ao clicar fora, devolvendo o campo ao rótulo do paciente escolhido — texto
  // meio digitado que não virou escolha só confundiria na próxima abertura.
  useEffect(() => {
    if (!aberto) return;
    const aoClicar = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) { setAberto(false); setBusca(''); }
    };
    document.addEventListener('mousedown', aoClicar);
    return () => document.removeEventListener('mousedown', aoClicar);
  }, [aberto]);

  // Some com o seletor só quando não há o que escolher: nenhum paciente, ou um único
  // paciente JÁ escolhido. Sem paciente escolhido ele PRECISA aparecer — desde
  // 2026-09-03 a tela de Vacina abre vazia (a pedido), e escondê-lo numa clínica de um
  // paciente só deixaria a tela sem nenhuma forma de escolher.
  const semEscolha = animais.length === 0 || (animais.length === 1 && !!animalAtual);

  // O texto conta como BUSCA só quando difere do rótulo do já selecionado.
  const termo = chave(busca) && chave(busca) !== chave(rotuloAtual) ? chave(busca) : '';

  const filtrados = useMemo(() => {
    if (!termo) return animais;
    return animais.filter(a =>
      chave(a.nome).includes(termo) || chave(a.user?.fullName).includes(termo));
  }, [animais, termo]);

  useEffect(() => { setDestaque(0); }, [termo, aberto]);

  if (semEscolha) return null;

  const escolher = (a: T) => {
    onSelecionar(a);
    setBusca('');
    setAberto(false);
    inputRef.current?.blur();
  };

  const aoTeclar = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { setAberto(false); setBusca(''); inputRef.current?.blur(); return; }
    if (!aberto) { if (e.key === 'ArrowDown') setAberto(true); return; }
    if (filtrados.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setDestaque(i => (i + 1) % filtrados.length); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setDestaque(i => (i - 1 + filtrados.length) % filtrados.length); }
    if (e.key === 'Enter')     { e.preventDefault(); const alvo = filtrados[destaque]; if (alvo) escolher(alvo); }
  };

  return (
    <div className="mb-4" ref={containerRef}>
      <label className="block text-xs font-medium text-gray-500 mb-1">Paciente</label>

      <div className="relative">
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          // Fora de edição o campo mostra o paciente escolhido; digitar substitui.
          value={aberto ? busca : rotuloAtual}
          onChange={e => { setBusca(e.target.value); setAberto(true); }}
          // `onClick` além de `onFocus`: a escolha é feita em `onMouseDown`, então o
          // foco nunca sai do input e `focus` não dispara de novo num campo já focado.
          onFocus={() => { setAberto(true); setBusca(rotuloAtual); inputRef.current?.select(); }}
          onClick={() => setAberto(true)}
          onKeyDown={aoTeclar}
          placeholder={animalAtual ? 'Digite para trocar de paciente…' : 'Digite ou escolha o paciente'}
          // `combobox` + `aria-expanded`: sem rótulo de `<select>`, é o que diz ao
          // leitor de tela que há uma lista e se ela está aberta.
          role="combobox"
          aria-expanded={aberto}
          aria-autocomplete="list"
          className="w-full pl-9 pr-16 py-2.5 border border-gray-200 rounded-2xl text-sm text-gray-900 bg-white shadow-sm focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 transition-colors"
        />

        {aberto && busca && (
          <button type="button" aria-label="Limpar busca"
            onMouseDown={e => { e.preventDefault(); setBusca(''); inputRef.current?.focus(); }}
            className="absolute right-9 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <X size={14} />
          </button>
        )}
        <ChevronDown size={14}
          className={`absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none transition-transform ${aberto ? 'rotate-180' : ''}`} />

        {aberto && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-2xl shadow-xl z-20 overflow-hidden max-h-64 overflow-y-auto">
            {filtrados.length === 0 ? (
              <p className="px-4 py-3 text-xs text-gray-400">
                Nenhum paciente encontrado para “{busca.trim()}”.
              </p>
            ) : filtrados.map((a, i) => (
              <button
                key={a.id}
                type="button"
                // `onMouseDown` + `preventDefault`: no `onClick` o blur do input
                // fecharia a lista antes de o clique chegar na opção.
                onMouseDown={e => { e.preventDefault(); escolher(a); }}
                onMouseEnter={() => setDestaque(i)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  i === destaque ? 'bg-emerald-50' : 'hover:bg-gray-50'
                }`}>
                <div className="w-8 h-8 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                  <FotoAnimal url={a.photoUrl as string} nome="" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 flex items-center gap-1.5 min-w-0">
                    <span className="truncate">{a.nome}</span>
                    {/* Aqui a lista é desenhada à mão, então o inativo ganha BADGE — a
                        mesma âmbar do selo "Somente leitura" da lista de Pacientes. */}
                    {a.inativo && (
                      <span className="flex-shrink-0 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                        Inativo
                      </span>
                    )}
                  </p>
                  {/* O proprietário aparece SEMPRE que existir: é ele que desempata
                      xarás, e escondê-lo fora desse caso faria a linha mudar de forma
                      no meio da lista. */}
                  {a.user?.fullName && (
                    <p className="text-xs text-gray-400 truncate">{a.user.fullName}</p>
                  )}
                </div>
                {a.id === animalAtual?.id && (
                  <span className="w-2 h-2 bg-emerald-500 rounded-full flex-shrink-0" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
