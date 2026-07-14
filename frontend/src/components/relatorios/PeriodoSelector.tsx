// frontend/src/components/relatorios/PeriodoSelector.tsx
// Seletor de período compartilhado por todos os submódulos de Relatórios.
// Toggle Dia | Mês | Ano + navegação ◀ ▶ + seleção precisa via input de data.
// Lê/escreve o PeriodoContext — a seleção persiste ao trocar de submódulo.

import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { usePeriodo, toISODate, type Granularidade } from '../../contexts/PeriodoContext';

const MESES_LONGOS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const OPCOES: { valor: Granularidade; label: string }[] = [
  { valor: 'dia',    label: 'Dia' },
  { valor: 'semana', label: 'Semana' },
  { valor: 'mes',    label: 'Mês' },
  { valor: 'ano',    label: 'Ano' },
];

/** Domingo da semana da data (padrão do calendário BR). */
function inicioSemana(data: Date): Date {
  return new Date(data.getFullYear(), data.getMonth(), data.getDate() - data.getDay());
}

function rotulo(data: Date, gran: Granularidade): string {
  if (gran === 'dia') return data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  if (gran === 'ano') return String(data.getFullYear());
  if (gran === 'semana') {
    const ini = inicioSemana(data);
    const fim = new Date(ini.getFullYear(), ini.getMonth(), ini.getDate() + 6);
    const dm = (x: Date) => x.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    return `${dm(ini)} a ${fim.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
  }
  return `${MESES_LONGOS[data.getMonth()]} ${data.getFullYear()}`;
}

function passo(data: Date, gran: Granularidade, dir: 1 | -1): Date {
  const y = data.getFullYear(), m = data.getMonth(), d = data.getDate();
  if (gran === 'dia')    return new Date(y, m, d + dir);
  if (gran === 'semana') return new Date(y, m, d + dir * 7);
  if (gran === 'ano')    return new Date(y + dir, 0, 1);
  return new Date(y, m + dir, 1);
}

export default function PeriodoSelector() {
  const { granularidade, data, setGranularidade, setData } = usePeriodo();

  const onInputData = (v: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (m) setData(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  };

  return (
    <div className="flex flex-wrap items-center gap-3 mb-5 bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3">
      {/* Granularidade */}
      <div className="inline-flex rounded-xl bg-gray-100 p-0.5">
        {OPCOES.map(o => (
          <button
            key={o.valor}
            onClick={() => setGranularidade(o.valor)}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
              granularidade === o.valor ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {o.label}
          </button>
        ))}
      </div>

      {/* Navegação por período */}
      <div className="inline-flex items-center gap-1">
        <button
          onClick={() => setData(passo(data, granularidade, -1))}
          aria-label="Período anterior"
          className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors">
          <ChevronLeft size={18} />
        </button>
        <span className="min-w-[8.5rem] text-center text-sm font-semibold text-gray-800 capitalize">
          {rotulo(data, granularidade)}
        </span>
        <button
          onClick={() => setData(passo(data, granularidade, 1))}
          aria-label="Próximo período"
          className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors">
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Seleção precisa + atalho Hoje */}
      <div className="flex items-center gap-2 ml-auto">
        <label className="relative inline-flex items-center text-gray-400 hover:text-emerald-600 cursor-pointer" title="Escolher data">
          <CalendarDays size={18} />
          <input
            type="date"
            value={toISODate(data)}
            onChange={e => onInputData(e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer"
          />
        </label>
        <button
          onClick={() => setData(new Date())}
          className="px-2.5 py-1 text-[11px] font-bold text-gray-500 hover:text-emerald-700 border border-gray-200 rounded-lg transition-colors">
          Hoje
        </button>
      </div>
    </div>
  );
}
