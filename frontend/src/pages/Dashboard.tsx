// src/pages/Dashboard.tsx
// Role-aware: VETERINARIO → VetDashboard | USER/ADMIN → dashboard normal

import { useEffect, useState, useCallback } from 'react';
import { useNavigate }              from 'react-router-dom';
import { useAuth }                  from '../contexts/AuthContext';
import { useSelectedAnimal }        from '../contexts/SelectedAnimalContext';
import {
  ClipboardList, Utensils, FlaskConical,
  FileText, ArrowLeft, Sun, Sunset, Moon, Sparkles, CheckCircle2,
} from 'lucide-react';
import api from '../services/api';
import PageContainer   from '../components/PageContainer';
import BotaoVoltar     from '../components/BotaoVoltar';
import FotoAnimal from '../components/FotoAnimal';

// ─── Onboarding ───────────────────────────────────────────────────────────────

const OB_KEY  = 's2vet_ob';
const getOB   = () => localStorage.getItem(OB_KEY);
const setOB   = (v: string) => localStorage.setItem(OB_KEY, v);
const clearOB = () => localStorage.removeItem(OB_KEY);

type OBPhase = 'greeting' | 'need_animal' | 'need_personal' | 'welcome' | null;

const getSaudacao = () => {
  const h = new Date().getHours();
  if (h < 12) return { text: 'Bom dia',   Icon: Sun,    color: 'text-amber-400'  };
  if (h < 18) return { text: 'Boa tarde', Icon: Sunset, color: 'text-orange-400' };
  return       { text: 'Boa noite', Icon: Moon,   color: 'text-indigo-400' };
};

const getRoleFeatures = (role?: string) => {
  const r = role?.toUpperCase();
  if (r === 'ADMIN') return [
    'Gestão completa de animais e usuários',
    'Todos os módulos clínicos e nutricionais',
    'Relatórios avançados e configurações do sistema',
    'Monitoramento de uso de IA',
  ];
  if (r === 'VETERINARIO') return [
    'Dashboard clínico com seus animais',
    'Módulos nutricional e clínico completos',
    'Gestão de equipe e convites',
    'Exames laboratoriais e relatórios',
  ];
  return [
    'Gestão dos seus animais',
    'Acompanhamento de dietas',
    'Visualização de exames e relatórios',
  ];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const calcularIdade = (dn: string): string => {
  const p = dn.split('T')[0].split('-').map(Number);
  const h = new Date();
  let anos  = h.getFullYear() - p[0];
  let meses = h.getMonth() - (p[1] - 1);
  if (meses < 0) { anos--; meses += 12; }
  if (h.getDate() < p[2]) meses--;
  const dias = Math.floor((h.getTime() - new Date(p[0], p[1]-1, p[2]).getTime()) / 86400000);
  if (dias < 30)  return `${dias}d`;
  if (anos === 0) return `${meses} ${meses === 1 ? 'mês' : 'meses'}`;
  return `${anos} ${anos === 1 ? 'ano' : 'anos'}`;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const idadeDisplay = (animal: any): string => {
  if (animal.dataNascimento) return calcularIdade(animal.dataNascimento);
  if (animal.idadeAnos)      return `${animal.idadeAnos} ${animal.idadeAnos === 1 ? 'ano' : 'anos'}`;
  return '-';
};

const formatarDataBR = (data: string | Date | null | undefined): string => {
  if (!data) return '-';
  const d = new Date(data instanceof Date ? data.toISOString() : data);
  if (isNaN(d.getTime())) return '-';
  return `${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${d.getUTCFullYear()}`;
};

// ─── AnimalDashboard ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AnimalDashboard = ({ animal, onNavigate, onBack }: { animal: any; onNavigate: (p: string) => void; onBack?: () => void }) => {
  const atalhos = [
    { label: 'Dieta',      icon: Utensils,     path: `/dieta/${animal.id}`                 },
    { label: 'Exames',     icon: FlaskConical,  path: `/exames/${animal.id}`                },
    { label: 'Relatório',  icon: FileText,      path: `/relatorio-nutricional/${animal.id}` },
    { label: 'Prontuário', icon: ClipboardList, path: `/animal/${animal.id}`                },
  ];

  return (
    <div className="space-y-6">
      {onBack && (
        <button onClick={onBack} className="flex items-center gap-2 text-emerald-700 hover:text-emerald-800 font-medium">
          <ArrowLeft size={20} /> <span className="text-sm">Todos os animais</span>
        </button>
      )}
      <div className="bg-white rounded-3xl shadow-md border border-gray-100 overflow-hidden">
        <div className="flex flex-col sm:flex-row">
          <div className="w-full sm:w-56 h-48 sm:h-auto bg-gray-200 flex-shrink-0">
            <FotoAnimal url={animal.photoUrl} nome={animal.nome} iconSize={48} animalId={animal.id} />
          </div>
          <div className="flex-1 p-6 sm:p-8">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900">{animal.nome}</h2>
            <p className="text-lg text-emerald-600 font-medium mt-1">
              {animal.raca?.nome || animal.especie?.nome || 'Sem raça definida'}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
              {[
                { l:'Espécie',    v: animal.especie?.nome },
                { l:'Sexo',       v: animal.sexo },
                { l:'Nascimento', v: formatarDataBR(animal.dataNascimento) },
                { l:'Idade',      v: idadeDisplay(animal) },
                { l:'Peso',       v: animal.peso ? `${animal.peso} kg` : '-' },
                { l:'Perfil NRC', v: animal.categoriaAnimal ? `${animal.categoriaAnimal} · ${animal.tipoExercicio}` : 'Não informado' },
                ...(animal.baia  ? [{ l: 'Baia',  v: animal.baia  }] : []),
                ...(animal.local ? [{ l: 'Local', v: animal.local }] : []),
              ].map(({ l, v }) => (
                <div key={l}>
                  <span className="block text-xs uppercase text-gray-500 tracking-widest mb-1">{l}</span>
                  <span className="text-base font-semibold text-gray-900">{v || '-'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {atalhos.map(({ label, icon: Icon, path }) => (
          <button key={label} onClick={() => onNavigate(path)}
            className="bg-white rounded-2xl shadow-sm border border-gray-100 hover:shadow-md hover:border-emerald-200 transition-all p-5 flex flex-col items-center gap-3">
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

// ─── Onboarding screens ───────────────────────────────────────────────────────

const GreetingScreen = ({ userName, onStart }: { userName: string; onStart: () => void }) => {
  const { text, Icon, color } = getSaudacao();
  return (
    <div className="flex items-center justify-center min-h-[70vh] px-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 p-8 sm:p-10 max-w-lg w-full text-center">
        <div className={`flex justify-center mb-4 ${color}`}><Icon size={40} /></div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-1">{text}, {userName}!</h1>
        <p className="text-emerald-600 font-semibold mb-6">Ficamos felizes em ter você no S2Vet</p>
        <div className="bg-gray-50 rounded-2xl p-5 text-left mb-8 border border-gray-100 space-y-3">
          <p className="text-gray-500 text-sm mb-3">Para liberar todas as funcionalidades, precisamos de duas informações rápidas:</p>
          {['Seu cadastro pessoal','Cadastro do seu primeiro animal (se proprietário)'].map((item, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-7 h-7 bg-emerald-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <span className="text-emerald-700 font-bold text-sm">{i + 1}</span>
              </div>
              <span className="text-sm font-medium text-gray-700">{item}</span>
            </div>
          ))}
        </div>
        <button onClick={onStart} className="w-full bg-emerald-700 hover:bg-emerald-800 text-white py-4 rounded-2xl font-semibold transition-colors">
          Vamos começar!
        </button>
      </div>
    </div>
  );
};

const NeedAnimalScreen = ({ onGo }: { onGo: () => void }) => (
  <div className="flex items-center justify-center min-h-[70vh] px-4">
    <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 p-8 sm:p-10 max-w-lg w-full text-center">
      <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-3">Vamos cadastrar seu animal</h2>
      <p className="text-gray-500 text-sm leading-relaxed mb-8">Para liberar todas as funcionalidades, cadastre pelo menos um animal.</p>
      <button onClick={onGo} className="w-full bg-emerald-700 hover:bg-emerald-800 text-white py-4 rounded-2xl font-semibold transition-colors">
        Cadastrar animal
      </button>
    </div>
  </div>
);

const NeedPersonalScreen = ({ animalNome, onGo }: { animalNome: string; onGo: () => void }) => (
  <div className="flex items-center justify-center min-h-[70vh] px-4">
    <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 p-8 sm:p-10 max-w-lg w-full text-center">
      <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-5">
        <CheckCircle2 size={32} className="text-emerald-600" />
      </div>
      <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">{animalNome} foi cadastrado!</h2>
      <p className="text-gray-500 text-sm leading-relaxed mb-8">
        Agora vamos concluir o seu <strong className="text-gray-700">cadastro pessoal</strong>.
      </p>
      <button onClick={onGo} className="w-full bg-emerald-700 hover:bg-emerald-800 text-white py-4 rounded-2xl font-semibold transition-colors">
        Concluir cadastro pessoal
      </button>
    </div>
  </div>
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const WelcomeScreen = ({ user, onEnter }: { user: any; onEnter: () => void }) => {
  const { text, color } = getSaudacao();
  const features  = getRoleFeatures(user?.role);
  const firstName = user?.fullName?.split(' ')[0] ?? 'você';
  return (
    <div className="flex items-center justify-center min-h-[70vh] px-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 p-8 sm:p-10 max-w-lg w-full text-center">
        <div className={`flex justify-center mb-3 ${color}`}><Sparkles size={36} /></div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-1">Tudo pronto!</h1>
        <p className={`font-semibold mb-6 ${color}`}>{text}, {firstName}!</p>
        <div className="bg-emerald-50 rounded-2xl p-5 text-left mb-8 border border-emerald-100 space-y-3">
          <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wider mb-3">Você tem acesso a:</p>
          {features.map((f, i) => (
            <div key={i} className="flex items-start gap-3">
              <CheckCircle2 size={15} className="text-emerald-600 flex-shrink-0 mt-0.5" />
              <span className="text-sm text-gray-700">{f}</span>
            </div>
          ))}
        </div>
        <button onClick={onEnter} className="w-full bg-emerald-700 hover:bg-emerald-800 text-white py-4 rounded-2xl font-semibold transition-colors">
          Entrar no S2Vet
        </button>
      </div>
    </div>
  );
};

// ─── Main Dashboard ───────────────────────────────────────────────────────────

const Dashboard = () => {
  const { user }                              = useAuth();
  const { selectedAnimal, setSelectedAnimal } = useSelectedAnimal();
  const navigate                              = useNavigate();

  // ── FIX: checar role E userType — JWT pode ter role='USER' para vets ─────
  const role          = (user?.role      ?? '').toUpperCase();
  const userTypeUpper = (user?.userType  ?? '').toUpperCase();
  const isVet         = role === 'VETERINARIO' || userTypeUpper === 'VETERINARIO';
  const isClinica     = isVet || role === 'ESTAGIARIO' || userTypeUpper === 'ESTAGIARIO';
  const isConvidado   = user?.isConvidado === true;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [animais,           setAnimais]           = useState<any[]>([]);
  const [loading,           setLoading]           = useState(true);
  const [obPhase,           setObPhase]           = useState<OBPhase>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [animalSelecionado, setAnimalSelecionado] = useState<any | null>(null);

  const loadAnimais = useCallback(async () => {
    try {
      const res   = await api.get('/animais');
      const lista = res.data?.dados ?? res.data ?? [];
      setAnimais(lista);

      // Onboarding ("Vamos cadastrar seu animal") é exclusivo do PROPRIETÁRIO —
      // demais perfis (vet, fornecedor, gestor, convidado, admin) vão direto ao dashboard
      if (isConvidado || role === 'ADMIN' || userTypeUpper !== 'PROPRIETARIO') {
        setObPhase(null);
      } else {
        const ob = getOB();
        if (!ob) {
          // Usuário com animais → onboarding já concluído
          if (lista.length > 0) {
            setObPhase(null);
          } else {
            try {
              const perfilRes      = await api.get('/users/me');
              const perfil         = perfilRes.data;
              const perfilCompleto = !!(perfil?.phone && perfil?.fullName?.trim());
              setObPhase(perfilCompleto ? 'need_animal' : 'greeting');
            } catch {
              setObPhase('greeting');
            }
          }
        } else if (ob === 'a') {
          setObPhase(lista.length === 0 ? 'need_animal' : 'welcome');
        } else if (ob === 'd') {
          setObPhase('welcome');
        } else {
          setObPhase(null);
        }
      }
    } catch (err) {
      console.error('[Dashboard.loadAnimais]', err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConvidado, role, userTypeUpper]);

  useEffect(() => {
    if (isClinica || role === 'ADMIN') {
      navigate('/painel-principal', { replace: true });
      return;
    }
    loadAnimais();
  }, [isClinica, role, loadAnimais, navigate]);

  // ── Veterinário / Estagiário / Admin → aguarda redirect do useEffect ─────
  if (isClinica || role === 'ADMIN') return null;

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full" />
    </div>
  );

  // ── Onboarding ────────────────────────────────────────────────────────────
  if (obPhase === 'greeting') return (
    <GreetingScreen
      userName={user?.fullName?.split(' ')[0] ?? 'você'}
      onStart={() => { setOB('p'); navigate('/cadastro-pessoal'); }} />
  );
  if (obPhase === 'need_animal')   return <NeedAnimalScreen onGo={() => navigate('/animais')} />;
  if (obPhase === 'need_personal') return (
    <NeedPersonalScreen
      animalNome={animais[0]?.nome ?? 'Seu animal'}
      onGo={() => navigate('/cadastro-pessoal')} />
  );
  if (obPhase === 'welcome') return (
    <WelcomeScreen user={user} onEnter={() => { clearOB(); setObPhase(null); }} />
  );

  // ── Estado vazio ──────────────────────────────────────────────────────────
  if (animais.length === 0) return (
    <PageContainer>
      <BotaoVoltar className="mb-6" />
      <div className="max-w-2xl mx-auto text-center py-20">
      {isConvidado ? (
        <>
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-3">Nenhum animal encontrado</h2>
          <p className="text-gray-500">Ainda não há animais cadastrados na clínica.</p>
        </>
      ) : (
        <>
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-3">Nenhum animal cadastrado</h2>
          <p className="text-gray-500 mb-8">Cadastre um animal para começar a usar o sistema.</p>
          <button onClick={() => navigate('/animais')}
            className="inline-flex items-center gap-3 bg-emerald-700 hover:bg-emerald-800 text-white px-8 py-4 rounded-3xl font-semibold text-lg transition-colors">
            Cadastrar Animal
          </button>
        </>
      )}
    </div>
    </PageContainer>
  );

  // ── Animal único → mostra direto ──────────────────────────────────────────
  if (animais.length === 1) return (
    <PageContainer maxWidth="7xl">
      <BotaoVoltar className="mb-6" />
      <AnimalDashboard animal={animais[0]} onNavigate={navigate} />
    </PageContainer>
  );

  // ── Animal selecionado na lista ───────────────────────────────────────────
  if (animalSelecionado) return (
    <PageContainer maxWidth="7xl">
      <BotaoVoltar className="mb-6" />
      <AnimalDashboard
        animal={animalSelecionado}
        onNavigate={navigate}
        onBack={() => setAnimalSelecionado(null)} />
    </PageContainer>
  );

  // ── Lista de animais ──────────────────────────────────────────────────────
  return (
    <PageContainer maxWidth="7xl">
      <BotaoVoltar className="mb-6" />
      <div className="space-y-6">
      <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
        {isConvidado ? 'Animais da Clínica' : 'Meus Animais'}
      </h1>
      <div className="space-y-4">
        {animais.map(animal => (
          <button key={animal.id}
            onClick={() => {
              setSelectedAnimal({ ...animal, photoUrl: animal.photoUrl ?? undefined });
              setAnimalSelecionado(animal);
            }}
            className={`w-full flex items-center bg-white rounded-3xl shadow-sm border transition-all p-4 sm:p-6 text-left ${
              selectedAnimal?.id === animal.id ? 'border-emerald-500 shadow-md' : 'border-gray-100 hover:shadow-md'
            }`}>
            <div className="w-16 h-16 sm:w-20 sm:h-20 bg-gray-200 rounded-2xl overflow-hidden flex-shrink-0 mr-4 sm:mr-6">
              <FotoAnimal url={animal.photoUrl} nome={animal.nome} iconSize={26} animalId={animal.id} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-xl sm:text-2xl font-semibold text-gray-900 truncate">{animal.nome}</h3>
              <p className="text-sm sm:text-base font-medium text-emerald-600 mt-0.5 truncate">
                {animal.raca?.nome || animal.especie?.nome || 'Sem raça definida'}
              </p>
            </div>
            <div className="hidden sm:grid grid-cols-4 gap-8 text-center flex-shrink-0 ml-6">
              {[
                { l: 'Espécie',    v: animal.especie?.nome || '-'   },
                { l: 'Sexo',       v: animal.sexo || '-'            },
                { l: 'Nascimento', v: formatarDataBR(animal.dataNascimento) },
                { l: 'Idade',      v: idadeDisplay(animal)          },
                ...(animal.baia  ? [{ l: 'Baia',  v: animal.baia  }] : []),
                ...(animal.local ? [{ l: 'Local', v: animal.local }] : []),
              ].map(({ l, v }) => (
                <div key={l}>
                  <span className="block text-xs uppercase text-gray-500 tracking-widest">{l}</span>
                  <span className="text-sm font-semibold text-gray-900 mt-1 block">{v}</span>
                </div>
              ))}
            </div>
            <div className="sm:hidden flex flex-col items-end gap-1 ml-3 flex-shrink-0">
              <span className="text-xs font-semibold text-gray-700">{idadeDisplay(animal)}</span>
              <span className="text-xs text-gray-500">{animal.sexo}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
    </PageContainer>
  );
};

export default Dashboard;