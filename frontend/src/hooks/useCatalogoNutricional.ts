// frontend/src/hooks/useCatalogoNutricional.ts
import { usePermissoes } from './usePermissoes';
import { useAuth } from '../contexts/AuthContext';

/**
 * Quem pode escrever no catálogo nutricional (alimento, nutriente, composição).
 *
 * Desde 2026-09-09 ele é CATÁLOGO MISTO (migration `20261004000000`), na mesma forma de
 * medicamentos e procedimentos:
 *   · linha do SISTEMA (`doSistema: true`)  → só o ADMIN da plataforma altera/exclui;
 *   · linha DA CLÍNICA                      → quem tem `nutricao.catalogo.*` no
 *                                             Controle de Acesso (o gestor, por bypass).
 *
 * ⚠️ Espelha `backend/src/lib/catalogoNutricional.js#bloqueioDeEscrita` — o front decide
 * o que MOSTRAR; quem recusa de fato é o backend (403 `ITEM_DO_SISTEMA`) e, por baixo,
 * o RLS. Botão que só falha depois do clique é o antipadrão 28-d, e é por isso que a
 * ação nem é renderizada no que a pessoa não pode alterar.
 *
 * ⚠️ `usePermissoes` NÃO carrega para o ADMIN da plataforma (`precisaCarregar = user &&
 * !isAdminUser`), então `podeExecutar` devolve false para ele em tudo. Sem o
 * `ehAdminPlataforma ||` abaixo, o dono do catálogo global seria justamente quem
 * ficaria sem nenhum botão.
 */
export function useCatalogoNutricional() {
  const { podeExecutar, loading } = usePermissoes();
  const { user } = useAuth();

  const ehAdminPlataforma = String(user?.role ?? user?.userType ?? '').toUpperCase() === 'ADMIN';

  const criar   = ehAdminPlataforma || podeExecutar('nutricao.catalogo.criar');
  const editar  = ehAdminPlataforma || podeExecutar('nutricao.catalogo.editar');
  const excluir = ehAdminPlataforma || podeExecutar('nutricao.catalogo.deletar');

  return {
    ehAdminPlataforma,
    loading,
    podeCriar: criar,
    /** `doSistema` indefinido (backend antigo) é tratado como linha do sistema. */
    podeAlterar: (doSistema?: boolean) => (doSistema !== false ? ehAdminPlataforma : editar),
    podeExcluir: (doSistema?: boolean) => (doSistema !== false ? ehAdminPlataforma : excluir),
  };
}
