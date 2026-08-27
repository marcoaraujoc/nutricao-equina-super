// src/pages/Vacina.tsx
// Tela APARTADA de Vacinas (/clinica/vacina[/:animalId]).
//
// A vacina saiu de dentro do shell de Atendimento a pedido: clicar em "Vacina" abre a
// tela própria, sem a barra de abas e sem o painel de histórico lateral.
//
// O que ela mantém do shell, porque não é decoração:
//  • o PACIENTE (seletor + card) — a vacina é sempre de um animal;
//  • a EVOLUÇÃO EM ANDAMENTO — `evolucaoId` é o que amarra a vacina ao atendimento
//    aberto. Sem buscar isso aqui, toda vacina registrada por esta tela nasceria solta
//    do atendimento e sumiria do histórico daquele AG-XXXX.

import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { Syringe } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import { useEmpresa } from '../contexts/EmpresaContext';
import { usePermissoes } from '../hooks/usePermissoes';
import api from '../services/api';
import AnimalCard from '../components/AnimalCard';
import BotaoVoltar from '../components/BotaoVoltar';
import PageContainer from '../components/PageContainer';
import SeletorAnimalInteligente from '../components/SeletorAnimalInteligente';
import SubModuloVacina from './SubModuloVacina';
import { escolherEvolucaoAtiva, lerEvolucaoSelecionada } from '../utils/evolucaoAtiva';

type SelectedAnimal = NonNullable<ReturnType<typeof useSelectedAnimal>['selectedAnimal']>;

type AnimalExtended = SelectedAnimal & {
  dataNascimento?: string | Date | null;
  idadeAnos?:      number | null;
  baia?:           string | null;
  raca?:           { nome: string } | null;
  user?:           { fullName: string; email: string } | null;
  logoUrl?:        string | null;
};

interface EvolucaoAtiva {
  id:                number;
  atendimentoNumero: string | null;
  veterinarioId:     number | null;
  agendamentoId?:    number | null;
}

export default function Vacina() {
  const { animalId: animalIdParam } = useParams<{ animalId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { selectedAnimal, setSelectedAnimal, refreshSelectedAnimal } = useSelectedAnimal();
  const { loading: empresaLoading, contextoAtivo } = useEmpresa();
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();

  const effectiveAnimalId = animalIdParam || (selectedAnimal?.id ? String(selectedAnimal.id) : '');

  const [animal,        setAnimal]        = useState<AnimalExtended | null>(null);
  const [todosAnimais,  setTodosAnimais]  = useState<AnimalExtended[]>([]);
  const [carregandoLista, setCarregandoLista] = useState(true);
  const [evolucaoAtiva, setEvolucaoAtiva] = useState<EvolucaoAtiva | null>(null);

  // Item a abrir ao chegar pelo Histórico do Paciente (o shell navega para cá com
  // `?item=`, já que o estado dele não sobrevive à troca de tela).
  const itemParam = new URLSearchParams(location.search).get('item');
  const [openItemId, setOpenItemId] = useState<number | null>(itemParam ? Number(itemParam) : null);
  useEffect(() => { setOpenItemId(itemParam ? Number(itemParam) : null); }, [itemParam]);

  const carregarAnimal = useCallback(async () => {
    if (!effectiveAnimalId) return;
    try {
      const res = await api.get(`/animais/${effectiveAnimalId}`);
      // GET 403 → data null: id de OUTRA empresa (link antigo/troca de contexto).
      // Larga o id da URL e cai no paciente do contexto ativo — mesmo tratamento do
      // shell de Atendimento, senão a tela fica batendo 403 nesse id.
      if (!res.data) {
        if (animalIdParam) navigate('/clinica/vacina', { replace: true });
        else await refreshSelectedAnimal();
        return;
      }
      const a = (res.data?.dados ?? res.data) as AnimalExtended;
      setAnimal(a);
      setSelectedAnimal(a);
    } catch { /* silencioso — o card apenas não aparece */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveAnimalId, animalIdParam, refreshSelectedAnimal]);

  const carregarEvolucaoAtiva = useCallback(async () => {
    if (!effectiveAnimalId) { setEvolucaoAtiva(null); return; }
    try {
      // limit=20 (era 1): com atendimento em PARALELO o animal pode ter mais de uma
      // evolução aberta. Quem decide qual é a de agora é `escolherEvolucaoAtiva`, a
      // MESMA regra do shell de Atendimento (fonte única em utils/evolucaoAtiva.ts) —
      // inclusive a ESCOLHA que o usuário fez no banner de lá, que chega por
      // localStorage: esta tela é apartada, então o estado do shell não a alcança.
      // Sem isso, a vacina nasceria vinculada a um atendimento diferente daquele em
      // que a prescrição do mesmo paciente acabou de ser lançada.
      const res = await api.get(`/clinica/evolucoes/animal/${effectiveAnimalId}?status=EM_ANDAMENTO&limit=20&page=1`);
      const dados: {
        id: number; veterinarioId?: number | null; atendimentoNumero?: string | null;
        agendamentoId?: number | null;
      }[] = res.data?.dados ?? [];
      const agendamentoCtx = localStorage.getItem(`s2vet_ag_${effectiveAnimalId}`);
      const ev = escolherEvolucaoAtiva(
        dados.map(e => ({
          id:                e.id,
          atendimentoNumero: e.atendimentoNumero ?? null,
          veterinarioId:     e.veterinarioId ?? null,
          agendamentoId:     e.agendamentoId ?? null,
        })),
        {
          selecionadaId: lerEvolucaoSelecionada(effectiveAnimalId),
          agendamentoId: agendamentoCtx ? Number(agendamentoCtx) : null,
          meuUserId:     user?.id ?? null,
        },
      );
      setEvolucaoAtiva(ev);
    } catch { /* silencioso */ }
  }, [effectiveAnimalId, user?.id]);

  // ⚠️ DEPENDER SÓ DE [effectiveAnimalId, loadingPerms] — nunca das funções.
  // `setSelectedAnimal` e `refreshSelectedAnimal` do SelectedAnimalContext NÃO são
  // `useCallback`: mudam de identidade a cada render do provider. Como `carregarAnimal`
  // chama `setSelectedAnimal`, pô-la nas dependências fecha o ciclo
  //   efeito → GET /animais/:id → setSelectedAnimal → provider re-renderiza →
  //   nova identidade → efeito de novo
  // e a tela dispara requisições sem parar até estourar o rate limit (429).
  // Mesmo motivo do eslint-disable equivalente em Atendimento.tsx.
  useEffect(() => {
    if (loadingPerms) return;   // não bate na API antes das permissões (evita 403)
    carregarAnimal();
    carregarEvolucaoAtiva();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveAnimalId, loadingPerms]);

  // Lista de pacientes do seletor. ESPERA o contexto ativo resolver — sem os headers
  // x-empresa-id/x-equipe-id a busca volta do fallback do backend (outra empresa).
  useEffect(() => {
    if (empresaLoading) return;
    setCarregandoLista(true);
    api.get('/animais')
      .then(res => setTodosAnimais(res.data?.dados ?? []))
      .catch(() => {})
      .finally(() => setCarregandoLista(false));
  }, [empresaLoading, contextoAtivo?.empresaId, contextoAtivo?.equipeId]);

  // Sem paciente na URL nem selecionado, adota o primeiro da lista — a tela precisa
  // ser utilizável logo após o login, sem obrigar a mexer no seletor antes.
  // `setSelectedAnimal` fora das dependências pelo mesmo motivo acima (identidade
  // instável). O guard do `effectiveAnimalId` já impede repetir a seleção.
  useEffect(() => {
    if (effectiveAnimalId || empresaLoading || carregandoLista) return;
    if (todosAnimais.length > 0) setSelectedAnimal(todosAnimais[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveAnimalId, empresaLoading, carregandoLista, todosAnimais]);

  if (!loadingPerms && !isGestor && !podeExecutar('atendimento.vacinas.ler')) {
    return (
      <PageContainer>
        <div className="text-center py-16">
          <h2 className="text-lg font-semibold text-gray-700 mb-2">Acesso não autorizado</h2>
          <p className="text-sm text-gray-500">Você não tem permissão para visualizar vacinas.</p>
        </div>
      </PageContainer>
    );
  }

  const animalIdNum = effectiveAnimalId ? Number(effectiveAnimalId) : 0;

  return (
    <PageContainer>
      <BotaoVoltar className="mb-4" />

      <div className="mt-2 mb-4 flex items-center gap-3">
        <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0">
          <Syringe size={20} className="text-emerald-700" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vacinas</h1>
          <p className="text-sm text-gray-500 mt-0.5">Registro e histórico vacinal do paciente.</p>
        </div>
      </div>

      <SeletorAnimalInteligente
        animais={todosAnimais}
        animalAtual={animal}
        onSelecionar={(a) => { setSelectedAnimal(a); navigate(`/clinica/vacina/${a.id}`); }}
      />

      {animal && <AnimalCard animal={animal} />}

      <div className="mt-4 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <SubModuloVacina
          animalId={animalIdNum}
          animal={animal}
          evolucaoId={evolucaoAtiva?.id}
          atendimentoNumero={evolucaoAtiva?.atendimentoNumero ?? undefined}
          openItemId={openItemId ?? undefined}
          onViewConsumed={() => setOpenItemId(null)}
        />
      </div>
    </PageContainer>
  );
}
