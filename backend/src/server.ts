import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import crypto from 'crypto';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import logger from './lib/logger';
import prisma from './lib/prisma';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const requestIdMiddleware = require('./middlewares/requestId');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getEmpresaIdDoVet } = require('./lib/vetUtils');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { garantirFaturaAberta } = require('./services/FaturaService');

// Fuso horário padrão — garante que new Date() e operações de data usem America/Sao_Paulo
process.env.TZ = 'America/Sao_Paulo';
dotenv.config();

// ── Startup security checks ────────────────────────────────────────────────
const _jwtSecret = process.env.JWT_SECRET ?? '';
if (_jwtSecret.length < 32) {
  // eslint-disable-next-line no-console
  process.stderr.write(
    '[FATAL] JWT_SECRET muito fraco (mínimo 32 caracteres).\n' +
    'Gere um seguro com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n'
  );
  process.exit(1);
}

// Extend Express Request with runtime-injected fields
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId?: string;
      empresaId?: number | null;
    }
  }
}

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
app.use(requestIdMiddleware);
app.use(helmet());

// CORS — apenas origens configuradas em ALLOWED_ORIGINS (separadas por vírgula)
const _allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Permite requisições sem origin (Postman, apps mobile, health checks internos)
    if (!origin) return callback(null, true);
    if (_allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origem não permitida — ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id'],
  maxAge: 3600,
}));

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

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
// eslint-disable-next-line @typescript-eslint/no-require-imports
const prescricoesRoutes        = require('./routes/prescricoes');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const farmaciaRoutes           = require('./routes/farmacia');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const medicamentosRoutes       = require('./routes/medicamentos');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const procedimentosRoutes      = require('./routes/procedimentos');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const proprietariosRoutes      = require('./routes/proprietarios');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tratadoresRoutes         = require('./routes/tratadores');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fornecedoresRoutes       = require('./routes/fornecedores');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const localizacoesRoutes       = require('./routes/localizacoes');

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
app.use('/api/clinica/prescricoes',   prescricoesRoutes);
app.use('/api/crmv',                  crmvRoutes);
app.use('/api/ai-usage',              aiUsageRoutes);
app.use('/api/veterinarios',          veterinariosRoutes);
app.use('/api/equipes',               equipesRoutes);
app.use('/api/relatorio',             relatorioRoutes);
app.use('/api/farmacia',              farmaciaRoutes);
app.use('/api/medicamentos',          medicamentosRoutes);
app.use('/api/procedimentos',         procedimentosRoutes);
app.use('/api/cadastro/proprietarios', proprietariosRoutes);
app.use('/api/cadastro/tratadores',   tratadoresRoutes);
app.use('/api/cadastro/fornecedores', fornecedoresRoutes);
app.use('/api/cadastro/localizacoes', localizacoesRoutes);

// Servir arquivos de upload (fotos)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ===================== HEALTH CHECK =====================
const APP_VERSION = process.env.npm_package_version ?? '1.0.0';
const STARTED_AT  = Date.now();

app.get('/', (_req: Request, res: Response) => {
  res.json({ message: 'S2Vet API online', version: APP_VERSION, status: 'ok' });
});

app.get('/health', async (_req: Request, res: Response) => {
  const checks: Record<string, { status: 'ok' | 'error'; latencyMs?: number; error?: string }> = {};

  // Banco de dados — SELECT 1 é a query mais leve possível
  const dbStart = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: 'ok', latencyMs: Date.now() - dbStart };
  } catch (err: unknown) {
    checks.database = {
      status:    'error',
      latencyMs: Date.now() - dbStart,
      error:     err instanceof Error ? err.message : 'unknown',
    };
  }

  const allOk  = Object.values(checks).every(c => c.status === 'ok');
  const mem    = process.memoryUsage();

  res.status(allOk ? 200 : 503).json({
    status:    allOk ? 'ok' : 'degraded',
    version:   APP_VERSION,
    env:       process.env.NODE_ENV ?? 'development',
    uptimeSec: Math.floor((Date.now() - STARTED_AT) / 1000),
    timestamp: new Date().toISOString(),
    checks,
    memory: {
      heapUsedMb: Math.round(mem.heapUsed  / 1024 / 1024),
      rssMb:      Math.round(mem.rss       / 1024 / 1024),
    },
  });
});

// ===================== 404 =====================
app.use((_req: Request, res: Response) => {
  res.status(404).json({ sucesso: false, mensagem: 'Rota não encontrada' });
});

// ===================== GLOBAL ERROR HANDLER =====================
app.use((err: Error & { status?: number; statusCode?: number }, req: Request, res: Response, _next: NextFunction) => {
  logger.error(`${req.method} ${req.path}`, {
    requestId: req.requestId,
    message:   err.message,
    stack:     err.stack,
  });
  const status = err.status ?? err.statusCode ?? 500;
  res.status(status).json({
    sucesso:    false,
    requestId:  req.requestId,
    mensagem:   status === 500 ? 'Erro interno do servidor' : err.message,
  });
});

app.listen(PORT, () => {
  logger.info('Servidor iniciado', { port: PORT, env: process.env.NODE_ENV ?? 'development' });
  agendarSincronizacaoCrmv();
});

// ===================== CRON — ÍNDICE CRMV =====================
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cron                 = require('node-cron');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { executarScraping } = require('./services/crmvScraperService');

function agendarSincronizacaoCrmv() {
  // Diariamente às 23:00 (horário de Brasília)
  cron.schedule('0 23 * * *', () => {
    logger.info('[CRMV-Cron] Iniciando sincronização diária do SISCAD...');
    executarScraping().catch((err: Error) =>
      logger.error(`[CRMV-Cron] Falha na sincronização: ${err.message}`)
    );
  }, { timezone: 'America/Sao_Paulo' });

  logger.info('[CRMV-Cron] Sincronização agendada: diariamente às 23:00 (Brasília)');
}

// ===================== CRON — AUTO-ACEITE DE SOLICITAÇÕES (24h) =====================
// VINCULO e DESVINCULO: updateMany simples para ACEITO.
// TROCA_VET: precisa criar VINCULO PENDENTE para o novo vet antes de marcar ACEITO.
async function autoAceitarSolicitacoesPendentes() {
  const corte = new Date(Date.now() - 24 * 60 * 60 * 1000);
  try {
    const pendentes = await prisma.vetAnimalSolicitacao.findMany({
      where:  { status: 'PENDENTE', updatedAt: { lt: corte } },
      select: {
        id: true, animalId: true, vetUserId: true, tipo: true, novoVetUserId: true, solicitanteId: true,
        animal:          { select: { nome: true, userId: true } },
        veterinario:     { select: { fullName: true, email: true } },
        novoVeterinario: { select: { id: true, fullName: true, email: true } },
      },
    });

    if (pendentes.length === 0) return;

    const trocas   = pendentes.filter(p => p.tipo === 'TROCA_VET');
    const simples  = pendentes.filter(p => p.tipo !== 'TROCA_VET');

    // VINCULO e DESVINCULO → ACEITO direto
    if (simples.length > 0) {
      await prisma.vetAnimalSolicitacao.updateMany({
        where: { id: { in: simples.map(p => p.id) } },
        data:  { status: 'ACEITO', approvalToken: null, expiresAt: null },
      });

      for (const s of simples) {
        if (s.tipo === 'DESVINCULO') {
          // Desvinculo: remove vet e limpa empresa do animal
          await prisma.animal.update({
            where: { id: s.animalId },
            data:  { veterinarioNome: null, veterinarioClinica: null, empresaId: null },
          });
        } else if (s.tipo === 'VINCULO') {
          // Vinculo: associa animal à empresa do vet
          const empId = await getEmpresaIdDoVet(s.vetUserId);
          if (empId) {
            await prisma.animal.update({
              where: { id: s.animalId },
              data:  { empresaId: empId },
            });
          }
          if (s.animal.userId) await garantirFaturaAberta(s.animal.userId);
        }
      }
    }

    // TROCA_VET → aceitar step 1 + criar VINCULO PENDENTE para novo vet
    for (const troca of trocas) {
      if (!troca.novoVetUserId) continue;
      const token  = crypto.randomBytes(32).toString('hex');
      const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await prisma.$transaction([
        prisma.vetAnimalSolicitacao.update({
          where: { id: troca.id },
          data:  { status: 'ACEITO', approvalToken: null, expiresAt: null, novoVetUserId: null },
        }),
        prisma.vetAnimalSolicitacao.upsert({
          where:  { animalId_vetUserId: { animalId: troca.animalId, vetUserId: troca.novoVetUserId } },
          create: {
            animalId:      troca.animalId,
            vetUserId:     troca.novoVetUserId,
            tipo:          'VINCULO',
            status:        'PENDENTE',
            approvalToken: token,
            expiresAt:     expiry,
            solicitanteId: troca.solicitanteId,
          },
          update: {
            tipo:          'VINCULO',
            status:        'PENDENTE',
            approvalToken: token,
            expiresAt:     expiry,
            solicitanteId: troca.solicitanteId,
            mensagem:      null,
          },
        }),
      ]);

      logger.info(`[AutoAceite-Cron] TROCA_VET id=${troca.id} auto-aceita → VINCULO PENDENTE criado para vetUserId=${troca.novoVetUserId}`);
    }

    logger.info(`[AutoAceite-Cron] ${pendentes.length} solicitação(ões) processada(s) após 24h`, {
      simples: simples.map(p => p.id),
      trocas:  trocas.map(p => p.id),
    });
  } catch (err: unknown) {
    logger.error(`[AutoAceite-Cron] Erro: ${err instanceof Error ? err.message : err}`);
  }
}

cron.schedule('0 * * * *', () => {
  autoAceitarSolicitacoesPendentes();
}, { timezone: 'America/Sao_Paulo' });

logger.info('[AutoAceite-Cron] Agendado: verifica a cada hora solicitações PENDENTE > 24h');

// ===================== CRON — CANCELA VÍNCULOS PROVISÓRIOS EXPIRADOS =====================
async function cancelarVinculosProvisionaisExpirados() {
  const agora = new Date();
  try {
    const animaisExpirados = await prisma.animal.findMany({
      where:  { bloqueado: true, bloqueioTipo: 'PROVISIONAL', bloqueioExpira: { lt: agora } },
      select: { id: true, nome: true },
    });

    if (animaisExpirados.length === 0) return;

    for (const animal of animaisExpirados) {
      await prisma.vetAnimalSolicitacao.updateMany({
        where: { animalId: animal.id, tipo: 'VINCULO', status: 'PENDENTE' },
        data:  { status: 'CANCELADO', approvalToken: null, expiresAt: null },
      });
      await prisma.animal.update({
        where: { id: animal.id },
        data:  { bloqueado: false, bloqueioTipo: null, bloqueioExpira: null },
      });
      logger.info(`[Provisional-Cron] Vínculo provisional cancelado — animalId=${animal.id} (${animal.nome})`);
    }

    logger.info(`[Provisional-Cron] ${animaisExpirados.length} vínculo(s) provisional(is) cancelado(s)`);
  } catch (err: unknown) {
    logger.error(`[Provisional-Cron] Erro: ${err instanceof Error ? err.message : err}`);
  }
}

cron.schedule('15 * * * *', () => {
  cancelarVinculosProvisionaisExpirados();
}, { timezone: 'America/Sao_Paulo' });

logger.info('[Provisional-Cron] Agendado: verifica a cada hora vínculos provisórios expirados');

export default app;