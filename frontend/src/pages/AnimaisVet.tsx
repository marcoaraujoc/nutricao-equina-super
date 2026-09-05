// src/pages/AnimaisVet.tsx
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import { usePermissoes } from '../hooks/usePermissoes';
import api from '../services/api';
import { Pencil, Search, ShieldOff, ClipboardList, Zap, ToggleLeft, ToggleRight, MapPin, X } from 'lucide-react';
import toast from 'react-hot-toast';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import InlineError from '../components/InlineError';
import FotoAnimal from '../components/FotoAnimal';
import ModalJustificativa from '../components/ModalJustificativa';
import { MOTIVOS_INATIVACAO_ANIMAL } from '../utils/motivosInativacao';
import { justificativaDe } from '../utils/motivosInativacao';
import JustificativaCancelamento from '../components/JustificativaCancelamento';
import AcaoRegistro, { AcoesRegistro } from '../components/AcaoRegistro';
import { type ErroAcaoDados } from '../components/ErroAcao';
import { formatDate } from '../utils/dateUtils';


interface Animal {
  id:               number;
  nome:             string;
  sexo:             string;
  peso:             number;
  photoUrl?:        string | null;
  dataNascimento?:  string | null;
  idadeAnos?:       number | null;
  categoriaAnimal?: string | null;
  tipoExercicio?:   string | null;
  baia?:            string | null;
  local?:           string | null;
  localizacao?:     { nome: string } | null;
  pelagem?:         string | null;
  raca?:            { nome: string } | null;
  especie?:         { nome: string } | null;
  user?:            { fullName: string; email: string } | null;
  /**
   * Exclusão lógica (`Animal.ativo = false`) — o paciente some de TODAS as telas.
   *
   * 🔴 **PREMISSA: ANIMAL NUNCA É EXCLUÍDO** (decisão de 2026-09-05). Esta tela
   * não cria mais esse estado — o botão "Inativar" passou a CONGELAR o prontuário
   * (`inativo`, abaixo). O campo continua aqui porque a base tem pacientes excluídos
   * ANTES da premissa: sem o "Ativar" deles, ficariam presos nesse estado para
   * sempre. Eles dividem a aba "Inativos" com os congelados.
   * ⚠️ Não reintroduzir ação de excluir paciente em tela nenhuma.
   */
  ativo?:           boolean;
  /**
   * INATIVO (`Animal.inativo`) — prontuário CONGELADO na data/hora da inativação:
   * o paciente continua aparecendo INTEIRO em todas as telas (inclusive no seletor
   * de paciente do Atendimento, marcado), com o histórico visível, mas nada novo é
   * criado, alterado, finalizado ou cancelado até o gestor reativar.
   * É o estado que o botão "Inativar" desta tela produz.
   */
  inativo?:         boolean;
  inativoEm?:       string | null;
  inativoMotivo?:   string | null;
  inativoPor?:      { fullName?: string | null } | null;
  dataCadastro?:    string;
  ativoEm?:            string | null;
  ativoPorNome?:        string | null;
  desativadoEm?:        string | null;
  desativadoPorNome?:   string | null;
  desativadoMotivo?:    string | null;
  desativadoMotivoTipo?: string | null;
}

type FiltroCampo = 'animal' | 'proprietario';
type FiltroAtivo = 'ativo' | 'inativo' | 'all';

const calcularIdade = (dataNascimento: string): string => {
  const p       = dataNascimento.split('T')[0].split('-').map(Number);
  const nasc    = new Date(p[0], p[1] - 1, p[2]);
  const hoje    = new Date();
  let anos      = hoje.getFullYear() - p[0];
  let meses     = hoje.getMonth() - (p[1] - 1);
  if (meses < 0) { anos--; meses += 12; }
  if (hoje.getDate() < p[2]) meses--;
  const dias = Math.floor((hoje.getTime() - nasc.getTime()) / 86400000);
  if (dias < 30)  return `${dias}d`;
  if (anos === 0) return `${meses} ${meses === 1 ? 'mês' : 'meses'}`;
  return `${anos} ${anos === 1 ? 'ano' : 'anos'}`;
};

const idadeDisplay = (animal: Animal): string => {
  if (animal.dataNascimento) return calcularIdade(animal.dataNascimento);
  if (animal.idadeAnos)      return `${animal.idadeAnos} ${animal.idadeAnos === 1 ? 'ano' : 'anos'}`;
  return '—';
};

// ─── Card mobile ──────────────────────────────────────────────────────────────
// ─── Ações do paciente — UMA declaração p/ a tabela E p/ o card ───────────────
// `AcaoRegistro` decide a forma por CSS: ícone no desktop, botão com rótulo no
// mobile (onde antes eram ícones soltos, empilhados na lateral do card).
// ⚠️ Paciente INATIVO só oferece "Ativar" — editar o cadastro de um paciente
// congelado é recusado pelo backend (400): primeiro se reativa, aí se edita.
// 🔴 NÃO existe ação de EXCLUIR aqui — animal nunca é excluído. O "Ativar" do
// paciente excluído fica porque a base tem exclusões anteriores à premissa, e sem
// ele não haveria como trazê-las de volta.
function AcoesAnimalVet({
  animal, podeEditar, podeInativar, podeAtivar, podeReativarExcluido,
  onEditar, onInativar, onAtivar, onReativarExcluido,
}: {
  animal:               Animal;
  podeEditar:           boolean;
  podeInativar:         boolean;
  podeAtivar:           boolean;
  podeReativarExcluido: boolean;
  onEditar:             () => void;
  onInativar:           () => void;
  onAtivar:             () => void;
  onReativarExcluido:   () => void;
}) {
  const excluido = animal.ativo === false;
  const congelado = !excluido && animal.inativo === true;
  return (
    <AcoesRegistro>
      {/* Excluído (legado): o único caminho é desfazer a exclusão. */}
      <AcaoRegistro tom="ativar" icone={ToggleLeft} rotulo="Ativar"
        titulo="Trazer o paciente de volta às listagens"
        visivel={excluido && podeReativarExcluido} onClick={onReativarExcluido} />
      {/* Congelado: reativa o prontuário. */}
      <AcaoRegistro tom="ativar" icone={ToggleLeft} rotulo="Ativar"
        titulo="Reativar o prontuário — volta a aceitar registros"
        visivel={congelado && podeAtivar} onClick={onAtivar} />
      <AcaoRegistro tom="alterar" icone={Pencil} rotulo="Editar"
        visivel={!excluido && !congelado && podeEditar} onClick={onEditar} />
      <AcaoRegistro tom="ativar" icone={ToggleRight} rotulo="Inativar"
        titulo="Inativar — o paciente continua visível, em somente leitura"
        visivel={!excluido && !congelado && podeInativar} onClick={onInativar} />
    </AcoesRegistro>
  );
}

/**
 * Os TRÊS estados possíveis do paciente, cada um com o seu selo.
 *
 * ⚠️ O selo diz o STATUS, e o status de quem foi inativado é **"Inativo"** — a ação
 * chama "Inativar" e o resultado tem de usar a mesma palavra (a pedido, 2026-09-05;
 * uma versão com "Somente leitura" no selo foi recusada — isso é a CONSEQUÊNCIA, e
 * ela continua dita na faixa âmbar do Atendimento e no chip do card).
 * ⚠️ O CONGELADO (`inativo`, âmbar) e o `ativo = false` (vermelho) não são o mesmo
 * estado: o primeiro continua visível em todo o sistema, o segundo não aparece em
 * tela nenhuma. Como os dois vivem na aba "Inativos" (ver `pacienteInativo`), o que
 * os separa é a COR e o `title`.
 * ⚠️ A palavra "Excluído" NÃO aparece na interface: animal nunca é excluído, e
 * nomear o estado assim contradiria a premissa na única tela em que ele sobrevive.
 */
function seloStatus(animal: Animal): { texto: string; classe: string; titulo: string } {
  if (animal.ativo === false) {
    return {
      texto:  'Inativo',
      classe: 'bg-red-100 text-red-700',
      titulo: 'Fora das listagens — este paciente não aparece em nenhuma outra tela.',
    };
  }
  if (animal.inativo) {
    return {
      texto:  'Inativo',
      classe: 'bg-amber-100 text-amber-700',
      titulo: 'Prontuário em somente leitura — o paciente continua visível em todo o sistema.',
    };
  }
  return { texto: 'Ativo', classe: 'bg-emerald-100 text-emerald-700', titulo: 'Paciente ativo.' };
}

/**
 * O paciente conta como INATIVO para as abas e para a transparência da linha?
 *
 * 🔴 Os DOIS estados entram (a pedido, 2026-09-05): o CONGELADO (`inativo`, que é o
 * que o botão "Inativar" produz hoje) e o `ativo = false` legado. Quem clica em
 * "Inativar" procura o paciente na aba **Inativos** — e o congelado é `ativo = true`,
 * então até aqui ele ficava na aba Ativos, onde ninguém ia procurá-lo.
 * ⚠️ Por isso a aba deixou de ser o parâmetro `?ativo=` do backend e virou filtro DE
 * TELA: as duas condições moram em colunas diferentes e nenhuma query única as cobre.
 */
function pacienteInativo(a: Animal): boolean {
  return a.ativo === false || !!a.inativo;
}

/**
 * O rastro da inativação — de qual das duas colunas ele vem.
 * O congelamento grava `inativo_em`/`inativo_motivo`/`inativo_por`; a exclusão lógica
 * (legado) grava `desativado_em`/`desativado_motivo`/`desativado_por_nome`.
 */
function rastroInativacao(a: Animal): { em: string | null; por: string | null; motivo: string } {
  if (a.inativo) {
    return {
      em:     a.inativoEm ?? null,
      por:    a.inativoPor?.fullName ?? null,
      motivo: a.inativoMotivo?.trim() ?? '',
    };
  }
  return {
    em:     a.desativadoEm ?? null,
    por:    a.desativadoPorNome ?? null,
    motivo: justificativaDe(a),
  };
}

function AnimalCardMobile({
  animal, filtroAtivo, isGestor, onDashboard, onEditar, podeEditar,
  podeInativar, podeAtivar, podeReativarExcluido, onInativar, onAtivar, onReativarExcluido,
}: {
  animal:        Animal;
  filtroAtivo:   FiltroAtivo;
  isGestor:      boolean;
  onDashboard:   () => void;
  onEditar:      () => void;
  podeEditar:    boolean;
  podeInativar:         boolean;
  podeAtivar:           boolean;
  podeReativarExcluido: boolean;
  onInativar:           () => void;
  onAtivar:             () => void;
  onReativarExcluido:   () => void;
}) {
  const inativo = pacienteInativo(animal);
  const selo    = seloStatus(animal);
  const rastro  = rastroInativacao(animal);
  return (
    // Transparência do inativado — a MESMA de `/equipe` (`opacity-60`, sem tingir o
    // fundo). Vinha em dois tons próprios (vermelho e âmbar) que não existiam em
    // nenhuma outra lista de cadastro.
    <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm p-4 ${inativo ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-3">
      <div className="w-14 h-14 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
        <FotoAnimal url={animal.photoUrl} nome={animal.nome} animalId={animal.id} />
      </div>

      <div className="flex-1 min-w-0" onClick={onDashboard}>
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="font-semibold text-gray-900 truncate">{animal.nome}</p>
          <span title={selo.titulo}
            className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${selo.classe}`}>
            {selo.texto}
          </span>
        </div>
        {animal.user?.fullName && (
          <p className="text-xs text-gray-400 truncate">Prop.: {animal.user.fullName}</p>
        )}
        {(animal.localizacao?.nome || animal.local) && (
          <p className="text-xs text-gray-500 truncate">
            📍 {animal.localizacao?.nome || animal.local}
            {animal.baia ? ` · Baia ${animal.baia}` : ''}
          </p>
        )}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
            {idadeDisplay(animal)}
          </span>
          {animal.sexo && (
            <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
              {animal.sexo}
            </span>
          )}
        </div>
        {isGestor && filtroAtivo === 'ativo' && !inativo && (
          <p className="text-[11px] text-gray-400 mt-1">
            Criado em {formatDate(animal.dataCadastro)}
            {animal.ativoPorNome ? ` · Ativado em ${formatDate(animal.ativoEm ?? animal.dataCadastro)} por ${animal.ativoPorNome}` : ''}
          </p>
        )}
        {isGestor && filtroAtivo === 'inativo' && inativo && (
          <p className="text-[11px] text-gray-400 mt-1">
            Inativado em {formatDate(rastro.em)}
            {rastro.por ? ` por ${rastro.por}` : ''}
            {rastro.motivo ? <> — <JustificativaCancelamento texto={rastro.motivo} className="inline" /></> : ''}
          </p>
        )}
      </div>

      </div>

      {/* Ações no RODAPÉ do card, como nas demais listas — na lateral elas
          espremiam o nome do paciente assim que ganharam rótulo. */}
      <div className="mt-3 pt-3 border-t border-gray-50">
        <AcoesAnimalVet
          animal={animal} podeEditar={podeEditar}
          podeInativar={podeInativar} podeAtivar={podeAtivar}
          podeReativarExcluido={podeReativarExcluido}
          onEditar={onEditar} onInativar={onInativar} onAtivar={onAtivar}
          onReativarExcluido={onReativarExcluido}
        />
      </div>
    </div>
  );
}

// ⚠️ SEÇÃO DE SOLICITAÇÕES REMOVIDA na fase 3 do multi-tenancy
// (docs/MULTI-TENANCY-PLANO.md §6): acabaram os vínculos e aprovações entre
// veterinário, proprietário e empresa. O paciente aparece aqui por pertencer à
// EMPRESA do contexto ativo — não há mais convite a aceitar ou recusar.


// ─── Main ─────────────────────────────────────────────────────────────────────
/** Mesmo rótulo que o relatório gerencial usa para o animal sem localização — o
 *  `?local=` compara por igualdade exata contra ele. */
const SEM_LOCALIZACAO = 'Sem localização';

const AnimaisVet = () => {
  const { user }                                     = useAuth();
  const isVet                                        = (user?.userType ?? '').toUpperCase() === 'VETERINARIO';
  const { setSelectedAnimal } = useSelectedAnimal();
  const { podeExecutar, isGestor, temEquipe, loading: loadingPerms } = usePermissoes();
  const podeCriarAnimal                              = podeExecutar('animais.criar');
  const podeEditarAnimal                             = podeExecutar('animais.editar');
  // 🔴 Inativar = CONGELAR o prontuário (`Animal.inativo`), não excluir: o paciente
  // continua em todas as telas, em somente leitura. Segue `animais.ativar`, que é o
  // slug que a rota `PATCH /animais/:id/inativar` exige.
  // Reativar (os dois casos) é SEMPRE gestor — regra fixa do backend, não
  // configurável pela matriz (AnimalController.ativar / .reativarExcluido).
  const podeInativarAnimal                           = podeExecutar('animais.ativar');
  const podeAtivarAnimal                             = isGestor;
  const podeReativarExcluido                         = isGestor;
  const navigate                                     = useNavigate();

  const [animais,        setAnimais]        = useState<Animal[]>([]);
  const [busca,          setBusca]          = useState('');
  // `?local=` recorta a lista por LOCALIZAÇÃO — é assim que "Animais por localização"
  // (Relatório de Gestão) chega aqui já mostrando só o local clicado.
  // ⚠️ É ESTADO, não leitura direta da URL: sem isso o "✕" do chip não teria como
  // limpar o filtro e a pessoa ficaria presa nele até recarregar a página.
  const [searchParams] = useSearchParams();
  const [filtroLocal,    setFiltroLocal]    = useState(searchParams.get('local') ?? '');
  const [filtroCampo,    setFiltroCampo]    = useState<FiltroCampo>('animal');
  const [loading,        setLoading]        = useState(true);
  // Abas Todos/Ativos/Inativos (congelado OU `ativo=false`) — só o gestor enxerga; para
  // qualquer outro perfil a lista é sempre só os ativos (backend também trava isso).
  const [filtroAtivo,    setFiltroAtivo]    = useState<FiltroAtivo>('ativo');
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);
  // ⚠️ O botão "Desvincular" saiu na fase 3 do multi-tenancy: não há mais vínculo entre
  // veterinário e animal para desfazer. O paciente pertence à EMPRESA, e quem deixa de
  // atendê-lo é quem sai da equipe.

  // ── Inativar / Ativar paciente (congelamento — Animal.inativo) ─────────────
  const [modalInativar, setModalInativar] = useState<Animal | null>(null);
  const [modalAtivar,   setModalAtivar]   = useState<Animal | null>(null);
  // Desfazer a EXCLUSÃO de um paciente excluído antes da premissa "animal nunca é
  // excluído" — nada nesta tela cria mais esse estado, mas é preciso poder sair dele.
  const [modalReativar, setModalReativar] = useState<Animal | null>(null);
  const [processandoAtivo, setProcessandoAtivo] = useState(false);
  const [erroModalAtivo,   setErroModalAtivo]   = useState<ErroAcaoDados | null>(null);

  const fecharModaisAtivo = () => {
    setModalInativar(null); setModalAtivar(null); setModalReativar(null);
    setErroModalAtivo(null);
  };

  const confirmarInativar = async (motivo: string, motivoTipo?: string) => {
    if (!modalInativar) return;
    setProcessandoAtivo(true); setErroModalAtivo(null);
    try {
      // ⚠️ Categoria e descrição vão COMPOSTAS num texto só: `Animal.inativo_motivo`
      // é uma coluna única (diferente de `desativado_motivo`/`_tipo`, da exclusão, que
      // são duas). Sem compor, escolher "Falecimento" sem escrever nada mandaria
      // `motivo` VAZIO e o backend recusaria com "é obrigatório informar o motivo".
      const texto = [motivoTipo, motivo].map(t => t?.trim()).filter(Boolean).join(' — ');
      // CONGELA o prontuário — não exclui. O paciente continua em todas as telas
      // (inclusive no seletor do Atendimento, marcado como "Inativo"), só que nada
      // novo pode ser registrado nem alterado até o gestor reativar.
      await api.patch(`/animais/${modalInativar.id}/inativar`, { motivo: texto });
      toast.success('Paciente inativado — prontuário em somente leitura');
      fecharModaisAtivo();
      await loadAnimais();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } })?.response?.data?.mensagem;
      setErroModalAtivo({ mensagem: msg ?? 'Erro ao inativar paciente' });
    } finally { setProcessandoAtivo(false); }
  };

  const confirmarAtivar = async (motivo: string) => {
    if (!modalAtivar) return;
    setProcessandoAtivo(true); setErroModalAtivo(null);
    try {
      await api.patch(`/animais/${modalAtivar.id}/ativar`, { motivo });
      toast.success('Paciente ativado — o prontuário voltou a aceitar registros');
      fecharModaisAtivo();
      await loadAnimais();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } })?.response?.data?.mensagem;
      setErroModalAtivo({ mensagem: msg ?? 'Erro ao ativar paciente' });
    } finally { setProcessandoAtivo(false); }
  };

  const confirmarReativarExcluido = async (motivo: string) => {
    if (!modalReativar) return;
    setProcessandoAtivo(true); setErroModalAtivo(null);
    try {
      await api.patch(`/animais/${modalReativar.id}/reativar`, { motivo });
      toast.success('Paciente ativado com sucesso');
      fecharModaisAtivo();
      await loadAnimais();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } })?.response?.data?.mensagem;
      setErroModalAtivo({ mensagem: msg ?? 'Erro ao ativar paciente' });
    } finally { setProcessandoAtivo(false); }
  };

  const loadAnimais = async () => {
    try {
      // ⚠️ O gestor recebe TODOS (`ativo=all`) e as abas filtram na TELA — elas
      // passaram a misturar dois estados que moram em colunas diferentes
      // (`inativo` e `ativo`), e nenhum valor de `?ativo=` cobre os dois. Bônus:
      // trocar de aba deixou de custar uma ida ao backend.
      const params = isGestor ? { ativo: 'all' } : undefined;
      const animaisRes = await api.get('/animais', { params });
      setAnimais(animaisRes.data?.dados ?? animaisRes.data ?? []);
    } catch {
      setErroInline('Erro ao carregar pacientes');
    } finally {
      setLoading(false);
    }
  };

  // ⚠️ `filtroAtivo` saiu das dependências: a aba é filtro DE TELA desde que passou a
  // misturar congelado e `ativo = false` — recarregar a cada clique só gastaria
  // requisição para reordenar a mesma lista.
  useEffect(() => { if (user?.id && !loadingPerms) loadAnimais(); }, [user?.id, loadingPerms, isGestor]);

  /** Mesma regra do `nomeLocalizacao` do relatório gerencial — as duas telas
   *  precisam concordar sobre o nome do local, senão o link não acha nada. */
  const localDoAnimal = (a: Animal) => a.localizacao?.nome ?? a.local ?? SEM_LOCALIZACAO;

  const animaisFiltrados = animais.filter(a => {
    // Abas Todos/Ativos/Inativos — ver `pacienteInativo`. Só o gestor as vê; para os
    // demais o backend já devolve só os ativos.
    if (isGestor && filtroAtivo !== 'all' && (filtroAtivo === 'inativo') !== pacienteInativo(a)) return false;
    // Casa com o nome que o relatório agrupa: catálogo → texto legado → "Sem
    // localização". Comparação EXATA (e não `includes`), senão "Haras H." traria
    // junto o "Haras H. P." e a contagem da tela nunca bateria com a do relatório.
    if (filtroLocal && localDoAnimal(a) !== filtroLocal) return false;
    const termo = busca.toLowerCase().trim();
    if (!termo) return true;
    return filtroCampo === 'animal'
      ? a.nome.toLowerCase().includes(termo)
      : (a.user?.fullName ?? '').toLowerCase().includes(termo);
  });

  const irParaAnimal = (animal: Animal) => {
    setSelectedAnimal({
      ...animal,
      photoUrl:        animal.photoUrl        ?? undefined,
      dataNascimento:  animal.dataNascimento  ?? undefined,
      idadeAnos:       animal.idadeAnos       ?? undefined,
      categoriaAnimal: animal.categoriaAnimal ?? undefined,
      tipoExercicio:   animal.tipoExercicio   ?? undefined,
      raca:            animal.raca            ?? undefined,
      especie:         animal.especie         ?? undefined,
      user:            animal.user            ?? undefined,
    });
    navigate(`/animal/${animal.id}`);
  };

  const irParaEditar = (animal: Animal) => {
    setSelectedAnimal({
      ...animal,
      photoUrl:        animal.photoUrl        ?? undefined,
      dataNascimento:  animal.dataNascimento  ?? undefined,
      idadeAnos:       animal.idadeAnos       ?? undefined,
      categoriaAnimal: animal.categoriaAnimal ?? undefined,
      tipoExercicio:   animal.tipoExercicio   ?? undefined,
      raca:            animal.raca            ?? undefined,
      especie:         animal.especie         ?? undefined,
      user:            animal.user            ?? undefined,
    });
    navigate(`/animais/${animal.id}`);
  };

  if (!loadingPerms && !podeExecutar('animais.ler')) {
    return (
      <PageContainer>
        <div className="text-center py-16">
          <h2 className="text-lg font-semibold text-gray-700 mb-2">Acesso não autorizado</h2>
          <p className="text-sm text-gray-500">Você não tem permissão para visualizar pacientes.</p>
        </div>
      </PageContainer>
    );
  }

  return (
    <>
      <PageContainer maxWidth="7xl">
        <InlineError message={erroInline} className="mb-4" />

      <div className="space-y-5">

        {/* ── Header ────────────────────────────────────────────────────── */}
        <BotaoVoltar para="/" />
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-2">
          <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold text-gray-900">
            <Zap size={22} className="text-emerald-600" />
            Meus Pacientes
          </h1>
          {podeCriarAnimal && (
            <div className="flex gap-2 self-end sm:self-auto">
              <button
                onClick={() => navigate('/animais')}
                className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white
                           px-4 py-2.5 rounded-2xl font-semibold text-sm transition-colors flex-shrink-0"
              >
                <span className="hidden sm:inline">Novo Paciente</span>
                <span className="sm:hidden">Novo</span>
              </button>
              <button
                onClick={() => navigate('/exame-compra')}
                className="flex items-center gap-2 bg-white border border-emerald-700 text-emerald-700 hover:bg-emerald-50
                           px-4 py-2.5 rounded-2xl font-semibold text-sm transition-colors flex-shrink-0"
              >
                <ClipboardList size={15} />
                <span>Exame de Compra</span>
              </button>
              {/* Resenha — inativado temporariamente (removido do frontend a pedido).
                  Para reativar: descomentar este bloco e reimportar `ScrollText`.
              <button
                onClick={() => navigate('/resenha')}
                className="flex items-center gap-2 bg-white border border-emerald-700 text-emerald-700 hover:bg-emerald-50
                           px-4 py-2.5 rounded-2xl font-semibold text-sm transition-colors flex-shrink-0"
              >
                <ScrollText size={15} />
                <span className="hidden sm:inline">Resenha</span>
                <span className="sm:hidden">Resenha</span>
              </button>
              */}
            </div>
          )}
        </div>

        {/* ── Aviso: sem equipe / perfil configurado ─────────────────────── */}
        {isVet && !temEquipe && (
          <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-2xl text-amber-700 text-sm">
            <ShieldOff size={16} className="flex-shrink-0" />
            <span>Você não está associado a nenhuma equipe. Solicite ao administrador que configure seu perfil para liberar as ações.</span>
          </div>
        )}

        {/* ── Busca ──────────────────────────────────────────────────────── */}
        {/* Chip do filtro por local — VISÍVEL de propósito: filtro que não aparece na
            tela faz a lista parecer quebrada ("cadê meus pacientes?"), e sem o ✕ não
            haveria como voltar à lista inteira sem editar a URL. */}
        {filtroLocal && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
              <MapPin size={12} /> {filtroLocal}
              <button type="button" onClick={() => setFiltroLocal('')}
                title="Remover filtro de local" aria-label="Remover filtro de local"
                className="ml-0.5 p-0.5 rounded-full hover:bg-emerald-100 transition-colors">
                <X size={12} />
              </button>
            </span>
            <span className="text-xs text-gray-400">{animaisFiltrados.length} paciente(s) neste local</span>
          </div>
        )}
        <div className="flex gap-2 flex-wrap">
          <select
            value={filtroCampo}
            onChange={e => { setFiltroCampo(e.target.value as FiltroCampo); setBusca(''); }}
            className="border border-gray-200 rounded-2xl px-3 py-2.5 text-sm text-gray-700
                       focus:outline-none focus:border-emerald-600 bg-white flex-shrink-0"
          >
            <option value="animal">Por animal</option>
            <option value="proprietario">Por proprietário</option>
          </select>
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder={filtroCampo === 'animal' ? 'Nome do animal...' : 'Nome do proprietário...'}
              value={busca}
              onChange={e => setBusca(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-2xl text-sm
                         text-gray-900 focus:outline-none focus:border-emerald-600
                         focus:ring-2 focus:ring-emerald-100 transition-colors"
            />
          </div>
          {isGestor && (
            <div className="flex border border-gray-200 rounded-xl overflow-hidden text-sm flex-shrink-0">
              {(['all', 'ativo', 'inativo'] as const).map(v => (
                <button key={v} onClick={() => setFiltroAtivo(v)}
                  className={`px-4 py-2.5 font-medium transition-colors border-r border-gray-200 last:border-r-0 ${
                    filtroAtivo === v ? 'bg-emerald-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                  }`}>
                  {/* ⚠️ "Inativos" reúne os DOIS estados — o CONGELADO (o que o botão
                      "Inativar" produz) e o `ativo = false` legado. É filtro de TELA,
                      não o `?ativo=` do backend: eles moram em colunas diferentes.
                      Ver `pacienteInativo`. */}
                  {v === 'all' ? 'Todos' : v === 'ativo' ? 'Ativos' : 'Inativos'}
                </button>
              ))}
            </div>
          )}
        </div>



        {/* ── Conteúdo ───────────────────────────────────────────────────── */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full" />
          </div>
        ) : animaisFiltrados.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-3xl mb-3">🔍</p>
            <p className="text-gray-400 text-sm">
              {busca ? `Nenhum resultado para "${busca}"` : 'Nenhum paciente cadastrado'}
            </p>
          </div>
        ) : (
          <>
            {/* MOBILE — cards */}
            <div className="space-y-3 md:hidden">
              {animaisFiltrados.map(animal => (
                <AnimalCardMobile
                  key={animal.id}
                  animal={animal}
                  filtroAtivo={filtroAtivo}
                  isGestor={isGestor}
                  onDashboard={() => irParaAnimal(animal)}
                  onEditar={() => irParaEditar(animal)}
                  podeEditar={podeEditarAnimal}
                  podeInativar={podeInativarAnimal}
                  podeAtivar={podeAtivarAnimal}
                  podeReativarExcluido={podeReativarExcluido}
                  onInativar={() => setModalInativar(animal)}
                  onAtivar={() => setModalAtivar(animal)}
                  onReativarExcluido={() => setModalReativar(animal)}
                />
              ))}
            </div>

            {/* DESKTOP — tabela */}
            <div className="hidden md:block bg-white rounded-2xl border border-gray-100 shadow-sm">
              <div className="overflow-x-auto rounded-2xl">
                <table className="w-full min-w-[900px]">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="w-14 pl-5 py-3" />
                      <th className="text-left px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Nome / Proprietário</th>
                      <th className="text-left px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-36">Local</th>
                      <th className="text-left px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-20">Baia</th>
                      <th className="text-left px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-16">Idade</th>
                      <th className="text-left px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-14">Sexo</th>
                      <th className="text-left px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-24">Status</th>
                      {isGestor && filtroAtivo === 'ativo' && (
                        <>
                          <th className="text-left px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">Criado em</th>
                          <th className="text-left px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">Ativado em</th>
                          <th className="text-left px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">Ativado por</th>
                        </>
                      )}
                      {isGestor && filtroAtivo === 'inativo' && (
                        <>
                          <th className="text-left px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">Inativado em</th>
                          <th className="text-left px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">Inativado por</th>
                          <th className="text-left px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Justificativa</th>
                        </>
                      )}
                      <th className="text-right pr-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-28">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {animaisFiltrados.map(animal => {
                      const inativo = pacienteInativo(animal);
                      const selo    = seloStatus(animal);
                      const rastro  = rastroInativacao(animal);
                      return (
                      <tr
                        key={animal.id}
                        onClick={() => irParaAnimal(animal)}
                        /* Transparência do inativado — a MESMA de `/equipe`. */
                        className={`hover:bg-gray-50 cursor-pointer transition-colors group ${inativo ? 'opacity-60' : ''}`}
                      >
                        <td className="pl-5 py-3.5">
                          <div className="w-11 h-11 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
                            <FotoAnimal url={animal.photoUrl} nome={animal.nome} animalId={animal.id} />
                          </div>
                        </td>
                        <td className="px-3 py-3.5 max-w-0">
                          <p className="font-semibold text-gray-900 truncate group-hover:text-emerald-700 transition-colors">
                            {animal.nome}
                          </p>
                          {animal.user?.fullName && (
                            <p className="text-xs text-gray-400 truncate">{animal.user.fullName}</p>
                          )}
                        </td>
                        <td className="px-3 py-3.5">
                          <p className="text-sm text-gray-600 truncate">
                            {animal.localizacao?.nome || animal.local || <span className="text-gray-300">—</span>}
                          </p>
                        </td>
                        <td className="px-3 py-3.5">
                          {animal.baia
                            ? <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full text-xs font-medium">{animal.baia}</span>
                            : <span className="text-gray-300">—</span>
                          }
                        </td>
                        <td className="px-3 py-3.5">
                          <p className="text-sm text-gray-600 whitespace-nowrap">{idadeDisplay(animal)}</p>
                        </td>
                        <td className="px-3 py-3.5">
                          <p className="text-sm text-gray-600">{animal.sexo || '—'}</p>
                        </td>
                        <td className="px-3 py-3.5">
                          <span title={selo.titulo}
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${selo.classe}`}>
                            {selo.texto}
                          </span>
                        </td>
                        {isGestor && filtroAtivo === 'ativo' && (
                          <>
                            <td className="px-3 py-3.5 whitespace-nowrap text-gray-600 text-sm">{formatDate(animal.dataCadastro)}</td>
                            <td className="px-3 py-3.5 whitespace-nowrap text-gray-600 text-sm">{formatDate(animal.ativoEm ?? animal.dataCadastro)}</td>
                            <td className="px-3 py-3.5 whitespace-nowrap text-gray-600 text-sm">{animal.ativoPorNome ?? '—'}</td>
                          </>
                        )}
                        {isGestor && filtroAtivo === 'inativo' && (
                          <>
                            <td className="px-3 py-3.5 whitespace-nowrap text-gray-600 text-sm">{formatDate(rastro.em)}</td>
                            <td className="px-3 py-3.5 whitespace-nowrap text-gray-600 text-sm">{rastro.por ?? '—'}</td>
                            <td className="px-3 py-3.5 text-sm"><JustificativaCancelamento texto={rastro.motivo} /></td>
                          </>
                        )}
                        <td className="pr-5 py-3.5" onClick={e => e.stopPropagation()}>
                          <AcoesAnimalVet
                            animal={animal}
                            podeEditar={podeEditarAnimal}
                            podeInativar={podeInativarAnimal}
                            podeAtivar={podeAtivarAnimal}
                            podeReativarExcluido={podeReativarExcluido}
                            onEditar={() => irParaEditar(animal)}
                            onInativar={() => setModalInativar(animal)}
                            onAtivar={() => setModalAtivar(animal)}
                            onReativarExcluido={() => setModalReativar(animal)}
                          />
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-5 py-3 border-t border-gray-50 text-center">
                <p className="text-xs text-gray-400">
                  {animaisFiltrados.length} paciente{animaisFiltrados.length !== 1 ? 's' : ''} encontrado{animaisFiltrados.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>

            {/* Rodapé mobile */}
            <p className="md:hidden text-xs text-gray-400 text-center">
              {animaisFiltrados.length} paciente{animaisFiltrados.length !== 1 ? 's' : ''} encontrado{animaisFiltrados.length !== 1 ? 's' : ''}
            </p>
          </>
        )}
      </div>


      </PageContainer>

      <ModalJustificativa
        aberto={!!modalInativar}
        titulo="Inativar paciente?"
        descricao={modalInativar
          ? `${modalInativar.nome} continua aparecendo em todo o sistema — inclusive no seletor de paciente —, com o histórico inteiro visível, mas em SOMENTE LEITURA: nada novo pode ser registrado, alterado, finalizado ou cancelado até o gestor reativar.`
          : undefined}
        acaoLabel="Inativar"
        // Motivo padronizado + descrição; a descrição só é obrigatória em "Outro".
        motivos={MOTIVOS_INATIVACAO_ANIMAL}
        motivoLabel="Motivo da inativação"
        processando={processandoAtivo}
        erro={erroModalAtivo}
        onConfirmar={confirmarInativar}
        onFechar={fecharModaisAtivo}
      />

      <ModalJustificativa
        aberto={!!modalAtivar}
        titulo="Ativar paciente?"
        descricao={modalAtivar
          ? `O prontuário de ${modalAtivar.nome} volta a aceitar registros e alterações.`
          : undefined}
        acaoLabel="Ativar"
        tom="neutro"
        placeholder="Descreva o motivo da ativação (obrigatório)..."
        processando={processandoAtivo}
        erro={erroModalAtivo}
        onConfirmar={confirmarAtivar}
        onFechar={fecharModaisAtivo}
      />

      <ModalJustificativa
        aberto={!!modalReativar}
        titulo="Trazer o paciente de volta?"
        descricao={modalReativar
          ? `${modalReativar.nome} está fora das listagens — não aparece em nenhuma tela. Ativar traz ele e todo o histórico de volta ao sistema.`
          : undefined}
        acaoLabel="Ativar"
        tom="neutro"
        placeholder="Descreva o motivo da ativação (obrigatório)..."
        processando={processandoAtivo}
        erro={erroModalAtivo}
        onConfirmar={confirmarReativarExcluido}
        onFechar={fecharModaisAtivo}
      />
    </>
  );
};

export default AnimaisVet;
