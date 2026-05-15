// frontend/src/pages/Dashboard.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import {
  Plus, ClipboardList, Utensils, FlaskConical, FileText, ArrowLeft,
  CheckCircle2, Sun, Sunset, Moon, Sparkles,
} from 'lucide-react';
import api from '../services/api';

/* ═══════════════════════════════════════════════════════════
   ONBOARDING — localStorage state machine
   Valores: 'a' = aguardando animal | 'p' = aguardando pessoal | 'd' = pessoal concluído
   ═══════════════════════════════════════════════════════════ */
const OB_KEY = 's2vet_ob';
const getOB  = () => localStorage.getItem(OB_KEY);
const setOB  = (v: string) => localStorage.setItem(OB_KEY, v);
const clearOB = () => localStorage.removeItem(OB_KEY);

type OBPhase = 'greeting' | 'need_animal' | 'need_personal' | 'welcome' | null;

/* ═══════════════════════════════════════════════════════════
   HELPERS — saudação e perfil de acesso
   ═══════════════════════════════════════════════════════════ */
const getSaudacao = () => {
  const h = new Date().getHours();
  if (h < 12) return { text: 'Bom dia',    Icon: Sun,    color: 'text-amber-400'  };
  if (h < 18) return { text: 'Boa tarde',  Icon: Sunset, color: 'text-orange-400' };
  return         { text: 'Boa noite',  Icon: Moon,   color: 'text-indigo-400' };
};

const getRoleLabel = (role?: string) => {
  const r = role?.toUpperCase();
  if (r === 'ADMIN')       return 'Administrador';
  if (r === 'VETERINARIO') return 'Veterinário';
  return 'Usuário';
};

const getRoleFeatures = (role?: string): string[] => {
  const r = role?.toUpperCase();
  if (r === 'ADMIN') return [
    'Gestão completa de animais e usuários',
    'Todos os módulos clínicos e nutricionais',
    'Relatórios avançados e configurações do sistema',
    'Composição alimentar, nutrientes e dietas',
  ];
  if (r === 'VETERINARIO') return [
    'Gestão de animais e prontuários',
    'Módulos clínico e nutricional completos',
    'Exames laboratoriais e relatórios',
    'Dietas e composição alimentar',
  ];
  return [
    'Gestão dos seus animais',
    'Acompanhamento de dietas',
    'Visualização de exames e relatórios',
  ];
};

/* ═══════════════════════════════════════════════════════════
   HELPERS — data / idade (existentes, não alterados)
   ═══════════════════════════════════════════════════════════ */
const calcularIdade = (dataNascimento: string): string => {
  const partes  = dataNascimento.split('T')[0].split('-');
  const anoNasc = parseInt(partes[0]);
  const mesNasc = parseInt(partes[1]) - 1;
  const diaNasc = parseInt(partes[2]);
  const hoje    = new Date();
  const anoHoje = hoje.getFullYear();
  const mesHoje = hoje.getMonth();
  const diaHoje = hoje.getDate();
  const nascimento = new Date(anoNasc, mesNasc, diaNasc);
  const diffMs  = hoje.getTime() - nascimento.getTime();
  const diffDias = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  let diffMeses  = (anoHoje - anoNasc) * 12 + (mesHoje - mesNasc);
  if (diaHoje < diaNasc) diffMeses--;
  let diffAnos = anoHoje - anoNasc;
  if (mesHoje < mesNasc || (mesHoje === mesNasc && diaHoje < diaNasc)) diffAnos--;
  if (diffDias < 30)  return `${diffDias} ${diffDias  === 1 ? 'dia'  : 'dias'}`;
  if (diffMeses < 12) return `${diffMeses} ${diffMeses === 1 ? 'mês'  : 'meses'}`;
  return `${diffAnos} ${diffAnos === 1 ? 'ano' : 'anos'}`;
};

const idadeDisplay = (animal: { dataNascimento?: string | null; idadeAnos?: number | null }): string => {
  if (animal.dataNascimento) return calcularIdade(animal.dataNascimento);
  if (animal.idadeAnos)      return `${animal.idadeAnos} ${animal.idadeAnos === 1 ? 'ano' : 'anos'}`;
  return '-';
};

const formatarDataBR = (data: string | Date | null | undefined): string => {
  if (!data) return '-';
  const dataObj = new Date(data instanceof Date ? data.toISOString() : data);
  if (isNaN(dataObj.getTime())) return '-';
  const dia = String(dataObj.getUTCDate()).padStart(2, '0');
  const mes = String(dataObj.getUTCMonth() + 1).padStart(2, '0');
  const ano = dataObj.getUTCFullYear();
  return `${dia}/${mes}/${ano}`;
};

/* ═══════════════════════════════════════════════════════════
   SUB-COMPONENTE — AnimalDashboard (não alterado)
   ═══════════════════════════════════════════════════════════ */
const AnimalDashboard = ({
  animal, onNavigate, onBack,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  animal: any; onNavigate: (path: string) => void; onBack?: () => void;
}) => {
  const atalhos = [
    { label: 'Dieta',      icon: Utensils,     path: `/dieta/${animal.id}`                  },
    { label: 'Exames',     icon: FlaskConical,  path: `/exames/${animal.id}`                 },
    { label: 'Relatório',  icon: FileText,      path: `/relatorio-nutricional/${animal.id}`  },
    { label: 'Prontuário', icon: ClipboardList, path: `/animal/${animal.id}`                 },
  ];

  return (
    <div className="space-y-6">
      {onBack && (
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-emerald-700 hover:text-emerald-800 font-medium"
        >
          <ArrowLeft size={20} />
          <span className="text-sm">Todos os animais</span>
        </button>
      )}

      {/* Card principal */}
      <div className="bg-white rounded-3xl shadow-md border border-gray-100 overflow-hidden">
        <div className="flex flex-col sm:flex-row">
          <div className="w-full sm:w-56 h-48 sm:h-auto bg-gray-200 flex-shrink-0">
            <img
              src={animal.photoUrl || 'https://picsum.photos/id/1015/400/400'}
              alt={animal.nome}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="flex-1 p-6 sm:p-8">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900">{animal.nome}</h2>
            <p className="text-lg text-emerald-600 font-medium mt-1">
              {animal.raca?.nome || animal.especie?.nome || 'Sem raça definida'}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
              <div>
                <span className="block text-xs uppercase text-gray-500 tracking-widest mb-1">Espécie</span>
                <span className="text-base font-semibold text-gray-900">{animal.especie?.nome || '-'}</span>
              </div>
              <div>
                <span className="block text-xs uppercase text-gray-500 tracking-widest mb-1">Sexo</span>
                <span className="text-base font-semibold text-gray-900">{animal.sexo || '-'}</span>
              </div>
              <div>
                <span className="block text-xs uppercase text-gray-500 tracking-widest mb-1">Nascimento</span>
                <span className="text-base font-semibold text-gray-900">
                  {animal.dataNascimento ? formatarDataBR(animal.dataNascimento) : '-'}
                </span>
              </div>
              <div>
                <span className="block text-xs uppercase text-gray-500 tracking-widest mb-1">Idade</span>
                <span className="text-base font-semibold text-gray-900">{idadeDisplay(animal)}</span>
              </div>
              <div>
                <span className="block text-xs uppercase text-gray-500 tracking-widest mb-1">Peso</span>
                <span className="text-base font-semibold text-gray-900">
                  {animal.peso ? `${animal.peso} kg` : '-'}
                </span>
              </div>
              <div>
                <span className="block text-xs uppercase text-gray-500 tracking-widest mb-1">Perfil NRC</span>
                <span className="text-sm font-semibold text-emerald-600 leading-tight">
                  {animal.categoriaAnimal
                    ? `${animal.categoriaAnimal} · ${animal.tipoExercicio}`
                    : 'Não informado'}
                </span>
              </div>
              {animal.veterinarioNome && (
                <div className="col-span-2">
                  <span className="block text-xs uppercase text-gray-500 tracking-widest mb-1">Veterinário</span>
                  <span className="text-base font-semibold text-gray-900">
                    Dr(a). {animal.veterinarioNome}
                    {animal.veterinarioClinica && (
                      <span className="text-sm font-normal text-gray-500 ml-1">
                        — {animal.veterinarioClinica}
                      </span>
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Atalhos */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {atalhos.map(({ label, icon: Icon, path }) => (
          <button
            key={label}
            onClick={() => onNavigate(path)}
            className="bg-white rounded-2xl shadow-sm border border-gray-100 hover:shadow-md hover:border-emerald-200 transition-all p-5 flex flex-col items-center gap-3 text-center"
          >
            <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600">
              <Icon size={22} />
            </div>
            <span className="text-sm font-semibold text-gray-700">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════
   ONBOARDING — tela 1: saudação inicial
   ═══════════════════════════════════════════════════════════ */
const GreetingScreen = ({
  userName, onStart,
}: { userName: string; onStart: () => void }) => {
  const { text, Icon, color } = getSaudacao();
  return (
    <div className="flex items-center justify-center min-h-[70vh] px-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 p-8 sm:p-10 max-w-lg w-full text-center">

        <div className={`flex justify-center mb-4 ${color}`}>
          <Icon size={40} />
        </div>

        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-1">
          {text}, {userName}!
        </h1>
        <p className="text-emerald-600 font-semibold mb-6">
          Ficamos felizes em ter você no S2Vet
        </p>

        <div className="bg-gray-50 rounded-2xl p-5 text-left mb-8 border border-gray-100 space-y-3">
          <p className="text-gray-500 text-sm mb-3">
            Para liberar todas as funcionalidades, precisamos de duas informações rápidas:
          </p>
          {[
            'Cadastro do seu primeiro animal',
            'Seu cadastro pessoal',
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-7 h-7 bg-emerald-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <span className="text-emerald-700 font-bold text-sm">{i + 1}</span>
              </div>
              <span className="text-sm font-medium text-gray-700">{item}</span>
            </div>
          ))}
        </div>

        <button
          onClick={onStart}
          className="w-full bg-emerald-700 hover:bg-emerald-800 text-white py-4 rounded-2xl font-semibold text-base transition-colors"
        >
          Vamos começar!
        </button>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════
   ONBOARDING — tela 2a: ainda sem animal (voltou sem salvar)
   ═══════════════════════════════════════════════════════════ */
const NeedAnimalScreen = ({ onGo }: { onGo: () => void }) => (
  <div className="flex items-center justify-center min-h-[70vh] px-4">
    <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 p-8 sm:p-10 max-w-lg w-full text-center">

      <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
        <Plus size={28} className="text-emerald-600" />
      </div>

      <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-3">
        Vamos cadastrar seu animal
      </h2>
      <p className="text-gray-500 text-sm leading-relaxed mb-8">
        Para liberar todas as funcionalidades do S2Vet, precisamos que você cadastre pelo menos um animal.
      </p>

      <button
        onClick={onGo}
        className="w-full bg-emerald-700 hover:bg-emerald-800 text-white py-4 rounded-2xl font-semibold transition-colors"
      >
        Cadastrar animal
      </button>
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════════
   ONBOARDING — tela 2b: animal criado, agora cadastro pessoal
   ═══════════════════════════════════════════════════════════ */
const NeedPersonalScreen = ({
  animalNome, onGo,
}: { animalNome: string; onGo: () => void }) => (
  <div className="flex items-center justify-center min-h-[70vh] px-4">
    <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 p-8 sm:p-10 max-w-lg w-full text-center">

      <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-5">
        <CheckCircle2 size={32} className="text-emerald-600" />
      </div>

      <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">
        {animalNome} foi cadastrado!
      </h2>
      <p className="text-gray-500 text-sm leading-relaxed mb-8">
        Agora que você adicionou o primeiro animal, vamos concluir o seu{' '}
        <strong className="text-gray-700">cadastro pessoal</strong> para liberar todas as funcionalidades.
      </p>

      <button
        onClick={onGo}
        className="w-full bg-emerald-700 hover:bg-emerald-800 text-white py-4 rounded-2xl font-semibold transition-colors"
      >
        Concluir cadastro pessoal
      </button>
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════════
   ONBOARDING — tela 3: boas-vindas com features por role
   ═══════════════════════════════════════════════════════════ */
const WelcomeScreen = ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user, onEnter,
}: { user: any; onEnter: () => void }) => {
  const { text, Icon, color } = getSaudacao();
  const features = getRoleFeatures(user?.role);
  const firstName = user?.fullName?.split(' ')[0] ?? 'você';

  return (
    <div className="flex items-center justify-center min-h-[70vh] px-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 p-8 sm:p-10 max-w-lg w-full text-center">

        <div className={`flex justify-center mb-3 ${color}`}>
          <Sparkles size={36} />
        </div>

        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-1">
          Tudo pronto!
        </h1>
        <p className={`font-semibold mb-1 ${color.replace('text-', 'text-')}`}>
          {text}, {firstName}!
        </p>
        <p className="text-gray-400 text-sm mb-6">
          {getRoleLabel(user?.role)}
        </p>

        {/* Features por role */}
        <div className="bg-emerald-50 rounded-2xl p-5 text-left mb-8 border border-emerald-100 space-y-3">
          <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wider mb-3">
            Você tem acesso a:
          </p>
          {features.map((f, i) => (
            <div key={i} className="flex items-start gap-3">
              <CheckCircle2 size={15} className="text-emerald-600 flex-shrink-0 mt-0.5" />
              <span className="text-sm text-gray-700">{f}</span>
            </div>
          ))}
        </div>

        <button
          onClick={onEnter}
          className="w-full bg-emerald-700 hover:bg-emerald-800 text-white py-4 rounded-2xl font-semibold transition-colors"
        >
          Entrar no S2Vet
        </button>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════
   DASHBOARD PRINCIPAL
   ═══════════════════════════════════════════════════════════ */
const Dashboard = () => {
  const { user }                             = useAuth();
  const { selectedAnimal, setSelectedAnimal } = useSelectedAnimal();
  const navigate                              = useNavigate();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [animais, setAnimais]                   = useState<any[]>([]);
  const [loading, setLoading]                   = useState(true);
  const [obPhase, setObPhase]                   = useState<OBPhase>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [animalSelecionado, setAnimalSelecionado] = useState<any | null>(null);

  useEffect(() => {
    if (!user?.id) return;

    const loadAnimais = async () => {
      try {
        const res   = await api.get('/animais');
        const lista = res.data?.dados ?? res.data ?? [];
        setAnimais(lista);

        /* ── Determinar fase do onboarding ── */
        const ob = getOB();

        if (lista.length === 0) {
          // Sem animal: onboarding inicial ou retornou sem salvar
          setObPhase(!ob ? 'greeting' : 'need_animal');
        } else {
          // Com animal: checar se ainda falta etapa
          if (ob === 'p') setObPhase('need_personal');
          else if (ob === 'd') setObPhase('welcome');
          else setObPhase(null); // fluxo normal
        }
      } catch (error) {
        console.error('Erro ao carregar animais:', error);
      } finally {
        setLoading(false);
      }
    };

    loadAnimais();
  }, [user?.id]);

  /* ── Loading ── */
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  /* ── Onboarding: saudação inicial ── */
  if (obPhase === 'greeting') {
    return (
      <GreetingScreen
        userName={user?.fullName?.split(' ')[0] ?? 'você'}
        onStart={() => {
          setOB('a');
          navigate('/animais');
        }}
      />
    );
  }

  /* ── Onboarding: voltou sem criar animal ── */
  if (obPhase === 'need_animal') {
    return <NeedAnimalScreen onGo={() => navigate('/animais')} />;
  }

  /* ── Onboarding: animal criado, falta cadastro pessoal ── */
  if (obPhase === 'need_personal') {
    return (
      <NeedPersonalScreen
        animalNome={animais[0]?.nome ?? 'Seu animal'}
        onGo={() => navigate('/cadastro-pessoal')}
      />
    );
  }

  /* ── Onboarding: boas-vindas finais ── */
  if (obPhase === 'welcome') {
    return (
      <WelcomeScreen
        user={user}
        onEnter={() => {
          clearOB();
          setObPhase(null);
        }}
      />
    );
  }

  /* ══════════════════════════════════════════════════════════
     FLUXO NORMAL (onboarding concluído)
     ══════════════════════════════════════════════════════════ */

  /* Sem animais */
  if (animais.length === 0) {
    return (
      <div className="max-w-2xl mx-auto text-center py-20">
        <div className="w-20 h-20 bg-gray-100 rounded-3xl flex items-center justify-center mx-auto mb-6">
          <Plus size={36} className="text-gray-400" />
        </div>
        <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-3">
          Nenhum animal cadastrado
        </h2>
        <p className="text-gray-500 mb-8">
          Cadastre um animal para começar a usar o sistema.
        </p>
        <button
          onClick={() => navigate('/animais')}
          className="inline-flex items-center gap-3 bg-emerald-700 hover:bg-emerald-800 text-white px-8 py-4 rounded-3xl font-semibold text-lg transition-colors"
        >
          <Plus size={22} />
          Cadastrar Animal
        </button>
      </div>
    );
  }

  /* Animal único — dashboard direto */
  if (animais.length === 1) {
    return <AnimalDashboard animal={animais[0]} onNavigate={navigate} />;
  }

  /* Múltiplos animais — animal selecionado */
  if (animalSelecionado) {
    return (
      <AnimalDashboard
        animal={animalSelecionado}
        onNavigate={navigate}
        onBack={() => setAnimalSelecionado(null)}
      />
    );
  }

  /* Múltiplos animais — lista de seleção */
  return (
    <div className="space-y-6">
      <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Meus Animais</h1>
      <div className="space-y-4">
        {animais.map((animal) => (
          <button
            key={animal.id}
            onClick={() => {
              setSelectedAnimal({ ...animal, photoUrl: animal.photoUrl ?? undefined });
              setAnimalSelecionado(animal);
            }}
            className={`w-full flex items-center bg-white rounded-3xl shadow-sm border transition-all p-4 sm:p-6 text-left ${
              selectedAnimal?.id === animal.id
                ? 'border-emerald-500 shadow-md'
                : 'border-gray-100 hover:shadow-md'
            }`}
          >
            {/* Foto */}
            <div className="w-16 h-16 sm:w-20 sm:h-20 bg-gray-200 rounded-2xl overflow-hidden flex-shrink-0 mr-4 sm:mr-6">
              <img
                src={animal.photoUrl || 'https://picsum.photos/id/1015/400/400'}
                alt={animal.nome}
                className="w-full h-full object-cover"
              />
            </div>

            {/* Nome + Raça */}
            <div className="flex-1 min-w-0">
              <h3 className="text-xl sm:text-2xl font-semibold text-gray-900 truncate">{animal.nome}</h3>
              <p className="text-sm sm:text-base font-medium text-emerald-600 mt-0.5 truncate">
                {animal.raca?.nome || animal.especie?.nome || 'Sem raça definida'}
              </p>
              {animal.categoriaAnimal && (
                <p className="text-xs text-gray-500 mt-0.5 truncate">
                  {animal.categoriaAnimal} · {animal.tipoExercicio}
                </p>
              )}
            </div>

            {/* Info — desktop */}
            <div className="hidden sm:grid grid-cols-4 gap-8 text-center flex-shrink-0 ml-6">
              {[
                { label: 'Espécie',    value: animal.especie?.nome || '-' },
                { label: 'Sexo',       value: animal.sexo || '-'          },
                { label: 'Nascimento', value: animal.dataNascimento ? formatarDataBR(animal.dataNascimento) : '-' },
                { label: 'Idade',      value: idadeDisplay(animal)         },
              ].map(({ label, value }) => (
                <div key={label}>
                  <span className="block text-xs uppercase text-gray-500 tracking-widest">{label}</span>
                  <span className="text-sm font-semibold text-gray-900 mt-1 block">{value}</span>
                </div>
              ))}
            </div>

            {/* Idade + Sexo — mobile */}
            <div className="sm:hidden flex flex-col items-end gap-1 ml-3 flex-shrink-0">
              <span className="text-xs font-semibold text-gray-700">{idadeDisplay(animal)}</span>
              <span className="text-xs text-gray-500">{animal.sexo}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default Dashboard;