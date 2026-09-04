// src/pages/MeusAnimais.tsx
//
// ⚠️ FASE 3 DO MULTI-TENANCY — a tela deixou de ter estados de VÍNCULO.
// Saíram daqui: a interface `Solicitacao`, os selos "Pendente"/"Remoção pendente"/
// "Troca pendente", o banner de aguardo, o cartão acinzentado (`opacity-80`), os botões
// Autorizar/Recusar/Aceitar remoção/Manter vínculo e o modal de cancelar solicitação.
//
// POR QUÊ: não existe mais pedir nem aprovar acesso a paciente. O animal pertence à
// EMPRESA, e quem trabalha nela o enxerga — logo não há estado intermediário para
// exibir. Com o vínculo, o cartão ficava BLOQUEADO enquanto pendente (`!pendente &&
// handleEdit`); agora todo animal da lista é operável.
//
// NÃO reintroduzir: qualquer "aguardando aprovação" aqui volta a acoplar o acesso ao
// paciente a uma negociação entre pessoas, que é justamente o que a fase 3 encerrou.
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import { usePermissoes } from '../hooks/usePermissoes';
import api from '../services/api';
import toast from 'react-hot-toast';
import { Pencil, Trash2, MapPin, Search } from 'lucide-react';
import PageContainer from '../components/PageContainer';
import ModalJustificativa from '../components/ModalJustificativa';
import { MOTIVOS_INATIVACAO_ANIMAL } from '../utils/motivosInativacao';
import InlineError from '../components/InlineError';
import { type ErroAcaoDados } from '../components/ErroAcao';
import FotoAnimal from '../components/FotoAnimal';


interface Animal {
  id:               number;
  nome:             string;
  sexo:             string;
  peso:             number;
  local?:           string | null;
  photoUrl?:        string | null;
  dataNascimento?:  string | null;
  idadeAnos?:       number | null;
  categoriaAnimal?: string | null;
  tipoExercicio?:   string | null;
  raca?:            { nome: string } | null;
}

const calcularIdade = (dataNascimento: string): string => {
  const partes  = dataNascimento.split('T')[0].split('-');
  const anoNasc = parseInt(partes[0]);
  const mesNasc = parseInt(partes[1]) - 1;
  const diaNasc = parseInt(partes[2]);
  const hoje    = new Date();
  const nasc    = new Date(anoNasc, mesNasc, diaNasc);
  const dias    = Math.floor((hoje.getTime() - nasc.getTime()) / 86400000);
  let meses     = (hoje.getFullYear() - anoNasc) * 12 + (hoje.getMonth() - mesNasc);
  if (hoje.getDate() < diaNasc) meses--;
  let anos = hoje.getFullYear() - anoNasc;
  if (hoje.getMonth() < mesNasc || (hoje.getMonth() === mesNasc && hoje.getDate() < diaNasc)) anos--;
  if (dias < 30)  return `${dias} ${dias === 1 ? 'dia' : 'dias'}`;
  if (meses < 12) return `${meses} ${meses === 1 ? 'mês' : 'meses'}`;
  return `${anos} ${anos === 1 ? 'ano' : 'anos'}`;
};

const idadeDisplay = (animal: Animal): string => {
  if (animal.dataNascimento) return calcularIdade(animal.dataNascimento);
  if (animal.idadeAnos)      return `${animal.idadeAnos} ${animal.idadeAnos === 1 ? 'ano' : 'anos'}`;
  return '-';
};

const MeusAnimais = () => {
  const { user }                                     = useAuth();
  const { setSelectedAnimal, refreshSelectedAnimal } = useSelectedAnimal();
  const navigate                                     = useNavigate();
  const { podeExecutar, loading: loadingPerms }      = usePermissoes();
  const podeCriarAnimal  = podeExecutar('animais.criar');
  const podeEditarAnimal = podeExecutar('animais.editar');
  const podeDeletarAnimal = podeExecutar('animais.deletar');

  const [animais,        setAnimais]        = useState<Animal[]>([]);
  const [search,         setSearch]         = useState('');
  const [loading,        setLoading]        = useState(true);
  const [animalToDelete, setAnimalToDelete] = useState<Animal | null>(null);
  // Erro de CARGA — topo da tela (não veio de clique nenhum)
  const [erroInline, setErroInline] = useState<string | null>(null);
  // Erro de AÇÃO (excluir): vai para o modal que o disparou
  const [erroAcao,   setErroAcao]   = useState<ErroAcaoDados | null>(null);

  const loadAnimais = async () => {
    try {
      const res = await api.get('/animais');
      if (!res.data) return;                       // GET 403 → data null (armadilha #23)
      setAnimais(res.data?.dados ?? res.data ?? []);
      setErroInline(null);
    } catch (error) {
      console.error('Erro ao carregar animais:', error);
      setErroInline('Não foi possível carregar seus animais.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user?.id && !loadingPerms) loadAnimais(); }, [user?.id, loadingPerms]);

  const filteredAnimais = animais.filter(a =>
    a.nome.toLowerCase().includes(search.toLowerCase())
  );

  const handleEdit = (animal: Animal) => {
    setSelectedAnimal({
      ...animal,
      photoUrl:        animal.photoUrl        ?? undefined,
      dataNascimento:  animal.dataNascimento  ?? undefined,
      idadeAnos:       animal.idadeAnos       ?? undefined,
      categoriaAnimal: animal.categoriaAnimal ?? undefined,
      tipoExercicio:   animal.tipoExercicio   ?? undefined,
      raca:            animal.raca            ?? undefined,
    });
    navigate(`/animais/${animal.id}`);
  };

  const confirmDelete = async (motivo: string, motivoTipo?: string) => {
    if (!animalToDelete) return;
    try {
      // Exclusão exige justificativa (registrada na Auditoria). `motivoTipo` é a
      // CATEGORIA — vai separada porque tem coluna e índice próprios no banco.
      await api.delete(`/animais/${animalToDelete.id}`, { data: { motivo, motivoTipo } });
      setAnimalToDelete(null);
      await refreshSelectedAnimal();
      loadAnimais();
      toast.success('Animal excluído.');
    } catch (error) {
      console.error(error);
      setErroAcao({ mensagem: 'Erro ao excluir animal.' });
    }
  };

  return (
    <PageContainer>
      <InlineError message={erroInline} className="mb-4" />

      <div className="space-y-5">

        {/* ── Header ────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Meus Animais</h1>
          {podeCriarAnimal && (
            <button
              onClick={() => navigate('/animais')}
              className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white
                         px-4 py-2.5 rounded-2xl font-semibold text-sm transition-colors flex-shrink-0"
            >
              <span className="hidden sm:inline">Novo Animal</span>
              <span className="sm:hidden">Novo</span>
            </button>
          )}
        </div>

        {/* ── Busca ──────────────────────────────────────────────────────── */}
        <div className="relative">
          <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar por nome..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-2xl text-sm
                       text-gray-900 focus:outline-none focus:border-emerald-600
                       focus:ring-2 focus:ring-emerald-100 transition-colors"
          />
        </div>

        {/* ── Conteúdo ───────────────────────────────────────────────────── */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full" />
          </div>
        ) : filteredAnimais.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-3xl mb-3">🐴</p>
            <p className="text-gray-400 text-sm">
              {search ? `Nenhum resultado para "${search}"` : 'Nenhum animal cadastrado'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredAnimais.map(animal => (
              <div
                key={animal.id}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden
                           transition-all hover:shadow-md cursor-pointer"
                onClick={() => handleEdit(animal)}
              >
                <div className="flex items-center gap-3 p-3 sm:p-4">
                  {/* Foto */}
                  <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
                    <FotoAnimal url={animal.photoUrl} nome={animal.nome} iconSize={26} animalId={animal.id} />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base sm:text-lg font-bold text-gray-900 truncate">
                      {animal.nome}
                    </h3>

                    <p className="text-emerald-700 font-medium text-sm truncate">
                      {animal.raca?.nome || 'Raça não informada'}
                    </p>

                    <p className="text-gray-500 text-xs mt-0.5 truncate">
                      {animal.categoriaAnimal
                        ? `${animal.categoriaAnimal} · ${animal.tipoExercicio}`
                        : 'Categoria NRC não informada'}
                    </p>

                    {animal.local && (
                      <p className="flex items-center gap-1 text-xs text-gray-400 mt-0.5 truncate">
                        <MapPin size={10} className="flex-shrink-0" />
                        {animal.local}
                      </p>
                    )}

                    {/* Badges idade + sexo */}
                    <div className="flex gap-2 mt-1.5">
                      <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
                        {idadeDisplay(animal)}
                      </span>
                      <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
                        {animal.sexo}
                      </span>
                    </div>
                  </div>

                  {/* Ações */}
                  <div
                    className="flex flex-col sm:flex-row gap-2 flex-shrink-0"
                    onClick={e => e.stopPropagation()}
                  >
                    {podeEditarAnimal && (
                      <button
                        onClick={() => handleEdit(animal)}
                        className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700
                                   text-white px-3 py-2 rounded-xl text-xs font-medium transition-colors"
                      >
                        <Pencil size={13} />
                        <span className="hidden sm:inline">Editar</span>
                      </button>
                    )}

                    {podeDeletarAnimal && (
                      <button
                        onClick={() => setAnimalToDelete(animal)}
                        className="flex items-center gap-1.5 bg-red-500 hover:bg-red-600
                                   text-white px-3 py-2 rounded-xl text-xs font-medium transition-colors"
                      >
                        <Trash2 size={13} />
                        <span className="hidden sm:inline">Excluir</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal — Excluir (justificativa obrigatória → Auditoria) */}
      <ModalJustificativa
        erro={erroAcao}
        aberto={!!animalToDelete}
        titulo="Excluir animal?"
        descricao={animalToDelete
          ? `${animalToDelete.nome}${animalToDelete.raca?.nome ? ` (${animalToDelete.raca.nome})` : ''} será removido das listagens. O histórico clínico e nutricional é preservado.`
          : undefined}
        // MESMA lista de `AnimaisVet`: as duas telas chamam `DELETE /animais/:id` e
        // gravam na MESMA coluna. Listas diferentes deixariam a base com dois
        // formatos de justificativa para o mesmo fato.
        motivos={MOTIVOS_INATIVACAO_ANIMAL}
        motivoLabel="Motivo da inativação"
        onConfirmar={confirmDelete}
        onFechar={() => setAnimalToDelete(null)}
      />
    </PageContainer>
  );
};

export default MeusAnimais;
