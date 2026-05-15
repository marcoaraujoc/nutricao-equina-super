import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Sidebar from './components/Sidebar';
import ErrorBoundary from './components/ErrorBoundary';

// Pages
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';

import Animal from './pages/Animal';
import MeusAnimais from './pages/MeusAnimais';
import Alimentos from './pages/Alimentos';
import CriaAlimentos from './pages/criaAlimentos';
import Dieta from './pages/Dieta';
import Analise from './pages/Analise';
import CadastroPessoal from './pages/CadastroPessoal';
import ResetPassword from './pages/ResetPassword';
import Nutrientes from './pages/Nutrientes';
import CriaNutrientes from './pages/CriaNutrientes';
import CriaDieta from './pages/CriaDieta';
import AnimalDetail from './pages/AnimalDetail';
import { SelectedAnimalProvider } from './contexts/SelectedAnimalContext';
import Exames from './pages/Exames';
import CriaExameNutricional from './pages/CriaExameNutricional';
import RelatorioNutricional from './pages/RelatorioNutricional';
import ComposicaoAlimentar from './pages/ComposicaoAlimentar';
import CriaComposicaoAlimentar from './pages/CriaComposicaoAlimentar';
import NovoNutrienteComposicao from './pages/Novonutrientecomposicao';

//Import Temporário
import QueryAdHoc from './pages/query-adhoc';

function App() {
  return (
    <AuthProvider>
      <SelectedAnimalProvider>
        <Router>
          {/* Toaster global — necessário para react-hot-toast funcionar em toda a aplicação */}
          <Toaster
            position="top-right"
            toastOptions={{
              duration: 4000,
              style: {
                borderRadius: '12px',
                fontSize: '14px',
              },
              success: {
                style: {
                  background: '#f0fdf4',
                  color: '#166534',
                  border: '1px solid #bbf7d0',
                },
              },
              error: {
                style: {
                  background: '#fef2f2',
                  color: '#991b1b',
                  border: '1px solid #fecaca',
                },
              },
            }}
          />
          <Routes>
            {/* Rotas públicas */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
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

                          {/* Rotas de Animais */}
                          <Route path="/meus-animais" element={<MeusAnimais />} />

                          {/* Rotas de Animais - Retirado para testar o CHAT  */}                        
                          <Route path="/animais" element={<Animal />} />
                          <Route path="/animais/:id" element={<Animal />} />
                          
                          {/* Rotas de Alimentos */}
                          <Route path="/alimentos" element={<Alimentos />} />
                          <Route path="/alimentos/novo" element={<CriaAlimentos />} />
                          <Route path="/alimentos/:id" element={<CriaAlimentos />} />

                          {/* Rotas de Nutrientes */}
                          <Route path="/nutrientes" element={<Nutrientes />} />
                          <Route path="/nutrientes/novo" element={<CriaNutrientes />} />
                          <Route path="/nutrientes/:id" element={<CriaNutrientes />} />

                          {/* Rotas de Composição Alimentar */}
                          <Route path="/composicao-alimentar" element={<ComposicaoAlimentar />} />
                          <Route path="/composicao-alimentar/novo" element={<CriaComposicaoAlimentar />} />
                          <Route path="/composicao-alimentar/:id" element={<CriaComposicaoAlimentar />} />
                          <Route path="/composicao-alimentar/nutriente/novo" element={<NovoNutrienteComposicao />} />

                          {/* Rotas de Dieta */}
                          <Route path="/dieta"                                              element={<Dieta />} />
                          <Route path="/dieta/:animalId"                                    element={<Dieta />} />
                          <Route path="/dieta/:animalId/plano/:planoDietaId"                element={<Dieta />} />
                          <Route path="/dieta/:animalId/plano/:planoDietaId/novo"           element={<CriaDieta />} />
                          <Route path="/dieta/:animalId/plano/:planoDietaId/editar/:id"     element={<CriaDieta />} />

                          {/* Rotas de Animais - Detalhe */}
                          <Route path="/animal/:id" element={<AnimalDetail />} />

                          {/* Rotas de Exames */}
                          <Route path="/exames" element={<Exames />} />
                          <Route path="/exames/:animalId" element={<Exames />} />
                          <Route path="/exames/:animalId/novo" element={<CriaExameNutricional />} />
                          <Route path="/exames/:animalId/editar/:id" element={<CriaExameNutricional />} />

                          {/* Rotas de Relatório Nutricional */}
                          <Route path="/relatorio-nutricional" element={<RelatorioNutricional />} />
                          <Route path="/relatorio-nutricional/:animalId" element={<RelatorioNutricional />} />

                          {/* Rotas Temporárias */}
                          <Route path="/query-adhoc" element={<QueryAdHoc />} />
                          <Route path="/analise" element={<Analise />} />
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