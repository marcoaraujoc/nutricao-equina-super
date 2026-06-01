// src/components/AnimalCard.tsx
// Componente compartilhado — usado em Dieta, EvolucaoClinica, Exames

import { useAuth } from '../contexts/AuthContext';

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface Solicitacao {
  vetUserId:   number;
  tipo:        string; // 'VINCULO' | 'DESVINCULO' | 'TROCA_VET'
  status:      string; // 'ACEITO' | 'PENDENTE' | 'RECUSADO' | 'CANCELADO'
  veterinario?: { fullName: string; email: string } | null;
}

interface AnimalCardAnimal {
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
  // Relação via VetAnimalSolicitacao — agora inclui PENDENTE além de ACEITO
  solicitacoes?:    Solicitacao[];
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

  // Resolve vet responsável:
  //   VINCULO ACEITO → vet ativo
  //   DESVINCULO PENDENTE → vet ainda ativo (aguardando proprietário aceitar saída)
  //   TROCA_VET PENDENTE  → vet ainda ativo (aguardando vet antigo aceitar troca)
  // "Aguardando" badge: apenas VINCULO PENDENTE (vet ainda não aceitou entrar)
  const solicitacaoAceita = animal.solicitacoes?.find(s =>
    (s.tipo === 'VINCULO'    && s.status === 'ACEITO')  ||
    (s.tipo === 'DESVINCULO' && s.status === 'PENDENTE') ||
    (s.tipo === 'TROCA_VET'  && s.status === 'PENDENTE')
  );
  const solicitacaoPendente = animal.solicitacoes?.find(s =>
    s.tipo === 'VINCULO' && s.status === 'PENDENTE'
  );
  const vetNome     = solicitacaoAceita?.veterinario?.fullName ?? animal.veterinarioNome ?? null;
  const vetPendente = solicitacaoPendente?.veterinario?.fullName ?? null;

  // Proprietário: prioriza dados do animal (join), fallback para usuário logado
  const proprietarioNome = animal.user?.fullName ?? user?.fullName ?? '-';

  const idade = animal.dataNascimento
    ? calcularIdade(String(animal.dataNascimento))
    : animal.idadeAnos
      ? `${animal.idadeAnos} ${animal.idadeAnos === 1 ? 'ano' : 'anos'}`
      : '-';

  return (
    <div className="w-full bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex gap-4 mb-4">

      {/* Foto */}
      <div className="w-24 h-24 rounded-2xl overflow-hidden flex-shrink-0 bg-gray-100 border border-gray-100">
        <img
          src={animal.photoUrl ?? 'https://picsum.photos/id/1015/80/80'}
          alt={animal.nome}
          className="w-full h-full object-cover"
        />
      </div>

      {/* Info — 2 linhas fixas com 5 colunas cada no desktop */}
      <div className="flex flex-col flex-1 min-w-0 gap-y-3">

        {/* Linha 1: identificação */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-6 gap-y-2">
          <div>
            <span className="block text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Nome</span>
            <span className="text-sm font-semibold text-gray-900 truncate block">{animal.nome}</span>
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
          {/* Veterinário Responsável */}
          <div>
            <span className="block text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Vet. Responsável</span>
            {vetNome ? (
              <span className="text-sm text-gray-900 truncate block">{vetNome}</span>
            ) : vetPendente ? (
              <span className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-medium">
                <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse flex-shrink-0" />
                {vetPendente}
              </span>
            ) : (
              <span className="text-sm text-gray-400 italic block">Não atribuído</span>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}