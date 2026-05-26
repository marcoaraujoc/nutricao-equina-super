const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

dotenv.config();

const logger = require('./lib/logger');

// Roteia todo console.* do processo para Winston
console.log   = (...a) => logger.info(a.join(' '));
console.info  = (...a) => logger.info(a.join(' '));
console.warn  = (...a) => logger.warn(a.join(' '));
console.debug = (...a) => logger.debug(a.join(' '));
console.error = (...a) => logger.error(
  a.map(x => (x instanceof Error ? x.stack : typeof x === 'object' ? JSON.stringify(x) : x)).join(' ')
);

const app = express();
const PORT = process.env.PORT || 3001;
const path = require('path');

// ===================== MIDDLEWARES =====================
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting geral: 200 req/min por IP
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { sucesso: false, mensagem: 'Muitas requisições. Tente novamente em instantes.' },
});

// Rate limiting restrito para rotas de autenticação: 20 req/15min por IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { sucesso: false, mensagem: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
});

app.use('/api', limiter);

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
const usersRoutes = require('./routes/users');
const nutrientesRoutes = require('./routes/nutrientes');
const composicaoAlimentarRoutes = require('./routes/composicaoAlimentar');

const crmvRoutes = require('./routes/crmv');

//RBAC Veterinário
const veterinariosRoutes = require('./routes/veterinarios');
const equipesRoutes      = require('./routes/equipes');


const evolucaoRoutes    = require('./routes/evolucao');
const faturaRoutes      = require('./routes/fatura');
const prescricoesRoutes = require('./routes/prescricoes');

//Monitoração de Custo IA
const aiUsageRoutes = require('./routes/aiUsage');


// === RELATÓRIO NUTRICIONAL ===
const relatorioRoutes = require('./routes/relatorio.routes');

// ===================== MONTAGEM DAS ROTAS =====================
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/animais', animaisRoutes);
app.use('/api/alimentos', alimentosRoutes);               // ← ADICIONADO AQUI

app.use('/api/dietas', dietasRoutes);
app.use('/api/exames', examesRoutes);
app.use('/api/analise', analiseRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/especies', especiesRoutes);
app.use('/api/racas', racasRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/nutrientes', nutrientesRoutes);
app.use('/api/composicoes-alimentares', composicaoAlimentarRoutes);

app.use('/api/clinica/evolucoes',   evolucaoRoutes);
app.use('/api/clinica/faturas',    faturaRoutes);
app.use('/api/clinica/prescricoes', prescricoesRoutes);

app.use('/api/crmv', crmvRoutes);

// Monitoração de Custo IA
app.use('/api/ai-usage', aiUsageRoutes);

// Servir arquivos de upload (fotos)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

//RBAC Veterinário
app.use('/api/veterinarios', veterinariosRoutes);
app.use('/api/equipes',      equipesRoutes);

// === ROTA DO RELATÓRIO ===
app.use('/api/relatorio', relatorioRoutes);


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
  res.status(404).json({ sucesso: false, mensagem: 'Rota não encontrada' });
});

// ===================== GLOBAL ERROR HANDLER =====================
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error(`${req.method} ${req.path}`, { message: err.message, stack: err.stack });
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    sucesso: false,
    mensagem: status === 500 ? 'Erro interno do servidor' : err.message,
  });
});

app.listen(PORT, () => {
  logger.info(`Servidor rodando na porta ${PORT}`, { port: PORT, env: process.env.NODE_ENV || 'development' });
});

module.exports = app;