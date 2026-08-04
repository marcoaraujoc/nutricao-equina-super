// src/App.tsx

import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Sidebar from './components/Sidebar';
import ErrorBoundary from './components/ErrorBoundary';
import Usuarios from './pages/Usuarios';
import AnimaisVet from './pages/AnimaisVet';
import AprovarVinculo from './pages/AprovarVinculo';
import AprovarVinculoProprietario from './pages/AprovarVinculoProprietario';
import AlterarSenhaObrigatoria from './pages/AlterarSenhaObrigatoria';
import AceitarConviteEquipe   from './pages/AceitarConviteEquipe';

// Pages — Gerais
import Login                from './pages/Login';
import Register             from './pages/Register';
import Dashboard            from './pages/Dashboard';
import CadastroPessoal      from './pages/CadastroPessoal';
import ResetPassword        from './pages/ResetPassword';
import CadastroProprietario from './pages/CadastroProprietario';
import CadastroTratador     from './pages/CadastroTratador';
import CadastroProcedimento from './pages/CadastroProcedimento';
import CadastroFornecedor   from './pages/CadastroFornecedor';
import CadastroLocalizacao  from './pages/CadastroLocalizacao';
import CadastroVacina       from './pages/CadastroVacina';

// Pages — Animais
import Animal      from './pages/Animal';
import MeusAnimais from './pages/MeusAnimais';
import AnimalDetail from './pages/AnimalDetail';

// Pages — Alimentos
import Alimentos     from './pages/Alimentos';
import CriaAlimentos from './pages/criaAlimentos';

// Pages — Nutrientes
import Nutrientes     from './pages/Nutrientes';
import CriaNutrientes from './pages/CriaNutrientes';

// Pages — Composição Alimentar
import ComposicaoAlimentar     from './pages/ComposicaoAlimentar';
import CriaComposicaoAlimentar from './pages/CriaComposicaoAlimentar';
import NovoNutrienteComposicao from './pages/Novonutrientecomposicao';

// Pages — Dieta
import Dieta     from './pages/Dieta';
import CriaDieta from './pages/CriaDieta';

// Pages — Exames
import Exames               from './pages/Exames';
import CriaExameNutricional from './pages/CriaExameNutricional';

import Equipe         from './pages/Equipe';
import ControleAcesso from './pages/ControleAcesso';
import Configuracoes  from './pages/Configuracoes';
import AuditoriaGeral from './pages/AuditoriaGeral';

// Pages — Relatório
import RelatorioNutricional from './pages/RelatorioNutricional';
import Relatorios           from './pages/Relatorios';
import RelatoriosFinanceiro  from './pages/RelatoriosFinanceiro';
import RelatoriosAtendimento from './pages/RelatoriosAtendimento';
import RelatoriosCadastro    from './pages/RelatoriosCadastro';
import RelatoriosFarmacia    from './pages/RelatoriosFarmacia';

// Pages — Agenda / Agendamentos
import Agendamentos    from './pages/Agendamentos';
// Pages — Orçamento
import Orcamento           from './pages/Orcamento';
import RelatoriosOrcamentos from './pages/RelatoriosOrcamentos';
import MapaAtendimento from './pages/MapaAtendimento';
import PainelPrincipal from './pages/PainelPrincipal';
import ConfiguracaoAlerta from './pages/ConfiguracaoAlerta';
import Monitoracao from './pages/Monitoracao';

// Pages — Módulo Clínico
import Atendimento  from './pages/Atendimento';
import Vacina       from './pages/Vacina';
import CentralDocumentos from './pages/CentralDocumentos';
import ExameCompra  from './pages/ExameCompra';
import Resenha      from './pages/Resenha';

// Pages — Análise / Debug
import Analise    from './pages/Analise';
import QueryAdHoc from './pages/query-adhoc';

// Pages — Monitoração Custo IA
import AiUsageDashboard from './pages/AiUsageDashboard';

// Pages — Farmácia / Medicamentos / Procedimentos
import Farmacia            from './pages/Farmacia';
import EstoqueVacina       from './pages/EstoqueVacina';
import Medicamentos        from './pages/Medicamentos';
import Procedimentos       from './pages/Procedimentos';
import ExecucaoPrescricao  from './pages/ExecucaoPrescricao';

// Pages — Financeiro
import Faturamento from './pages/Faturamento';

import { SelectedAnimalProvider } from './contexts/SelectedAnimalContext';
import { EmpresaProvider } from './contexts/EmpresaContext';
import { PeriodoProvider } from './contexts/PeriodoContext';
import { MobileMenuProvider } from './contexts/MobileMenuContext';
import { useDraggableModals } from './hooks/useDraggableModals';
import AppHeader from './components/AppHeader';
import AppFooter from './components/AppFooter';

function App() {
  // Modais arrastáveis no desktop (delegação global — vale para toda a aplicação)
  useDraggableModals();
  return (
    <AuthProvider>
      <EmpresaProvider>
      <PeriodoProvider>
      <SelectedAnimalProvider>
        <Router>
          <Toaster
            position="top-right"
            toastOptions={{
              duration: 4000,
              style: { borderRadius: '12px', fontSize: '14px' },
              success: { style: { background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' } },
              error:   { style: { background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' } },
            }}
          />
          <Routes>

            {/* ── Rotas públicas — scroll livre, sem sidebar ──────────────── */}
            <Route path="/login"          element={<Login />} />
            <Route path="/register"       element={<Register />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/proprietario/aprovar-vinculo" element={<AprovarVinculoProprietario />} />

            {/* ── Rotas protegidas — layout travado na viewport ────────────── */}
            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <ErrorBoundary>
                    <MobileMenuProvider>
                    {/*
                      Shell principal, em COLUNA: header global no topo, corpo
                      (sidebar + conteúdo) no meio e rodapé global embaixo.
                      - h-full overflow-hidden → trava na viewport, sem scroll externo
                      - bg-gray-50             → fundo padrão da aplicação
                      Header e rodapé são irmãos flex de altura fixa — nada de
                      `position: fixed`, que se desloca no iOS Safari; só o <main> rola.
                    */}
                    <div className="flex flex-col h-full overflow-hidden bg-gray-50">

                      <AppHeader />

                      {/* Corpo: min-h-0 é o que permite o <main> rolar dentro do flex */}
                      <div className="flex flex-1 min-h-0">

                      <Sidebar />

                      {/*
                        Área de conteúdo:
                        - flex-1 min-w-0     → ocupa o espaço restante sem overflow horizontal
                        - overflow-y-scroll  → barra vertical SEMPRE presente (reserva espaço em
                          navegadores com barra clássica, ex: Windows). `scrollbar-gutter:stable`
                          reforça isso onde houver suporte.
                        - overflow-x-hidden  → impede rolagem/overflow horizontal da página. É o que
                          resolve o "dançar lateral" em qualquer navegador/SO (inclusive Safari, que
                          usa barra overlay e por isso o problema lá é overflow horizontal, não a
                          barra vertical). Conteúdos largos (tabelas) rolam no próprio card
                          (overflow-x-auto interno), então nada é cortado.
                        O gatilho do menu mobile mora no AppHeader — por isso não há mais
                        padding superior reservado aqui.
                        As páginas usam <PageContainer> para centralizar e adicionar padding interno.
                      */}
                      <main className="flex-1 min-w-0 overflow-y-scroll overflow-x-hidden [scrollbar-gutter:stable] bg-gray-50">
                        <Routes>
                          <Route path="/" element={<Dashboard />} />
                          <Route path="/mapa-atendimento" element={<MapaAtendimento />} />
                          {/* Painel do veterinário de campo. O gate de perfil é da
                              própria página (userType do contexto ativo), como nas
                              demais telas com guard próprio. */}
                          <Route path="/painel-principal" element={<PainelPrincipal />} />
                          <Route path="/cadastro-pessoal" element={<CadastroPessoal />} />

                          {/* Cadastro */}
                          <Route path="/cadastro/proprietarios" element={<CadastroProprietario />} />
                          <Route path="/cadastro/tratadores"    element={<CadastroTratador />} />
                          <Route path="/cadastro/procedimentos" element={<CadastroProcedimento />} />
                          <Route path="/cadastro/fornecedores"  element={<CadastroFornecedor />} />
                          <Route path="/cadastro/localizacoes"  element={<CadastroLocalizacao />} />

                          {/* Animais */}
                          <Route path="/meus-animais"  element={<MeusAnimais />} />
                          <Route path="/animais"       element={<Animal />} />
                          <Route path="/animais/:id"   element={<Animal />} />
                          <Route path="/animal/:id"    element={<AnimalDetail />} />

                          {/* Alimentos */}
                          <Route path="/alimentos"       element={<Alimentos />} />
                          <Route path="/alimentos/novo"  element={<CriaAlimentos />} />
                          <Route path="/alimentos/:id"   element={<CriaAlimentos />} />

                          {/* Monitoração IA */}
                          <Route path="/ai-usage" element={<AiUsageDashboard />} />

                          {/* Nutrientes */}
                          <Route path="/nutrientes"       element={<Nutrientes />} />
                          <Route path="/nutrientes/novo"  element={<CriaNutrientes />} />
                          <Route path="/nutrientes/:id"   element={<CriaNutrientes />} />

                          {/* Composição Alimentar */}
                          <Route path="/composicao-alimentar"                element={<ComposicaoAlimentar />} />
                          <Route path="/composicao-alimentar/novo"           element={<CriaComposicaoAlimentar />} />
                          <Route path="/composicao-alimentar/:id"            element={<CriaComposicaoAlimentar />} />
                          <Route path="/composicao-alimentar/nutriente/novo" element={<NovoNutrienteComposicao />} />

                          {/* Dieta */}
                          <Route path="/dieta"                                           element={<Dieta />} />
                          <Route path="/dieta/:animalId"                                element={<Dieta />} />
                          <Route path="/dieta/:animalId/plano/:planoDietaId"            element={<Dieta />} />
                          <Route path="/dieta/:animalId/plano/:planoDietaId/novo"       element={<CriaDieta />} />
                          <Route path="/dieta/:animalId/plano/:planoDietaId/editar/:id" element={<CriaDieta />} />

                          {/* Exames */}
                          <Route path="/exames"                      element={<Exames />} />
                          <Route path="/exames/:animalId"            element={<Exames />} />
                          <Route path="/exames/:animalId/novo"       element={<CriaExameNutricional />} />
                          <Route path="/exames/:animalId/editar/:id" element={<CriaExameNutricional />} />

                          {/* Relatório Nutricional */}
                          <Route path="/relatorio-nutricional"           element={<RelatorioNutricional />} />
                          <Route path="/relatorio-nutricional/:animalId" element={<RelatorioNutricional />} />

                          {/* Usuários */}
                          <Route path="/usuarios" element={<Usuarios />} />

                          <Route path="/animais-vet"              element={<AnimaisVet />} />
                          <Route path="/exame-compra"            element={<ExameCompra />} />
                          <Route path="/exame-compra/:animalId"  element={<ExameCompra />} />
                          <Route path="/resenha"                 element={<Resenha />} />
                          <Route path="/resenha/:animalId"       element={<Resenha />} />

                          {/* Agenda de Atendimentos */}
                          <Route path="/agendamentos" element={<Agendamentos />} />

                          {/* Orçamento (etapa opcional) */}
                          <Route path="/orcamento" element={<Orcamento />} />
                          <Route path="/documentos" element={<CentralDocumentos />} />

                          {/* Módulo Clínico */}
                          <Route path="/clinica"                          element={<Atendimento />} />
                          <Route path="/clinica/agenda"                   element={<Atendimento />} />
                          <Route path="/clinica/evolucao"                 element={<Atendimento />} />
                          <Route path="/clinica/evolucao/:animalId"       element={<Atendimento />} />
                          <Route path="/clinica/prescricao"               element={<Atendimento />} />
                          <Route path="/clinica/prescricao/:animalId"     element={<Atendimento />} />
                          {/* Vacina é tela APARTADA — não passa pelo shell de Atendimento */}
                          <Route path="/clinica/vacina"                   element={<Vacina />} />
                          <Route path="/clinica/vacina/:animalId"         element={<Vacina />} />
                          <Route path="/clinica/exames"                   element={<Atendimento />} />
                          <Route path="/clinica/exames/:animalId"         element={<Atendimento />} />
                          <Route path="/clinica/encaminhamento"           element={<Atendimento />} />
                          <Route path="/clinica/encaminhamento/:animalId" element={<Atendimento />} />

                          {/* Vacina / Farmácia */}
                          <Route path="/estoque-vacina"        element={<EstoqueVacina />} />
                          <Route path="/farmacia"              element={<Farmacia />} />
                          <Route path="/medicamentos"          element={<Medicamentos />} />
                          <Route path="/procedimentos"         element={<Procedimentos />} />
                          <Route path="/admin/vacinas"         element={<CadastroVacina />} />
                          <Route path="/execucao-prescricao"   element={<ExecucaoPrescricao />} />

                          {/* Financeiro */}
                          <Route path="/faturamento" element={<Faturamento />} />

                          {/* Equipe */}
                          <Route path="/equipe"           element={<Equipe />} />
                          <Route path="/controle-acesso"  element={<ControleAcesso />} />
                          <Route path="/configuracoes"    element={<Configuracoes />} />
                          <Route path="/configuracao-alertas" element={<ConfiguracaoAlerta />} />
                          <Route path="/monitoracao"          element={<Monitoracao />} />
                          <Route path="/auditoria-geral"  element={<AuditoriaGeral />} />

                          {/* Relatórios gerenciais */}
                          <Route path="/relatorios"             element={<Relatorios />} />
                          <Route path="/relatorios/financeiro"  element={<RelatoriosFinanceiro />} />
                          <Route path="/relatorios/atendimento" element={<RelatoriosAtendimento />} />
                          <Route path="/relatorios/cadastro"    element={<RelatoriosCadastro />} />
                          <Route path="/relatorios/farmacia"    element={<RelatoriosFarmacia />} />
                          <Route path="/relatorios/orcamentos"  element={<RelatoriosOrcamentos />} />

                          {/* Troca Senha */}
                          {/* Onboarding de convidado — aceitar convite de equipe */}
                          <Route path="/aceitar-convite-equipe" element={<AceitarConviteEquipe />} />
                          <Route path="/alterar-senha-obrigatoria" element={<AlterarSenhaObrigatoria />} />

                          {/* Debug */}
                          <Route path="/query-adhoc" element={<QueryAdHoc />} />
                          <Route path="/analise"     element={<Analise />} />

                          <Route path="/veterinarios/solicitacoes/aprovar" element={<AprovarVinculo />} />
                        </Routes>
                      </main>

                      </div>

                      <AppFooter />

                    </div>
                    </MobileMenuProvider>
                  </ErrorBoundary>
                </ProtectedRoute>
              }
            />
          </Routes>
        </Router>
      </SelectedAnimalProvider>
      </PeriodoProvider>
      </EmpresaProvider>
    </AuthProvider>
  );
}

export default App;
