import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import api from '../services/api';
import { useAuth } from './AuthContext';
import { useEmpresa } from './EmpresaContext';

interface Animal {
  id: number;
  nome: string;
  photoUrl?: string;
  dataNascimento?: string;
  idadeAnos?: number;
  peso?: number;
  sexo?: string;
  categoriaAnimal?: string;
  tipoExercicio?: string;
  veterinarioNome?: string;
  veterinarioClinica?: string;
  raca?: { nome: string };
  especie?: { nome: string };
  user?: { fullName: string; email: string };
  logoUrl?: string | null;
}

interface SelectedAnimalContextType {
  selectedAnimal: Animal | null;
  setSelectedAnimal: (animal: Animal | null) => void;
  selectedAnimals: Animal[];
  toggleAnimalSelection: (animal: Animal) => void;
  refreshSelectedAnimal: () => Promise<void>;
  clearSelectedAnimal: () => void;
  hasAnimals: boolean;
  hasSingleAnimal: boolean;
  isNewUser: boolean;
  /** Cadastro pessoal completo (telefone + endereço + CEP). */
  cadastroCompleto: boolean;
  /** true depois que o perfil (/users/me) foi carregado — evita redirect prematuro. */
  perfilCarregado: boolean;
  /** Usuário é dono/gestor de alguma empresa (escopo de /equipes/configuracoes). */
  isGestorEmpresa: boolean;
  /** Gestor já salvou Configurações da empresa ao menos uma vez. */
  empresaConfigurada: boolean;
}

const SelectedAnimalContext = createContext<SelectedAnimalContextType | undefined>(undefined);

export const SelectedAnimalProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  // Contexto ativo (empresa/equipe) — precisa estar RESOLVIDO antes de buscar animais
  const { loading: empresaLoading, contextoAtivo } = useEmpresa();
  const [selectedAnimal, setSelectedAnimalState] = useState<Animal | null>(null);
  const [selectedAnimals, setSelectedAnimalsState] = useState<Animal[]>([]);
  const [hasAnimals, setHasAnimals] = useState(false);
  const [hasSingleAnimal, setHasSingleAnimal] = useState(false);
  const [cadastroCompleto, setCadastroCompleto] = useState(false);
  const [isProprietario, setIsProprietario] = useState(false);
  const [perfilCarregado, setPerfilCarregado] = useState(false);
  const [isGestorEmpresa, setIsGestorEmpresa] = useState(false);
  const [empresaConfigurada, setEmpresaConfigurada] = useState(true); // otimista até saber que é gestor

  const loadAnimais = useCallback(async () => {
    if (!user?.id) return;
    // Convites pendentes indicam que o usuário ainda não pertence a uma equipe —
    // evita 403 no checkPermission antes da aceitação do convite.
    if (user.pendingInvite) return;
    // CRÍTICO (multi-empresa): espera o contexto ativo ser resolvido. Sem este gate,
    // no PRIMEIRO login (localStorage ainda vazio) o GET /animais sai sem os headers
    // x-empresa-id/x-equipe-id, o backend cai no vínculo mais recente — que pode ser
    // a OUTRA empresa — e o paciente selecionado nasce de lá. Depois o contexto
    // resolve para a empresa do gestor e esse paciente responde 403: o card do animal
    // some no Atendimento. Mesmo motivo do gate que já existe no usePermissoes.
    if (empresaLoading) return;

    try {
      const [animaisRes, perfilRes, configRes] = await Promise.allSettled([
        api.get('/animais'),
        api.get('/users/me'),
        // 404 é o resultado NORMAL para quem não é gestor/dono de empresa
        // (resolverEscopoConfiguracao só resolve para ownerId/cargo GESTOR) —
        // não é um erro a logar, só o sinal de "não é gestor".
        api.get('/equipes/configuracoes'),
      ]);

      // Animais
      const animais = animaisRes.status === 'fulfilled'
      ? ((animaisRes.value.data?.dados ?? animaisRes.value.data ?? []) as Animal[])
      : [];

      setHasAnimals(animais.length > 0);
      setHasSingleAnimal(animais.length === 1);

      // Perfil
      if (perfilRes.status === 'fulfilled') {
        const perfil         = perfilRes.value.data;
        const prop           = perfil?.userType === 'PROPRIETARIO';
        const perfilCompleto = !!(perfil?.phone && perfil?.endereco && perfil?.cep);

        setCadastroCompleto(perfilCompleto);
        setIsProprietario(prop);

        // Só o PROPRIETÁRIO precisa de animal para liberar os módulos — vet,
        // gestor e fornecedor sem animais continuam com acesso
        if (!prop && animais.length === 0) {
          setHasAnimals(true);
          setHasSingleAnimal(false);
        }
      } else {
        console.warn('Não foi possível carregar cadastro pessoal:', perfilRes.reason);
        setCadastroCompleto(false);
      }

      // Escopo de gestor: sucesso = é dono/gestor de alguma empresa (404 = não é,
      // caso comum e esperado — não loga como erro).
      if (configRes.status === 'fulfilled') {
        setIsGestorEmpresa(true);
        setEmpresaConfigurada(!!configRes.value.data?.dados?.configurado);
      } else {
        setIsGestorEmpresa(false);
        setEmpresaConfigurada(true); // não-gestor nunca é bloqueado por este gate
      }

      setPerfilCarregado(true);

      if (animais.length === 0) {
        setSelectedAnimalState(null);
        return;
      }

      let toSelect = animais.reduce((prev, curr) =>
        prev.id < curr.id ? prev : curr
      );

      // A lista já vem escopada pela empresa/equipe ativa. Se o último animal
      // selecionado não está nela, ele é de OUTRO contexto: descarta a chave, senão
      // as telas continuam pedindo um paciente ao qual esta empresa não tem acesso
      // (403 em animais/evoluções/histórico) até alguém trocar o contexto na mão.
      const lastSelectedId = localStorage.getItem('lastSelectedAnimalId');
      if (lastSelectedId) {
        const found = animais.find(a => a.id.toString() === lastSelectedId);
        if (found) toSelect = found;
        else       localStorage.removeItem('lastSelectedAnimalId');
      }

      setSelectedAnimalState(toSelect);
      setSelectedAnimalsState(prev => {
        if (prev.length > 0) return prev;
        return [toSelect];
      });
    } catch (error) {
      console.error('Erro ao carregar dados no context:', error);
    }
    // Recarrega também quando o contexto muda — a lista de pacientes é por empresa
  }, [user?.id, user?.pendingInvite, empresaLoading, contextoAtivo?.empresaId, contextoAtivo?.equipeId]);

  useEffect(() => {
    loadAnimais();
  }, [loadAnimais]);

  const refreshSelectedAnimal = async () => {
    await loadAnimais();
  };

  const setSelectedAnimal = (animal: Animal | null) => {
    setSelectedAnimalState(animal);
    if (animal) {
      localStorage.setItem('lastSelectedAnimalId', animal.id.toString());
    }
  };

  const toggleAnimalSelection = (animal: Animal) => {
    setSelectedAnimalsState(prev => {
      const exists = prev.some(a => a.id === animal.id);
      return exists ? prev.filter(a => a.id !== animal.id) : [...prev, animal];
    });
  };

  const clearSelectedAnimal = () => {
    setSelectedAnimalState(null);
    setSelectedAnimalsState([]);
    localStorage.removeItem('lastSelectedAnimalId');
  };

  return (
    <SelectedAnimalContext.Provider
      value={{
        selectedAnimal,
        setSelectedAnimal,
        selectedAnimals,
        toggleAnimalSelection,
        refreshSelectedAnimal,
        clearSelectedAnimal,
        hasAnimals,
        hasSingleAnimal,
        // PROPRIETÁRIO: precisa de cadastro completo + ao menos um animal.
        // GESTOR de empresa: cadastro completo + Configurações da empresa preenchidas.
        // Demais perfis (vet, fornecedor): apenas cadastro completo.
        isNewUser: isProprietario
          ? (!hasAnimals || !cadastroCompleto)
          : isGestorEmpresa
            ? (!cadastroCompleto || !empresaConfigurada)
            : !cadastroCompleto,
        cadastroCompleto,
        perfilCarregado,
        isGestorEmpresa,
        empresaConfigurada,
      }}
    >
      {children}
    </SelectedAnimalContext.Provider>
  );
};

export const useSelectedAnimal = () => {
  const context = useContext(SelectedAnimalContext);
  if (!context) {
    throw new Error('useSelectedAnimal deve ser usado dentro de SelectedAnimalProvider');
  }
  return context;
};

export { SelectedAnimalContext };