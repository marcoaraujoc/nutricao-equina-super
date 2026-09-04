// src/pages/ClinicaDashboard.tsx
// Tela de Atendimento — lista pacientes em tabela com acesso rápido aos módulos clínicos

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import api from '../services/api';
import InlineError from '../components/InlineError';
import {
  Search, FileText, Pill, Syringe,
  FlaskConical, Share2, Stethoscope,
} from 'lucide-react';
import BotaoVoltar from '../components/BotaoVoltar';
import FotoAnimal from '../components/FotoAnimal';

interface Animal {
  id:               number;
  nome:             string;
  photoUrl?:        string | null;
  dataNascimento?:  string | null;
  idadeAnos?:       number | null;
  sexo?:            string | null;
  categoriaAnimal?: string | null;
  tipoExercicio?:   string | null;
  especie?:         { nome: string } | null;
  raca?:            { nome: string } | null;
  user?:            { fullName: string; email: string } | null;
}

type FiltroCampo = 'animal' | 'proprietario';

// ─── Módulos clínicos com ícone e cor ────────────────────────────────────────
const MODULOS_CLINICOS = [
  { key: 'evolucao',       label: 'Evolução',       icon: FileText,     cor: 'text-blue-600 hover:bg-blue-50'    },
  { key: 'prescricao',     label: 'Prescrição',      icon: Pill,         cor: 'text-emerald-600 hover:bg-emerald-50' },
  { key: 'vacina',         label: 'Vacinas',         icon: Syringe,      cor: 'text-teal-600 hover:bg-teal-50'    },
  { key: 'exames',         label: 'Exames',          icon: FlaskConical, cor: 'text-purple-600 hover:bg-purple-50' },
  { key: 'encaminhamento', label: 'Encaminhamento',  icon: Share2,       cor: 'text-orange-600 hover:bg-orange-50'},
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const calcularIdade = (dn: string): string => {
  const p    = dn.split('T')[0].split('-').map(Number);
  const nasc = new Date(p[0], p[1] - 1, p[2]);
  const h    = new Date();
  let anos  = h.getFullYear() - p[0];
  let meses = h.getMonth() - (p[1] - 1);
  if (meses < 0) { anos--; meses += 12; }
  if (h.getDate() < p[2]) meses--;
  const dias = Math.floor((h.getTime() - nasc.getTime()) / 86400000);
  if (dias  < 30) return `${dias}d`;
  if (anos === 0) return `${meses} ${meses === 1 ? 'mês' : 'meses'}`;
  return `${anos} ${anos === 1 ? 'ano' : 'anos'}`;
};

const idadeDisplay = (a: Animal): string =>
  a.dataNascimento ? calcularIdade(a.dataNascimento)
  : a.idadeAnos    ? `${a.idadeAnos} ${a.idadeAnos === 1 ? 'ano' : 'anos'}`
  : '—';

const nullToUndefined = (a: Animal) => ({
  ...a,
  photoUrl:        a.photoUrl        ?? undefined,
  dataNascimento:  a.dataNascimento  ?? undefined,
  idadeAnos:       a.idadeAnos       ?? undefined,
  sexo:            a.sexo            ?? undefined,
  categoriaAnimal: a.categoriaAnimal ?? undefined,
  tipoExercicio:   a.tipoExercicio   ?? undefined,
  raca:            a.raca            ?? undefined,
  especie:         a.especie         ?? undefined,
  user:            a.user            ?? undefined,
});

// ─── Componente ───────────────────────────────────────────────────────────────
export default function ClinicaDashboard() {
  const navigate                              = useNavigate();
  const { setSelectedAnimal }                 = useSelectedAnimal();

  const [animais,     setAnimais]     = useState<Animal[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [busca,       setBusca]       = useState('');
  const [filtroCampo, setFiltroCampo] = useState<FiltroCampo>('animal');
  const [erroInline,  setErroInline]  = useState<string | null>(null);

  useEffect(() => {
    api.get('/animais')
      .then(res => setAnimais(res.data?.dados ?? []))
      .catch(() => setErroInline('Erro ao carregar pacientes'))
      .finally(() => setLoading(false));
  }, []);

  // Seleciona o animal no contexto e navega para o módulo clínico
  const irParaModulo = (animal: Animal, modulo: string) => {
    setSelectedAnimal(nullToUndefined(animal));
    navigate(`/clinica/${modulo}/${animal.id}`);
  };

  // Filtro por tipo
  const animaisFiltrados = animais.filter(a => {
    const termo = busca.toLowerCase().trim();
    if (!termo) return true;
    return filtroCampo === 'animal'
      ? a.nome.toLowerCase().includes(termo)
      : (a.user?.fullName ?? '').toLowerCase().includes(termo);
  });

  return (
    <div className="space-y-6">

      {/* Header */}
      <div>
        <BotaoVoltar />
        <div className="flex items-center gap-3 mt-4">
          <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <Stethoscope size={20} className="text-emerald-700" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Atendimento</h1>
            <p className="text-sm text-gray-500">
              {animais.length > 0
                ? `${animais.length} paciente${animais.length !== 1 ? 's' : ''} disponíve${animais.length !== 1 ? 'is' : 'l'}`
                : 'Nenhum paciente'}
            </p>
          </div>
        </div>
      </div>

      <InlineError message={erroInline} />

      {/* Busca */}
      {animais.length > 0 && (
        <div className="flex gap-2">
          <select
            value={filtroCampo}
            onChange={e => { setFiltroCampo(e.target.value as FiltroCampo); setBusca(''); }}
            className="border border-gray-200 rounded-2xl px-4 py-2.5 text-sm text-gray-700 focus:outline-none focus:border-emerald-600 bg-white min-w-[170px]"
          >
            <option value="animal">Buscar por animal</option>
            <option value="proprietario">Buscar por proprietário</option>
          </select>
          <div className="relative flex-1 max-w-md">
            <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder={filtroCampo === 'animal' ? 'Nome do animal...' : 'Nome do proprietário...'}
              value={busca}
              onChange={e => setBusca(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-2xl text-sm text-gray-900 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 transition-colors"
            />
          </div>
        </div>
      )}

      {/* Tabela */}
      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">Carregando pacientes...</div>
      ) : animaisFiltrados.length === 0 ? (
        <div className="text-center py-16">
          <Stethoscope size={36} className="mx-auto mb-3 text-gray-200" />
          <p className="text-gray-400 text-sm">
            {busca ? `Nenhum resultado para "${busca}"` : 'Nenhum paciente disponível'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">

          {/* Cabeçalho */}
          <div className="grid grid-cols-[44px_1fr_140px_80px_60px_220px] items-center gap-4 px-5 py-3 border-b border-gray-100 bg-gray-50">
            <span />
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Nome / Proprietário</span>
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Raça</span>
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Idade</span>
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Sexo</span>
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide text-center">Módulos Clínicos</span>
          </div>

          {/* Linhas */}
          <div className="divide-y divide-gray-50">
            {animaisFiltrados.map(animal => (
              <div
                key={animal.id}
                className="grid grid-cols-[44px_1fr_140px_80px_60px_220px] items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors"
              >
                {/* Foto */}
                <div className="w-10 h-10 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
                  <FotoAnimal url={animal.photoUrl} nome={animal.nome} animalId={animal.id} />
                </div>

                {/* Nome + proprietário */}
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{animal.nome}</p>
                  {animal.user?.fullName && (
                    <p className="text-xs text-gray-400 truncate">{animal.user.fullName}</p>
                  )}
                </div>

                {/* Raça */}
                <p className="text-sm text-gray-600 truncate">
                  {animal.raca?.nome || animal.especie?.nome || '—'}
                </p>

                {/* Idade */}
                <p className="text-sm text-gray-600">{idadeDisplay(animal)}</p>

                {/* Sexo */}
                <p className="text-sm text-gray-600">{animal.sexo ?? '—'}</p>

                {/* Módulos clínicos — ícones diretos na linha */}
                <div className="flex items-center justify-center gap-0.5">
                  {MODULOS_CLINICOS.map(({ key, label, icon: Icon, cor }) => (
                    <button
                      key={key}
                      onClick={() => irParaModulo(animal, key)}
                      title={label}
                      className={`p-2 rounded-xl transition-colors ${cor}`}
                    >
                      <Icon size={16} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Rodapé */}
          <div className="px-5 py-3 border-t border-gray-50 text-center">
            <p className="text-xs text-gray-400">
              {animaisFiltrados.length} paciente{animaisFiltrados.length !== 1 ? 's' : ''} encontrado{animaisFiltrados.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      )}

    </div>
  );
}