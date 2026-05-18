// src/App.tsx

import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Sidebar from './components/Sidebar';
import ErrorBoundary from './components/ErrorBoundary';
import Usuarios from './pages/Usuarios';
import AnimaisVet from './pages/AnimaisVet';


// Pages — Gerais
import Login          from './pages/Login';
import Register       from './pages/Register';
import Dashboard      from './pages/Dashboard';
import CadastroPessoal from './pages/CadastroPessoal';
import ResetPassword  from './pages/ResetPassword';

// Pages — Animais
import Animal         from './pages/Animal';
import MeusAnimais    from './pages/MeusAnimais';
import AnimalDetail   from './pages/AnimalDetail';

// Pages — Alimentos
import Alimentos      from './pages/Alimentos';
import CriaAlimentos  from './pages/criaAlimentos';

// Pages — Nutrientes
import Nutrientes     from './pages/Nutrientes';
import CriaNutrientes from './pages/CriaNutrientes';

// Pages — Composição Alimentar
import ComposicaoAlimentar      from './pages/ComposicaoAlimentar';
import CriaComposicaoAlimentar  from './pages/CriaComposicaoAlimentar';
import NovoNutrienteComposicao  from './pages/Novonutrientecomposicao';

// Pages — Dieta
import Dieta    from './pages/Dieta';
import CriaDieta from './pages/CriaDieta';

// Pages — Exames
import Exames               from './pages/Exames';
import CriaExameNutricional from './pages/CriaExameNutricional';

import Equipe from './pages/Equipe';

// Pages — Relatório
import RelatorioNutricional from './pages/RelatorioNutricional';

// Pages — Módulo Clínico
import ClinicaDashboard from './pages/ClinicaDashboard';
import EvolucaoClinica  from './pages/EvolucaoClinica';

// Pages — Análise / Debug
import Analise    from './pages/Analise';
import QueryAdHoc from './pages/query-adhoc';

// Pages — Monitoração Custo IA
import AiUsageDashboard from './pages/AiUsageDashboard';

import { SelectedAnimalProvider } from './contexts/SelectedAnimalContext';

function App() {
  return (
    <AuthProvider>
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
            {/* Rotas públicas */}
            <Route path="/login"          element={<Login />} />
            <Route path="/register"       element={<Register />} />
            <Route path="/reset-password" element={<ResetPassword />} />

            {/* Rotas protegidas */}
            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <ErrorBoundary>
                    <div className="flex min-h-screen bg-white">
                      <Sidebar />
                      <div className="flex-1 p-8 bg-white overflow-auto">
                        <Routes>
                          <Route path="/" element={<Dashboard />} />
                          <Route path="/cadastro-pessoal" element={<CadastroPessoal />} />

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
                          <Route path="/composicao-alimentar"              element={<ComposicaoAlimentar />} />
                          <Route path="/composicao-alimentar/novo"         element={<CriaComposicaoAlimentar />} />
                          <Route path="/composicao-alimentar/:id"          element={<CriaComposicaoAlimentar />} />
                          <Route path="/composicao-alimentar/nutriente/novo" element={<NovoNutrienteComposicao />} />

                          {/* Dieta */}
                          <Route path="/dieta"                                          element={<Dieta />} />
                          <Route path="/dieta/:animalId"                               element={<Dieta />} />
                          <Route path="/dieta/:animalId/plano/:planoDietaId"           element={<Dieta />} />
                          <Route path="/dieta/:animalId/plano/:planoDietaId/novo"      element={<CriaDieta />} />
                          <Route path="/dieta/:animalId/plano/:planoDietaId/editar/:id" element={<CriaDieta />} />

                          {/* Exames */}
                          <Route path="/exames"                        element={<Exames />} />
                          <Route path="/exames/:animalId"              element={<Exames />} />
                          <Route path="/exames/:animalId/novo"         element={<CriaExameNutricional />} />
                          <Route path="/exames/:animalId/editar/:id"   element={<CriaExameNutricional />} />

                          {/* Relatório Nutricional */}
                          <Route path="/relatorio-nutricional"           element={<RelatorioNutricional />} />
                          <Route path="/relatorio-nutricional/:animalId" element={<RelatorioNutricional />} />

                          {/* Usuários */}
                          <Route path="/usuarios" element={<Usuarios />} />

                          <Route path="/animais-vet" element={<AnimaisVet />} />

                          {/* ── Módulo Clínico ────────────────────────────── */}
                          <Route path="/clinica"                                element={<ClinicaDashboard />} />

                          <Route path="/clinica/evolucao"                       element={<EvolucaoClinica />} />
                          <Route path="/clinica/evolucao/:animalId"             element={<EvolucaoClinica />} />

                          <Route path="/clinica/prescricao"                     element={<EvolucaoClinica />} />
                          <Route path="/clinica/prescricao/:animalId"           element={<EvolucaoClinica />} />

                          <Route path="/clinica/vacina"                         element={<EvolucaoClinica />} />
                          <Route path="/clinica/vacina/:animalId"               element={<EvolucaoClinica />} />

                          <Route path="/clinica/exames"                         element={<EvolucaoClinica />} />
                          <Route path="/clinica/exames/:animalId"               element={<EvolucaoClinica />} />

                          <Route path="/clinica/encaminhamento"                 element={<EvolucaoClinica />} />
                          <Route path="/clinica/encaminhamento/:animalId"       element={<EvolucaoClinica />} />
                          {/* ─────────────────────────────────────────────── */}
                          
                          {/* Rota Veterinário */}
                          <Route path="/equipe" element={<Equipe />} />
                          
                          {/* Temporárias / Debug */}
                          <Route path="/query-adhoc" element={<QueryAdHoc />} />
                          <Route path="/analise"     element={<Analise />} />
                        </Routes>
                      </div>
                    </div>
                  </ErrorBoundary>
                </ProtectedRoute>
              }
            />
          </Routes>
        </Router>
      </SelectedAnimalProvider>
    </AuthProvider>
  );
}

export default App;