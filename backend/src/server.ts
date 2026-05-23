import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import logger from './lib/logger';

dotenv.config();

// Roteia todo console.* do processo para Winston
console.log   = (...a: unknown[]) => logger.info(a.join(' '));
console.info  = (...a: unknown[]) => logger.info(a.join(' '));
console.warn  = (...a: unknown[]) => logger.warn(a.join(' '));
console.debug = (...a: unknown[]) => logger.debug(a.join(' '));
console.error = (...a: unknown[]) => logger.error(
  a.map(x => (x instanceof Error ? x.stack : typeof x === 'object' ? JSON.stringify(x) : x)).join(' ')
);

const app = express();
const PORT = Number(process.env.PORT) || 3001;

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
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authRoutes               = require('./routes/auth');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const animaisRoutes            = require('./routes/animais');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const alimentosRoutes          = require('./routes/alimentos');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const dietasRoutes             = require('./routes/dietas');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const examesRoutes             = require('./routes/exames');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const analiseRoutes            = require('./routes/analise');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const auditRoutes              = require('./routes/audit');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const especiesRoutes           = require('./routes/especies');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const racasRoutes              = require('./routes/racas');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const usersRoutes              = require('./routes/users');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nutrientesRoutes         = require('./routes/nutrientes');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const composicaoAlimentarRoutes = require('./routes/composicaoAlimentar');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const crmvRoutes               = require('./routes/crmv');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const veterinariosRoutes       = require('./routes/veterinarios');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const equipesRoutes            = require('./routes/equipes');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const evolucaoRoutes           = require('./routes/evolucao');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const faturaRoutes             = require('./routes/fatura');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const aiUsageRoutes            = require('./routes/aiUsage');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const relatorioRoutes          = require('./routes/relatorio.routes');

// ===================== MONTAGEM DAS ROTAS =====================
app.use('/api/auth',                  authLimiter, authRoutes);
app.use('/api/animais',               animaisRoutes);
app.use('/api/alimentos',             alimentosRoutes);
app.use('/api/dietas',                dietasRoutes);
app.use('/api/exames',                examesRoutes);
app.use('/api/analise',               analiseRoutes);
app.use('/api/audit',                 auditRoutes);
app.use('/api/especies',              especiesRoutes);
app.use('/api/racas',                 racasRoutes);
app.use('/api/users',                 usersRoutes);
app.use('/api/nutrientes',            nutrientesRoutes);
app.use('/api/composicoes-alimentares', composicaoAlimentarRoutes);
app.use('/api/clinica/evolucoes',     evolucaoRoutes);
app.use('/api/clinica/faturas',       faturaRoutes);
app.use('/api/crmv',                  crmvRoutes);
app.use('/api/ai-usage',              aiUsageRoutes);
app.use('/api/veterinarios',          veterinariosRoutes);
app.use('/api/equipes',               equipesRoutes);
app.use('/api/relatorio',             relatorioRoutes);

// Servir arquivos de upload (fotos)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ===================== HEALTH CHECK =====================
app.get('/', (_req: Request, res: Response) => {
  res.json({ message: 'S2Vet API online', version: '1.0.0', status: 'online' });
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'online', timestamp: new Date().toISOString() });
});

// ===================== 404 =====================
app.use((_req: Request, res: Response) => {
  res.status(404).json({ sucesso: false, mensagem: 'Rota não encontrada' });
});

// ===================== GLOBAL ERROR HANDLER =====================
app.use((err: Error & { status?: number; statusCode?: number }, req: Request, res: Response, _next: NextFunction) => {
  logger.error(`${req.method} ${req.path}`, { message: err.message, stack: err.stack });
  const status = err.status ?? err.statusCode ?? 500;
  res.status(status).json({
    sucesso: false,
    mensagem: status === 500 ? 'Erro interno do servidor' : err.message,
  });
});

app.listen(PORT, () => {
  logger.info('Servidor iniciado', { port: PORT, env: process.env.NODE_ENV ?? 'development' });
});

export default app;