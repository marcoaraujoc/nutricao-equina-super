import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';

const PATH_CONVITE = '/aceitar-convite-equipe';
const PATH_SENHA   = '/alterar-senha-obrigatoria';
const PATH_PERFIL  = '/cadastro-pessoal';
// Tela ÚNICA do Gestor (2026-08-17): identidade da empresa + preferências
// operacionais — antes eram duas rotas (`/cadastro/empresa` + `/configuracoes`).
const PATH_CONFIG  = '/cadastro/empresa';

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location          = useLocation();
  const path              = location.pathname;
  // Fonte única do gate de cadastro incompleto — NUNCA duplicar esta navegação em
  // outro componente (ex.: Sidebar): duas fontes decidindo destinos diferentes
  // causam loop de mount/unmount e tempestade de requisições 429 nos hooks de
  // polling do Sidebar (já aconteceu — ver histórico do projeto).
  const { cadastroCompleto, perfilCarregado, isGestorEmpresa, empresaConfigurada } = useSelectedAnimal();

  if (loading) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-white">Carregando...</div>;
  }

  if (!user) return <Navigate to="/login" replace />;

  // ── Passo 1: aceitar convite pendente ───────────────────────────────────
  // Enquanto houver convite pendente, SOMENTE /aceitar-convite-equipe é acessível.
  // Ao chegar na página correta, para aqui (early return) — não avalia passos 2/3.
  if (user.pendingInvite) {
    return path === PATH_CONVITE
      ? <>{children}</>
      : <Navigate to={PATH_CONVITE} replace />;
  }

  // ── Passo 2: trocar senha temporária ────────────────────────────────────
  // Enquanto mustChangePassword, SOMENTE /alterar-senha-obrigatoria é acessível.
  if (user.mustChangePassword) {
    return path === PATH_SENHA
      ? <>{children}</>
      : <Navigate to={PATH_SENHA} replace />;
  }

  // ── Passo 3: cadastro pessoal incompleto (telefone/endereço/CEP) ────────
  // Enquanto perfilCarregado for false (fetch de /users/me ainda em voo), não
  // decide nada — evita redirect prematuro antes do dado chegar.
  if (perfilCarregado && !cadastroCompleto) {
    return path === PATH_PERFIL
      ? <>{children}</>
      : <Navigate to={PATH_PERFIL} replace />;
  }

  // ── Passo 4: GESTOR no primeiro acesso — cadastro pessoal ok, mas o Cadastro
  // da Empresa ainda não está completo (identidade + operacional, exceto
  // logo/whatsapp — ver EquipeController.configuracaoCompleta).
  if (perfilCarregado && isGestorEmpresa && !empresaConfigurada) {
    return path === PATH_CONFIG
      ? <>{children}</>
      : <Navigate to={PATH_CONFIG} replace />;
  }

  // ── Passo 5: completar cadastro pessoal (fluxo de convite) ──────────────
  // Só se aplica quando s2vet_ob='convite' ainda estiver no localStorage
  // e o perfil ainda não foi completado (sem telefone ou nome).
  const inviteOnboarding = localStorage.getItem('s2vet_ob') === 'convite';
  if (inviteOnboarding && !user.profileComplete) {
    return path === PATH_PERFIL
      ? <>{children}</>
      : <Navigate to={PATH_PERFIL} replace />;
  }

  return <>{children}</>;
}