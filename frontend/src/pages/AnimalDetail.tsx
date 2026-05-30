// src/pages/AnimalDetail.tsx
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import {
  ArrowLeft, FileText, Pill, Syringe,
  FlaskConical, Share2, Utensils, BarChart2,
} from 'lucide-react';
import { formatDate } from '../utils/dateUtils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Solicitacao {
  status:      string;
  vetUserId:   number;
  veterinario?: { fullName: string; email: string } | null;
}

interface AnimalData {
  id:                number;
  nome:              string;
  peso:              number;
  sexo:              string;
  photoUrl?:         string | null;
  dataNascimento?:   string | null;
  idadeAnos?:        number | null;
  categoriaAnimal?:  string | null;
  tipoExercicio?:    string | null;
  veterinarioNome?:  string | null;
  veterinarioClinica?: string | null;
  raca?:             { nome: string } | null;
  especie?:          { nome: string } | null;
  user?:             { fullName: string; email: string } | null;
  solicitacoes?:     Solicitacao[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const calcularIdade = (dataNascimento: string): string => {
  const partes  = dataNascimento.split('T')[0].split('-');
  const anoNasc = parseInt(partes[0]);
  const mesNasc = parseInt(partes[1]) - 1;
  const diaNasc = parseInt(partes[2]);
  const hoje    = new Date();
  const nascimento = new Date(anoNasc, mesNasc, diaNasc);
  const diffMs  = hoje.getTime() - nascimento.getTime();
  const diffDias = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  let diffMeses = (hoje.getFullYear() - anoNasc) * 12 + (hoje.getMonth() - mesNasc);
  if (hoje.getDate() < diaNasc) diffMeses--;
  let diffAnos = hoje.getFullYear() - anoNasc;
  if (hoje.getMonth() < mesNasc || (hoje.getMonth() === mesNasc && hoje.getDate() < diaNasc)) diffAnos--;
  if (diffDias < 30)  return `${diffDias} ${diffDias === 1 ? 'dia' : 'dias'}`;
  if (diffMeses < 12) return `${diffMeses} ${diffMeses === 1 ? 'mês' : 'meses'}`;
  return `${diffAnos} ${diffAnos === 1 ? 'ano' : 'anos'}`;
};

// ─── Definição dos botões por módulo ─────────────────────────────────────────

const CLINICO = [
  { key: 'evolucao',       label: 'Evolução',        icon: FileText,    cor: 'bg-blue-50 text-blue-600 border-blue-100 hover:bg-blue-100'         },
  { key: 'prescricao',     label: 'Prescrição',       icon: Pill,        cor: 'bg-emerald-50 text-emerald-600 border-emerald-100 hover:bg-emerald-100' },
  { key: 'vacina',         label: 'Vacinas',          icon: Syringe,     cor: 'bg-teal-50 text-teal-600 border-teal-100 hover:bg-teal-100'         },
  { key: 'exames',         label: 'Exames',           icon: FlaskConical,cor: 'bg-purple-50 text-purple-600 border-purple-100 hover:bg-purple-100'  },
  { key: 'encaminhamento', label: 'Encaminhamento',   icon: Share2,      cor: 'bg-orange-50 text-orange-600 border-orange-100 hover:bg-orange-100'  },
] as const;

const NUTRICIONAL = [
  { key: 'dieta',      label: 'Dieta',               icon: Utensils,  cor: 'bg-amber-50 text-amber-600 border-amber-100 hover:bg-amber-100'        },
  { key: 'relatorio',  label: 'Relatório Nutricional',icon: BarChart2, cor: 'bg-rose-50 text-rose-600 border-rose-100 hover:bg-rose-100'           },
] as const;

const ROLES_CLINICAS = ['ADMIN', 'VETERINARIO', 'ESTAGIARIO'];

// ─── Componente ───────────────────────────────────────────────────────────────

const AnimalDetail = () => {
  const { id }     = useParams<{ id: string }>();
  const navigate   = useNavigate();
  const { user }   = useAuth();

  const [animal,  setAnimal]  = useState<AnimalData | null>(null);
  const [loading, setLoading] = useState(true);

  const role          = (user?.role      ?? '').toUpperCase();
  const userTypeUpper = (user?.userType  ?? '').toUpperCase();
  const temAcessoClinico = ROLES_CLINICAS.includes(role) || ROLES_CLINICAS.includes(userTypeUpper);

  useEffect(() => {
    if (!id) return;
    api.get(`/animais/${id}`)
      .then(res => setAnimal(res.data?.dados ?? res.data))
      .catch(err => console.error('Erro ao carregar animal:', err))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full" />
    </div>
  );

  if (!animal) return (
    <div className="text-center py-20 text-red-500">Animal não encontrado</div>
  );

  const idadeDisplay = animal.dataNascimento
    ? calcularIdade(animal.dataNascimento)
    : animal.idadeAnos
      ? `${animal.idadeAnos} ${animal.idadeAnos === 1 ? 'ano' : 'anos'}`
      : '-';

  const nrcDisplay = animal.categoriaAnimal
    ? `${animal.categoriaAnimal} · ${animal.tipoExercicio}`
    : null;

  // Vet responsável: prioriza solicitação ACEITA, fallback para campo texto
  const solAceita      = animal.solicitacoes?.find(s => s.status === 'ACEITO');
  const solPendente    = animal.solicitacoes?.find(s => s.status === 'PENDENTE');
  const vetNome        = solAceita?.veterinario?.fullName ?? animal.veterinarioNome ?? null;
  const vetPendente    = solPendente?.veterinario?.fullName ?? null;
  const temVeterinario = !!vetNome;

  // Navegação para sub-módulos
  const irParaClinica = (modulo: string) =>
    navigate(`/clinica/${modulo}/${animal.id}`);

  const irParaDieta = () =>
    navigate(`/dieta/${animal.id}`);

  const irParaRelatorio = () =>
    navigate(`/relatorio-nutricional/${animal.id}`);

  return (
    <div className="max-w-7xl mx-auto p-3 sm:p-6 space-y-6">

      {/* Voltar */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-emerald-700 hover:text-emerald-800 font-medium"
      >
        <ArrowLeft size={20} />
        <span className="text-sm sm:text-base">Voltar</span>
      </button>

      {/* ── Card principal: foto + dados ──────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6">

        {/* Foto + info */}
        <div className="lg:col-span-7 bg-white rounded-3xl shadow-md p-4 sm:p-8 border border-gray-100">
          <div className="flex flex-col sm:flex-row gap-5 sm:gap-8">
            <div className="w-full sm:w-64 h-56 sm:h-80 bg-gray-200 rounded-3xl overflow-hidden flex-shrink-0">
              <img
                src={animal.photoUrl || 'https://picsum.photos/id/1015/800/800'}
                alt={animal.nome}
                className="w-full h-full object-cover"
              />
            </div>

            <div className="flex-1">
              <h1 className="text-2xl sm:text-4xl font-bold text-gray-900 break-words leading-tight">{animal.nome}</h1>
              <p className="text-lg sm:text-2xl text-emerald-600 font-medium mt-1">
                {animal.raca?.nome || animal.especie?.nome || 'Sem raça definida'}
              </p>

              <div className="grid grid-cols-2 gap-4 sm:gap-6 mt-6 sm:mt-10">
                <div>
                  <span className="block text-xs uppercase text-gray-500 tracking-wide">Espécie</span>
                  <span className="text-base sm:text-xl font-semibold text-gray-900">
                    {animal.especie?.nome || '-'}
                  </span>
                </div>
                <div>
                  <span className="block text-xs uppercase text-gray-500 tracking-wide">Sexo</span>
                  <span className="text-base sm:text-xl font-semibold text-gray-900">
                    {animal.sexo || '-'}
                  </span>
                </div>
                <div>
                  <span className="block text-xs uppercase text-gray-500 tracking-wide">Nascimento</span>
                  <span className="text-base sm:text-xl font-semibold text-gray-900">
                    {animal.dataNascimento ? formatDate(animal.dataNascimento) : '-'}
                  </span>
                </div>
                <div>
                  <span className="block text-xs uppercase text-gray-500 tracking-wide">Idade</span>
                  <span className="text-base sm:text-xl font-semibold text-gray-900">{idadeDisplay}</span>
                </div>
                <div>
                  <span className="block text-xs uppercase text-gray-500 tracking-wide">Peso Atual</span>
                  <span className="text-base sm:text-xl font-semibold text-gray-900">
                    {animal.peso || '-'} kg
                  </span>
                </div>
                <div>
                  <span className="block text-xs uppercase text-gray-500 tracking-wide">Perfil NRC</span>
                  <span className="text-sm font-semibold text-emerald-600 leading-tight">
                    {nrcDisplay || 'Não informado'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Proprietário + Veterinário */}
        <div className="lg:col-span-5 space-y-4 sm:space-y-5">

          {/* Proprietário */}
          <div className="bg-white rounded-3xl shadow-md p-4 sm:p-6 border border-gray-100">
            <div className="flex items-center gap-4 mb-3">
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-100 rounded-2xl flex items-center justify-center text-2xl">
                👤
              </div>
              <div>
                <h3 className="font-semibold text-base text-gray-900">Proprietário</h3>
                <p className="text-gray-700 text-sm font-medium">
                  {animal.user?.fullName || user?.fullName || '-'}
                </p>
              </div>
            </div>
            <div className="text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-gray-400">E-mail</span>
                <span className="text-gray-700 text-right truncate">
                  {animal.user?.email || user?.email || '-'}
                </span>
              </div>
            </div>
          </div>

          {/* Veterinário */}
          <div className={`rounded-3xl shadow-md p-4 sm:p-6 border ${
            temVeterinario
              ? 'bg-emerald-700 text-white border-emerald-700'
              : 'bg-white border-gray-100'
          }`}>
            <div className="flex items-center gap-4 mb-3">
              <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-2xl flex items-center justify-center text-2xl ${
                temVeterinario ? 'bg-white/20' : 'bg-emerald-50'
              }`}>
                🩺
              </div>
              <div>
                <h3 className={`font-semibold text-base ${temVeterinario ? 'text-white' : 'text-gray-900'}`}>
                  Veterinário Responsável
                </h3>
                {temVeterinario ? (
                  <p className="text-emerald-100 text-sm font-medium">Dr(a). {vetNome}</p>
                ) : vetPendente ? (
                  <span className="inline-flex items-center gap-1.5 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium mt-0.5">
                    <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
                    Aguardando: {vetPendente}
                  </span>
                ) : (
                  <p className="text-gray-400 text-sm">Não informado</p>
                )}
              </div>
            </div>
            {temVeterinario && animal.veterinarioClinica && (
              <div className="text-sm">
                <div className="flex justify-between">
                  <span className="text-emerald-200">Clínica</span>
                  <span className="text-right">{animal.veterinarioClinica}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Botões de acesso rápido ─────────────────────────────────────── */}
      <div className="space-y-4">

        {/* Módulo Clínico — apenas ADMIN, VETERINARIO, ESTAGIARIO */}
        {temAcessoClinico && (
          <div className="bg-white rounded-3xl shadow-md border border-gray-100 p-5 sm:p-6">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">
              Módulo Clínico
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {CLINICO.map(({ key, label, icon: Icon, cor }) => (
                <button
                  key={key}
                  onClick={() => irParaClinica(key)}
                  className={`flex flex-col items-center gap-2.5 p-4 rounded-2xl border transition-all group ${cor}`}
                >
                  <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm group-hover:shadow-md transition-shadow">
                    <Icon size={20} />
                  </div>
                  <span className="text-xs font-semibold text-center leading-tight">{label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Módulo Nutricional — todos os perfis */}
        <div className="bg-white rounded-3xl shadow-md border border-gray-100 p-5 sm:p-6">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">
            Módulo Nutricional
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {NUTRICIONAL.map(({ key, label, icon: Icon, cor }) => (
              <button
                key={key}
                onClick={key === 'dieta' ? irParaDieta : irParaRelatorio}
                className={`flex flex-col items-center gap-2.5 p-4 rounded-2xl border transition-all group ${cor}`}
              >
                <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm group-hover:shadow-md transition-shadow">
                  <Icon size={20} />
                </div>
                <span className="text-xs font-semibold text-center leading-tight">{label}</span>
              </button>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
};

export default AnimalDetail;