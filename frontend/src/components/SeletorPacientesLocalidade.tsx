import { useMemo, useState } from 'react';
import { Check, MapPin, Search } from 'lucide-react';
import ComboBuscavel from './ComboBuscavel';

/**
 * Agendamento por LOCALIDADE (2026-10-04, a pedido): escolhida a localidade, a lista
 * traz TODOS os pacientes dela, para marcar todos ou só alguns — é a visita ao haras
 * para vacinar/vermifugar o lote inteiro.
 *
 * A localidade é a que a Agenda já exibe ao lado do paciente (catálogo → texto
 * legado), então o recorte bate com o que a pessoa vê nos outros seletores.
 * Paciente sem localidade não aparece aqui — ele continua sendo agendado pelo
 * seletor de paciente avulso (localidade "Todas").
 *
 * Só COLETA a seleção: quem decide o que fazer com ela é a tela.
 */
export interface PacienteLocalidade {
  id: number;
  nome: string;
  localizacaoNome: string | null;
  user?: { fullName: string } | null;
}

interface Props {
  pacientes: PacienteLocalidade[];
  localidade: string;
  onLocalidade: (v: string) => void;
  selecionados: number[];
  onSelecionados: (ids: number[]) => void;
}

const semAcento = (v: string) =>
  String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const CAMPO = 'w-full py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 text-gray-800 font-semibold outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500';

export default function SeletorPacientesLocalidade({
  pacientes, localidade, onLocalidade, selecionados, onSelecionados,
}: Props) {
  const [busca, setBusca] = useState('');

  const localidades = useMemo(() => {
    const contagem = new Map<string, number>();
    for (const p of pacientes) {
      const l = p.localizacaoNome?.trim();
      if (l) contagem.set(l, (contagem.get(l) ?? 0) + 1);
    }
    return [...contagem.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
      .map(([nome, n]) => ({ value: nome, label: nome, detalhe: `${n} paciente${n > 1 ? 's' : ''}` }));
  }, [pacientes]);

  const daLocalidade = useMemo(
    () => pacientes
      .filter(p => p.localizacaoNome?.trim() === localidade)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    [pacientes, localidade],
  );
  const visiveis = useMemo(() => {
    const t = semAcento(busca);
    return t ? daLocalidade.filter(p => semAcento(`${p.nome} ${p.user?.fullName ?? ''}`).includes(t)) : daLocalidade;
  }, [daLocalidade, busca]);

  const marcados = new Set(selecionados);
  const todosVisiveisMarcados = visiveis.length > 0 && visiveis.every(p => marcados.has(p.id));

  const alternar = (id: number) =>
    onSelecionados(marcados.has(id) ? selecionados.filter(x => x !== id) : [...selecionados, id]);

  // "Selecionar todos" age sobre o que está VISÍVEL: com busca digitada, marca só o
  // que a busca achou — é o que a pessoa está olhando.
  const alternarTodos = () => {
    const ids = visiveis.map(p => p.id);
    onSelecionados(todosVisiveisMarcados
      ? selecionados.filter(x => !ids.includes(x))
      : [...new Set([...selecionados, ...ids])]);
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className="text-xs font-bold text-gray-600 mb-1.5 block">Localidade</label>
        <ComboBuscavel
          value={localidade}
          onChange={v => { setBusca(''); onLocalidade(v); }}
          opcoes={localidades}
          rotuloVazio="Todas (paciente avulso)"
          placeholder="Digite a localidade"
          vazioTexto="Nenhuma localidade encontrada"
          icone={<MapPin size={13} />}
          className={CAMPO}
        />
      </div>

      {localidade && (
        <div>
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <label className="text-xs font-bold text-gray-600">
              Pacientes <span className="text-red-500">*</span>
              <span className="ml-1.5 font-semibold text-emerald-700">
                {selecionados.length} de {daLocalidade.length} selecionado{selecionados.length === 1 ? '' : 's'}
              </span>
            </label>
            {visiveis.length > 0 && (
              <button type="button" onClick={alternarTodos}
                className="text-xs font-bold text-emerald-700 hover:text-emerald-800">
                {todosVisiveisMarcados ? 'Desmarcar todos' : 'Selecionar todos'}
              </button>
            )}
          </div>
          <div className="relative mb-2">
            <Search size={13} className="absolute left-3 top-3 text-gray-400 pointer-events-none" />
            <input type="text" value={busca} onChange={e => setBusca(e.target.value)}
              placeholder="Filtrar pacientes desta localidade..." autoComplete="off"
              className={`${CAMPO} pl-8 pr-3 font-normal`} />
          </div>
          <div className="border border-gray-200 rounded-xl max-h-52 overflow-y-auto divide-y divide-gray-50">
            {visiveis.length === 0 && (
              <p className="px-4 py-3 text-sm text-gray-400 text-center">Nenhum paciente encontrado</p>
            )}
            {visiveis.map(p => {
              const marcado = marcados.has(p.id);
              return (
                <button key={p.id} type="button" onClick={() => alternar(p.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${marcado ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}>
                  <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${marcado ? 'bg-emerald-600 border-emerald-600' : 'border-gray-300 bg-white'}`}>
                    {marcado && <Check size={11} className="text-white" />}
                  </span>
                  <span className="font-semibold text-gray-800 truncate">{p.nome}</span>
                  {p.user?.fullName && <span className="text-xs text-gray-400 truncate">· {p.user.fullName}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
