import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Sidebar from './components/Sidebar';

// Pages
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Cavalos from './pages/Cavalos';
import MeusCavalos from './pages/MeusCavalos';     // ← IMPORTADO AQUI
import Dieta from './pages/Dieta';
import Exames from './pages/Exames';
import Analise from './pages/Analise';
import CadastroPessoal from './pages/CadastroPessoal';
import ResetPassword from './pages/ResetPassword';

function App() {
  return (
    <AuthProvider>
      <Router>
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
                <div className="flex min-h-screen bg-white">
                  <Sidebar />
                  <div className="flex-1 ml-72 p-8 bg-white overflow-auto">
                    <Routes>
                      <Route path="/" element={<Dashboard />} />
                      <Route path="/cadastro-pessoal" element={<CadastroPessoal />} />
                      
                      {/* Rotas de Cavalos */}
                      <Route path="/meus-cavalos" element={<MeusCavalos />} />
                      <Route path="/cavalos" element={<Cavalos />} />
                      <Route path="/cavalos/:id" element={<Cavalos />} />

                      <Route path="/dieta" element={<Dieta />} />
                      <Route path="/exames" element={<Exames />} />
                      <Route path="/analise" element={<Analise />} />
                    </Routes>
                  </div>
                </div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;