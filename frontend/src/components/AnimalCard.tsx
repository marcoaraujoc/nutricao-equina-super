// src/components/AnimalCard.tsx
// Componente compartilhado — usado em Dieta, EvolucaoClinica, Exames.
// Clicar no card abre o Detalhamento do Animal (/animal/:id) quando `id` está presente.

import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import FotoAnimal from './FotoAnimal';

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface AnimalCardAnimal {
  id?:              number;
  nome:             string;
  photoUrl?:        string | null;
  dataNascimento?:  string | Date | null;
  idadeAnos?:       number | null;
  peso?:            number | null;
  tipoExercicio?:   string | null;
  baia?:            string | null;
  local?:           string | null;
  raca?:            { nome: string } | null;
  especie?:         { nome: string } | null;
  user?:            { fullName: string; email: string } | null;
  veterinarioNome?: string | null;
}

interface AnimalCardProps {
  animal: AnimalCardAnimal;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function calcularIdade(dataNascimento: string): string {
  const partes   = dataNascimento.split('T')[0].split('-');
  const anoNasc  = parseInt(partes[0]);
  const mesNasc  = parseInt(partes[1]) - 1;
  const diaNasc  = parseInt(partes[2]);
  const hoje     = new Date();
  const diffMs   = hoje.getTime() - new Date(anoNasc, mesNasc, diaNasc).getTime();
  const diffDias = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  let diffMeses = (hoje.getFullYear() - anoNasc) * 12 + (hoje.getMonth() - mesNasc);
  if (hoje.getDate() < diaNasc) diffMeses--;

  let diffAnos = hoje.getFullYear() - anoNasc;
  if (
    hoje.getMonth() < mesNasc ||
    (hoje.getMonth() === mesNasc && hoje.getDate() < diaNasc)
  ) diffAnos--;

  if (diffDias < 30)  return `${diffDias} ${diffDias === 1 ? 'dia' : 'dias'}`;
  if (diffMeses < 12) return `${diffMeses} ${diffMeses === 1 ? 'mês' : 'meses'}`;
  return `${diffAnos} ${diffAnos === 1 ? 'ano' : 'anos'}`;
}

// ─── Componente ──────────────────────────────────────────────────────────────

export default function AnimalCard({ animal }: AnimalCardProps) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const abrirDetalhamento = () => {
    if (animal.id) navigate(`/animal/${animal.id}`);
  };

  // Vet responsável: campo do próprio animal.
  //
  // ⚠️ FASE 3 DO MULTI-TENANCY — aqui havia a resolução por `VetAnimalSolicitacao`
  // (VINCULO ACEITO → vet ativo; DESVINCULO/TROCA_VET PENDENTE → vet ainda ativo) e o
  // selo âmbar pulsante "aguardando o vet aceitar entrar". Nada disso existe mais: não
  // há pedido de acesso a paciente, então não há estado intermediário — o campo tem
  // nome ou está vazio.
  const vetNome = animal.veterinarioNome ?? null;

  // Proprietário: prioriza dados do animal (join), fallback para usuário logado
  const proprietarioNome = animal.user?.fullName ?? user?.fullName ?? '-';

  const idade = animal.dataNascimento
    ? calcularIdade(String(animal.dataNascimento))
    : animal.idadeAnos
      ? `${animal.idadeAnos} ${animal.idadeAnos === 1 ? 'ano' : 'anos'}`
      : '-';

  return (
    <div
      onClick={abrirDetalhamento}
      title={animal.id ? 'Abrir detalhamento do animal' : undefined}
      className={`w-full bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex gap-4 mb-4 ${
        animal.id ? 'cursor-pointer hover:border-emerald-200 hover:shadow-md transition-all' : ''
      }`}>

      {/* Foto — sem foto cadastrada, o ícone de paciente (nunca uma imagem de banco
          de imagens: o `picsum` que estava aqui mostrava o cavalo de outra pessoa
          como se fosse o do cliente). */}
      <div className="w-24 h-24 rounded-2xl overflow-hidden flex-shrink-0 bg-gray-100 border border-gray-100">
        <FotoAnimal url={animal.photoUrl} nome={animal.nome} iconSize={28} animalId={animal.id} />
      </div>

      {/* Info MOBILE (< md): nome completo na 1ª linha; Idade, Peso e Baia na 2ª */}
      <div className="flex md:hidden flex-col flex-1 min-w-0 gap-y-3">
        <div>
          <span className="block text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Nome</span>
          <span className="text-sm text-gray-900 block">{animal.nome}</span>
        </div>
        <div className="grid grid-cols-3 gap-x-4 gap-y-2">
          <div>
            <span className="block text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Idade</span>
            <span className="text-sm text-gray-900 block">{idade}</span>
          </div>
          <div>
            <span className="block text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Peso</span>
            <span className="text-sm text-gray-900 block">{animal.peso != null ? `${animal.peso} kg` : '-'}</span>
          </div>
          <div>
            <span className="block text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Baia</span>
            <span className="text-sm text-gray-900 truncate block">{animal.baia ?? '-'}</span>
          </div>
        </div>
      </div>

      {/* Info DESKTOP (>= md): 2 linhas fixas com 5 colunas cada */}
      <div className="hidden md:flex flex-col flex-1 min-w-0 gap-y-3">

        {/* Linha 1: identificação */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-6 gap-y-2">
          <div>
            <span className="block text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Nome</span>
            <span className="text-sm text-gray-900 truncate block">{animal.nome}</span>
          </div>
          <div>
            <span className="block text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Espécie</span>
            <span className="text-sm text-gray-900 truncate block">{animal.especie?.nome ?? '-'}</span>
          </div>
          <div>
            <span className="block text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Raça</span>
            <span className="text-sm text-gray-900 truncate block">{animal.raca?.nome ?? '-'}</span>
          </div>
          <div>
            <span className="block text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Idade</span>
            <span className="text-sm text-gray-900 block">{idade}</span>
          </div>
          <div>
            <span className="block text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Peso</span>
            <span className="text-sm text-gray-900 block">{animal.peso != null ? `${animal.peso} kg` : '-'}</span>
          </div>
        </div>

        {/* Divisor */}
        <div className="border-t border-gray-100" />

        {/* Linha 2: localização + responsáveis */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-6 gap-y-2">
          <div>
            <span className="block text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Baia</span>
            <span className="text-sm text-gray-900 truncate block">{animal.baia ?? '-'}</span>
          </div>
          <div>
            <span className="block text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Local</span>
            <span className="text-sm text-gray-900 truncate block">{animal.local ?? '-'}</span>
          </div>
          <div>
            <span className="block text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Tipo de Trabalho</span>
            <span className="text-sm text-gray-900 truncate block">{animal.tipoExercicio ?? '-'}</span>
          </div>
          <div>
            <span className="block text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Proprietário</span>
            <span className="text-sm text-gray-900 truncate block">{proprietarioNome}</span>
          </div>
          {/* Veterinário Responsável — só aparece quando há um associado */}
          {vetNome && (
            <div>
              <span className="block text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Vet. Responsável</span>
              <span className="text-sm text-gray-900 truncate block">{vetNome}</span>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}