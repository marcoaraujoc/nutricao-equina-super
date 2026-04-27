const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const path = require('path');

// ===================== MIDDLEWARES =====================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===================== IMPORTAÇÃO DAS ROTAS =====================
const authRoutes = require('./routes/auth');
const animaisRoutes = require('./routes/animais');
const alimentosRoutes = require('./routes/alimentos');     // ← NOVA ROTA
const dietasRoutes = require('./routes/dietas');
const examesRoutes = require('./routes/exames');
const analiseRoutes = require('./routes/analise');
const auditRoutes = require('./routes/audit');
const especiesRoutes = require('./routes/especies');
const racasRoutes = require('./routes/racas');
const userRoutes = require('./routes/user');
const nutrientesRoutes = require('./routes/nutrientes');
const composicaoAlimentarRoutes = require('./routes/composicaoAlimentar');
const dietaRoutes = require('./routes/dietas');

// ===================== MONTAGEM DAS ROTAS =====================
app.use('/api/auth', authRoutes);
app.use('/api/animais', animaisRoutes);
app.use('/api/alimentos', alimentosRoutes);               // ← ADICIONADO AQUI

app.use('/dietas', dietasRoutes);
app.use('/exames', examesRoutes);
app.use('/analise', analiseRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/especies', especiesRoutes);
app.use('/api/racas', racasRoutes);
app.use('/api/users', userRoutes);
app.use('/api/nutrientes', nutrientesRoutes);
app.use('/api/composicoes-alimentares', composicaoAlimentarRoutes);
app.use('/api/dietas', dietaRoutes);

// Servir arquivos de upload (fotos)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ===================== HEALTH CHECK =====================
app.get('/', (req, res) => {
  res.json({ 
    message: '🚀 API Equine Nutrition Super - Backend rodando com sucesso!',
    version: '1.0.0',
    status: 'online'
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'online', timestamp: new Date().toISOString() });
});

// ===================== 404 =====================
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Rota não encontrada' });
});

app.listen(PORT, () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
  console.log(`📡 API disponível em: http://localhost:${PORT}`);
});

module.exports = app;