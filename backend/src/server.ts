import express, { Request, Response, NextFunction } from 'express';
import type { ServerResponse } from 'http';
import cors from 'cors';
import crypto from 'crypto';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import path from 'path';
import logger from './lib/logger';
import prisma from './lib/prisma';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getAccessTokenFromCookie } = require('./lib/authCookies');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const requestIdMiddleware = require('./middlewares/requestId');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getContextoDoVet } = require('./lib/vetUtils');
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

// ===================== TRUST PROXY =====================
// A app roda atrás de proxy (Cloudflare Tunnel em dev; proxy reverso em prod).
// Sem isto, req.ip retorna o IP do proxy e o express-rate-limit emite
// ValidationError ao ver o header X-Forwarded-For. O valor é o Nº de hops de
// proxy confiáveis (TRUST_PROXY_HOPS, default 1) — evita spoofing do IP do
// cliente (não usar `true`, que confia em qualquer X-Forwarded-For).
const TRUST_PROXY_HOPS = Number(process.env.TRUST_PROXY_HOPS ?? 1);
app.set('trust proxy', TRUST_PROXY_HOPS);

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
  allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id', 'x-empresa-id', 'x-equipe-id'],
  maxAge: 3600,
}));

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// ===================== RATE LIMIT GERAL =====================
// Chave = USUÁRIO autenticado; sem sessão válida, cai no IP.
//
// POR QUÊ (2026-08-02): keyando só por IP, a cota era COLETIVA. Uma clínica atrás de
// um NAT — ou de um túnel/proxy que não repassa o IP real — somava o tráfego de todo
// mundo num balde só, e a equipe inteira levava 429 em uso normal. Com a chave por
// usuário, cada pessoa tem o seu balde e o limite volta a significar "esta conta está
// abusando", que é o que ele deveria dizer.
//
// O token é VERIFICADO (jwt.verify, não decode): token forjado não vira chave nova —
// falha a verificação e a requisição cai no balde do IP. Sem isso, bastaria inventar
// um `id` diferente a cada requisição para ter cota infinita.
// Custo: um HMAC-SHA256 sobre um payload pequeno por requisição — irrelevante perto do
// I/O de banco que vem depois.
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX ?? 300);

function chaveDeLimite(req: Request): string {
  try {
    const token = getAccessTokenFromCookie(req)
      ?? (req.headers.authorization?.startsWith('Bearer ')
            ? req.headers.authorization.slice(7)
            : null);
    if (token && process.env.JWT_SECRET) {
      const payload = jwt.verify(token, process.env.JWT_SECRET) as { id?: number };
      if (payload?.id) return `u:${payload.id}`;
    }
  } catch {
    // token ausente/expirado/inválido → identifica pelo IP, como antes
  }
  // ⚠️ `ipKeyGenerator` e NÃO `req.ip` cru: em IPv6 cada usuário costuma receber um
  // /64 inteiro, então usar o endereço completo daria um balde novo a cada requisição
  // — bastava trocar o último bloco para ter cota infinita. O helper reduz o IPv6 à
  // sub-rede antes de virar chave (IPv4 passa igual). O express-rate-limit valida
  // isso no boot e é o que emitia o ERR_ERL_KEY_GEN_IPV6.
  if (!req.ip) return 'ip:desconhecido';
  return `ip:${ipKeyGenerator(req.ip)}`;
}

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: RATE_LIMIT_MAX,
  keyGenerator: chaveDeLimite,
  standardHeaders: true,
  legacyHeaders: false,
  message: { sucesso: false, mensagem: 'Muitas requisições. Tente novamente em instantes.' },
});

// Rate limiting restrito para as rotas que ADIVINHAM credencial: 20 req/15min por IP.
//
// Só entram aqui login/registro/recuperação de senha — é contra força bruta. NÃO cobre
// `/auth/refresh` e `/auth/logout`: refresh é disparado SOZINHO pelo interceptor do axios
// a cada 401, então incluí-lo fazia o uso normal do sistema consumir a cota de login e o
// usuário levar 429 na tela de entrada com a senha CERTA (relatado em 2026-07-30). Eles
// ficam no limitador geral (200/min), que já barra abuso.
//
// `skipSuccessfulRequests`: quem acertou a senha não gasta cota. O objetivo é limitar
// TENTATIVA errada; sem isso, trocar de conta algumas vezes no mesmo IP (clínica com
// vários usuários atrás de um NAT) esgotava o limite.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { sucesso: false, mensagem: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
});

// Rotas de /api/auth que NÃO são adivinhação de credencial (o app as chama sozinho).
const ROTAS_AUTH_SEM_LIMITE_ESTRITO = ['/refresh', '/logout'];
const authLimiterSeletivo: express.RequestHandler = (req, res, next) =>
  (ROTAS_AUTH_SEM_LIMITE_ESTRITO.includes(req.path) ? next() : authLimiter(req, res, next));

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
const especialidadesRoutes     = require('./routes/especialidades');
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
// eslint-disable-next-line @typescript-eslint/no-require-imports
const encaminhamentosRoutes    = require('./routes/encaminhamentos');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const examesClinicoRoutes      = require('./routes/clinica-exames');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const laboratorioExamesRoutes  = require('./routes/laboratorio-exames');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const imagemExamesRoutes       = require('./routes/imagem-exames');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const resenhaRoutes            = require('./routes/resenha');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const resenhaGraficaRoutes     = require('./routes/resenha-grafica');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const agendaRoutes             = require('./routes/agenda');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const vacinaAdminRoutes        = require('./routes/vacinaAdmin');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const vacinaClinicaRoutes      = require('./routes/vacinaClinica');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const estoqueVacinaRoutes      = require('./routes/estoqueVacina');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const dashboardRoutes          = require('./routes/dashboard');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mapaAtendimentoRoutes    = require('./routes/mapa-atendimento');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const relatoriosGerenciaisRoutes = require('./routes/relatoriosGerenciais');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const monitoracaoRoutes        = require('./routes/monitoracao');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const orcamentosRoutes         = require('./routes/orcamentos');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const buscaRoutes              = require('./routes/busca');
const midiaRoutes              = require('./routes/midia');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { TETO_ARQUIVO_BYTES }   = require('./storage');

// ===================== MONTAGEM DAS ROTAS =====================
app.use('/api/auth',                  authLimiterSeletivo, authRoutes);
app.use('/api/animais',               animaisRoutes);
app.use('/api/alimentos',             alimentosRoutes);
app.use('/api/dietas',                dietasRoutes);
app.use('/api/exames',                examesRoutes);
app.use('/api/analise',               analiseRoutes);
app.use('/api/audit',                 auditRoutes);
app.use('/api/especies',              especiesRoutes);
app.use('/api/especialidades',        especialidadesRoutes);
app.use('/api/racas',                 racasRoutes);
app.use('/api/users',                 usersRoutes);
app.use('/api/nutrientes',            nutrientesRoutes);
app.use('/api/composicoes-alimentares', composicaoAlimentarRoutes);
app.use('/api/clinica/evolucoes',     evolucaoRoutes);
app.use('/api/clinica/faturas',       faturaRoutes);
app.use('/api/clinica/prescricoes',   prescricoesRoutes);
app.use('/api/clinica/encaminhamentos', encaminhamentosRoutes);
app.use('/api/clinica/exames',         examesClinicoRoutes);
app.use('/api/clinica/laboratorios',   laboratorioExamesRoutes);
app.use('/api/clinica/imagem-exames',  imagemExamesRoutes);
app.use('/api/resenha',               resenhaRoutes);
app.use('/api/animais/:animalId/resenha', resenhaGraficaRoutes);
app.use('/api/clinica',               agendaRoutes); // /historico e /agendamentos
// eslint-disable-next-line @typescript-eslint/no-require-imports
app.use('/api/webhooks',              require('./routes/webhooks')); // Evolution API (token via query)
app.use('/api/crmv',                  crmvRoutes);
app.use('/api/ai-usage',              aiUsageRoutes);
app.use('/api/veterinarios',          veterinariosRoutes);
app.use('/api/equipes',               equipesRoutes);
app.use('/api/relatorio',             relatorioRoutes);
app.use('/api/farmacia',              farmaciaRoutes);
app.use('/api/medicamentos',          medicamentosRoutes);
app.use('/api/procedimentos',         procedimentosRoutes);
app.use('/api/orcamentos',            orcamentosRoutes);
app.use('/api/cadastro/proprietarios', proprietariosRoutes);
app.use('/api/cadastro/tratadores',   tratadoresRoutes);
app.use('/api/cadastro/fornecedores', fornecedoresRoutes);
app.use('/api/cadastro/localizacoes', localizacoesRoutes);
app.use('/api/admin/vacinas',         vacinaAdminRoutes);
app.use('/api/clinica/vacinas',       vacinaClinicaRoutes);
app.use('/api/vacinas/estoque',       estoqueVacinaRoutes);
app.use('/api/dashboard',             dashboardRoutes);
app.use('/api/mapa-atendimento',      mapaAtendimentoRoutes);
app.use('/api/relatorios',            relatoriosGerenciaisRoutes);
app.use('/api/monitoracao',           monitoracaoRoutes);
app.use('/api/busca',                 buscaRoutes); // busca global do header
app.use('/api/midia',                 midiaRoutes); // download AUTORIZADO de arquivo (substitui /uploads)
// Marca do PRODUTO — pública por necessidade (aparece na tela de login, antes de haver
// sessão). Rota SEPARADA e sem parâmetro: não recebe chave do cliente, então não serve
// para alcançar arquivo de paciente.
// eslint-disable-next-line @typescript-eslint/no-require-imports
app.get('/api/marca', require('./controllers/MidiaController').marca);
// Configuração global de segurança (2FA da plataforma) — ADMIN
// eslint-disable-next-line @typescript-eslint/no-require-imports
app.use('/api/seguranca',             require('./routes/seguranca'));

// ===================== ARQUIVOS =====================
// NÃO existe mais NENHUM serviço de arquivo a partir do filesystem.
//
// O `express.static('/uploads')` foi removido: ele entregava o byte SEM autenticação,
// tendo como único gate o nome aleatório do arquivo (capability URL) — quem obtivesse
// o link seguia lendo a foto do paciente ou o laudo mesmo depois de perder o acesso, e
// de qualquer empresa. Todo arquivo mora em `tb_midia_arquivos` (bytea) e sai por:
//   GET /api/midia/:chave  → autenticado e autorizado por dono (animal/empresa)
//   GET /api/marca         → público, e SÓ a marca do produto
// Sem código de servir arquivo do disco, ninguém reintroduz um static por descuido.

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
app.use((err: Error & { status?: number; statusCode?: number; code?: string; detalhe?: unknown }, req: Request, res: Response, _next: NextFunction) => {
  // Quota de IA estourada não é erro do servidor: é limite de plano do cliente.
  // 429 + code para o front tratar sem cair no interceptor genérico de erro.
  if (err.code === 'IA_QUOTA_EXCEDIDA') {
    logger.warn(`${req.method} ${req.path} — quota de IA excedida`, {
      requestId: req.requestId, message: err.message,
    });
    return res.status(429).json({
      sucesso:  false,
      code:     'IA_QUOTA_EXCEDIDA',
      mensagem: err.message,
      error:    err.message,
      detalhe:  err.detalhe ?? null,
    });
  }

  // Arquivo acima do teto (150 MB) não é erro do servidor: é o usuário mandando algo
  // grande demais. 413 + code para a tela dizer o motivo em vez de "erro interno".
  // Cobre as DUAS bordas: `LIMIT_FILE_SIZE` do multer (recusa antes de ler o corpo
  // inteiro) e `ARQUIVO_GRANDE_DEMAIS` do provider de storage (rede de segurança para
  // rota sem `limits` declarado).
  if (err.code === 'LIMIT_FILE_SIZE' || err.code === 'ARQUIVO_GRANDE_DEMAIS') {
    logger.warn(`${req.method} ${req.path} — arquivo acima do limite`, {
      requestId: req.requestId, message: err.message,
    });
    const limiteMb = Math.floor(TETO_ARQUIVO_BYTES / 1048576);
    return res.status(413).json({
      sucesso:  false,
      code:     'ARQUIVO_GRANDE_DEMAIS',
      mensagem: `Arquivo acima do limite de ${limiteMb} MB.`,
      error:    `Arquivo acima do limite de ${limiteMb} MB.`,
    });
  }

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
  // Agenda todas as tarefas com base em CronAgenda (banco), aplicando os padrões
  // quando não configurado. Reagendamento posterior é ao vivo (cronManager.reagendar).
  iniciarJobs().catch((e: unknown) => logger.error(`[CronManager] Falha ao iniciar jobs: ${e instanceof Error ? e.message : e}`));
});

// ===================== CRON — TAREFAS AGENDADAS (agenda dinâmica no banco) =====================
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { executarScraping } = require('./services/crmvScraperService');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { reportarCron } = require('./lib/cronAlert');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { registrarJob, iniciarJobs } = require('./lib/cronManager');

// Executa uma tarefa agendada e reporta (e-mail ao ADMIN + registro na Monitoração):
// - ERRO (throw ou retorno { ok:false }): SEMPRE reportado; e-mail conforme config.
// - SUCESSO: reportado/alertado só quando a tarefa retorna { notificar:true } —
//   evita spam nos crons frequentes (ex: WhatsApp a cada 15 min) sem trabalho.
// A decisão de enviar e-mail e o destinatário vêm da config (reportarCron).
type ResultadoCron = { ok?: boolean; notificar?: boolean; resumo?: string; erro?: string } | void;
async function comAlerta(nome: string, fn: () => Promise<ResultadoCron>) {
  let r: ResultadoCron;
  try {
    r = await fn();
  } catch (err: unknown) {
    r = { ok: false, erro: err instanceof Error ? (err.stack || err.message) : String(err) };
  }
  if (!r) return;
  if (r.ok === false) logger.error(`[Cron:${nome}] ERRO: ${r.erro}`);
  await reportarCron(nome, r);
}

registrarJob('crmv_sync', {
  nome: 'Sincronização CRMV (SISCAD)',
  exprPadrao: '0 23 * * *', // diariamente às 23:00
  fn: () => comAlerta('Sincronização CRMV (SISCAD)', async () => {
    logger.info('[CRMV-Cron] Iniciando sincronização diária do SISCAD...');
    await executarScraping();
    return { ok: true, notificar: true, resumo: 'Sincronização diária do índice CRMV (SISCAD) concluída com sucesso.' };
  }),
});

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

    if (pendentes.length === 0) return { ok: true, notificar: false };

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
          // Desvinculo: remove vet e limpa empresa/equipe do animal
          await prisma.animal.update({
            where: { id: s.animalId },
            data:  { veterinarioNome: null, veterinarioClinica: null, empresaId: null, equipeId: null },
          });
        } else if (s.tipo === 'VINCULO') {
          // Vinculo: associa animal à empresa/equipe do vet
          const ctx = await getContextoDoVet(s.vetUserId);
          if (ctx.empresaId) {
            await prisma.animal.update({
              where: { id: s.animalId },
              data:  { empresaId: ctx.empresaId, equipeId: ctx.equipeId },
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
    return {
      ok: true,
      notificar: true,
      resumo: `${pendentes.length} solicitação(ões) auto-aceita(s) após 24h — ${simples.length} vínculo/desvínculo e ${trocas.length} troca(s) de vet.`,
    };
  } catch (err: unknown) {
    return { ok: false, erro: err instanceof Error ? (err.stack || err.message) : String(err) };
  }
}

registrarJob('auto_aceite', {
  nome: 'Auto-aceite de solicitações (24h)',
  exprPadrao: '0 * * * *', // a cada hora
  fn: () => comAlerta('Auto-aceite de solicitações (24h)', autoAceitarSolicitacoesPendentes),
});

// ===================== CRON — CANCELA VÍNCULOS PROVISÓRIOS EXPIRADOS =====================
async function cancelarVinculosProvisionaisExpirados() {
  const agora = new Date();
  try {
    const animaisExpirados = await prisma.animal.findMany({
      where:  { bloqueado: true, bloqueioTipo: 'PROVISIONAL', bloqueioExpira: { lt: agora } },
      select: { id: true, nome: true },
    });

    if (animaisExpirados.length === 0) return { ok: true, notificar: false };

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
    return {
      ok: true,
      notificar: true,
      resumo: `${animaisExpirados.length} vínculo(s) provisional(is) expirado(s) cancelado(s).`,
    };
  } catch (err: unknown) {
    return { ok: false, erro: err instanceof Error ? (err.stack || err.message) : String(err) };
  }
}

registrarJob('vinculos_provisorios', {
  nome: 'Cancelamento de vínculos provisórios',
  exprPadrao: '15 * * * *', // a cada hora (minuto 15)
  fn: () => comAlerta('Cancelamento de vínculos provisórios', cancelarVinculosProvisionaisExpirados),
});

// ===================== CRON — LEMBRETE D-1 (agendamentos de amanhã) =====================
// eslint-disable-next-line @typescript-eslint/no-require-imports
const emailServiceCron = require('./services/emailService');

async function enviarLembretesAgendamentos() {
  try {
    const amanha  = new Date();
    amanha.setDate(amanha.getDate() + 1);
    const inicio  = new Date(amanha); inicio.setHours(0,  0,  0, 0);
    const fim     = new Date(amanha); fim.setHours(23, 59, 59, 999);

    const agendamentos = await prisma.agendamentoClinico.findMany({
      where: { ativo: true, status: 'AGENDADO', dataHora: { gte: inicio, lte: fim } },
      include: {
        animal:      { include: { user: { select: { fullName: true, email: true } } } },
        veterinario: { select: { fullName: true, phone: true } },
      },
    });

    logger.info(`[Lembrete-Cron] ${agendamentos.length} agendamento(s) para amanhã`);

    let enviados = 0;
    for (const ag of agendamentos) {
      const proprietarioEmail = ag.animal?.user?.email;
      if (!proprietarioEmail) continue;
      try {
        await emailServiceCron.enviarLembreteDiaAnteriorProprietario({
          proprietarioEmail,
          proprietarioNome: ag.animal?.user?.fullName  ?? 'Proprietário',
          animalNome:       ag.animal?.nome            ?? 'Animal',
          vetNome:          ag.veterinario?.fullName   ?? 'Veterinário',
          vetPhone:         ag.veterinario?.phone      ?? '',
          dataHora:         ag.dataHora,
        });
        enviados++;
      } catch (err: unknown) {
        logger.warn(`[Lembrete-Cron] Falha ao enviar lembrete para ${proprietarioEmail}: ${(err as Error).message}`);
      }
    }
    return {
      ok: true,
      notificar: agendamentos.length > 0,
      resumo: `${enviados} lembrete(s) D-1 enviado(s) por e-mail, de ${agendamentos.length} agendamento(s) para amanhã.`,
    };
  } catch (err: unknown) {
    return { ok: false, erro: err instanceof Error ? (err.stack || err.message) : String(err) };
  }
}

registrarJob('lembrete_d1_email', {
  nome: 'Lembretes de agendamento D-1 (e-mail)',
  exprPadrao: '0 8 * * *', // diariamente às 08:00
  fn: () => comAlerta('Lembretes de agendamento D-1 (e-mail)', enviarLembretesAgendamentos),
});


// ===================== CRON — LEMBRETES POR WHATSAPP (1h e 15min antes) =====================
// Enviados a proprietário E veterinário. Idempotência por flag (lembreteWa1hEnviadoEm /
// lembreteWa15minEnviadoEm — migration 20260721000000): cada tier dispara no máximo
// uma vez. O envio real é abstraído por messaging/whatsappProvider (noop por padrão —
// apenas loga). Plugar um provedor via env WHATSAPP_PROVIDER quando houver credenciais.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { enviarLembretesWhatsapp } = require('./services/lembreteAgendamentoService');

registrarJob('lembrete_whatsapp', {
  nome: 'Lembretes de agendamento por WhatsApp (1h/15min)',
  exprPadrao: '*/5 * * * *', // a cada 5 minutos — granularidade fina para o tier de 15min
  fn: () => comAlerta('Lembretes de agendamento por WhatsApp (1h/15min)', async () => {
    const r = await enviarLembretesWhatsapp();
    if (r.enviados > 0) logger.info(`[Lembrete-WA] ${r.enviados} lembrete(s) enviado(s) de ${r.verificados} agendamento(s) na janela`);
    // Resumo detalhado (para quem + o que foi enviado) — visível ao clicar na
    // execução na tela de Monitoração.
    const cabecalho = `${r.enviados} lembrete(s) de WhatsApp enviado(s) de ${r.verificados} agendamento(s) na janela.`;
    const resumo = r.detalhes?.length > 0 ? `${cabecalho}\n\n${r.detalhes.join('\n\n')}` : cabecalho;
    // Só alerta o admin quando de fato enviou algo (roda a cada 5 min → evita spam)
    return { ok: true, notificar: r.enviados > 0, resumo };
  }),
});

// ===================== CRON — FECHAMENTO AUTOMÁTICO DE FATURAS =====================
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { adicionarAssistenciaMensal, recalcularTotal } = require('./controllers/FaturaController');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getEquipeIdsDoProprietario } = require('./middlewares/permissao.middleware');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { deveFecharHoje } = require('./lib/faturaUtils');

interface ConfigFechamento {
  tipoFechamento: string | null;
  diaFechamentoFatura: number | null;
}

const FALLBACK_ULTIMO_DIA_MES: ConfigFechamento = { tipoFechamento: 'ULTIMO_DIA_MES', diaFechamentoFatura: null };

// Resolve as configurações de fechamento (EmpresaConfiguracao) das equipes/empresas do
// proprietário. Escopo: empresa com CNPJ → configuração por empresa; empresa pessoal
// (CNPJ null) → configuração por equipe — mesmo critério de EquipeController.resolverEscopoConfiguracao.
// Retorna [] quando não há nenhuma configuração aplicável (proprietário sem equipe, ou nenhuma
// EmpresaConfiguracao criada ainda) — o caller cai no fallback do último dia do mês (comportamento
// anterior, preservado).
async function resolverConfigsFechamento(proprietarioId: number | null): Promise<ConfigFechamento[]> {
  if (!proprietarioId) return [];
  const equipeIds: number[] = await getEquipeIdsDoProprietario(proprietarioId);
  if (equipeIds.length === 0) return [];

  const equipes = await prisma.equipe.findMany({
    where:  { id: { in: equipeIds } },
    select: { id: true, empresaId: true, empresa: { select: { cnpj: true } } },
  });

  const escopos = new Map<string, { empresaId: number; equipeId: number | null }>();
  for (const eq of equipes) {
    const escopo = eq.empresa.cnpj
      ? { empresaId: eq.empresaId, equipeId: null }
      : { empresaId: eq.empresaId, equipeId: eq.id };
    escopos.set(`${escopo.empresaId}:${escopo.equipeId}`, escopo);
  }
  if (escopos.size === 0) return [];

  return prisma.empresaConfiguracao.findMany({
    where:  { OR: [...escopos.values()] },
    select: { tipoFechamento: true, diaFechamentoFatura: true },
  });
}

async function fecharFaturasDoMes() {
  try {
    const hoje = new Date();
    // Sem `include` do proprietário de propósito: `users.valorAssistencia`/`mensalista`
    // são campos LEGADOS (o cadastro é por empresa em ProprietarioPerfil desde a
    // migration 20260724000000). Quem resolve o valor é `adicionarAssistenciaMensal`.
    const faturas = await prisma.fatura.findMany({
      where:  { status: 'ABERTA' },
      select: { id: true, proprietarioId: true, empresaId: true },
    });

    logger.info(`[FaturaFechamento-Cron] ${faturas.length} fatura(s) ABERTA(s) — verificando dia de fechamento`);

    let fechadas = 0;
    for (const fatura of faturas) {
      try {
        const configs = await resolverConfigsFechamento(fatura.proprietarioId);
        const deveFechar = configs.length > 0
          ? configs.some((c: ConfigFechamento) => deveFecharHoje(c, hoje))
          : deveFecharHoje(FALLBACK_ULTIMO_DIA_MES, hoje); // fallback: nenhuma equipe/empresa do proprietário configurou fechamento

        if (!deveFechar) continue;

        // A assistência é a da EMPRESA DA FATURA. Só fatura legada (empresaId null,
        // anterior à migration 20260812000000) cai na dedução por ProprietarioPerfil.
        await adicionarAssistenciaMensal(fatura.id, fatura.proprietarioId, null, fatura.empresaId);

        const total = await recalcularTotal(fatura.id);

        await prisma.fatura.update({
          where: { id: fatura.id },
          data:  { status: 'FECHADA', total },
        });

        fechadas++;
        logger.info(`[FaturaFechamento-Cron] Fatura id=${fatura.id} fechada (total=${total})`);
      } catch (err: unknown) {
        logger.error(`[FaturaFechamento-Cron] Erro na fatura id=${fatura.id}: ${(err as Error).message}`);
      }
    }

    logger.info(`[FaturaFechamento-Cron] Concluído — ${fechadas}/${faturas.length} fatura(s) fechada(s)`);
    return {
      ok: true,
      notificar: fechadas > 0,
      resumo: `${fechadas} fatura(s) fechada(s) automaticamente hoje (de ${faturas.length} fatura(s) ABERTA(s) verificada(s)).`,
    };
  } catch (err: unknown) {
    return { ok: false, erro: err instanceof Error ? (err.stack || err.message) : String(err) };
  }
}

// Executa todo dia às 23:45 (Brasília) — cada fatura decide se fecha hoje com base no dia
// configurado (EmpresaConfiguracao.diaFechamentoFatura) da equipe/empresa do proprietário,
// com fallback para o último dia do mês quando nada foi configurado.
registrarJob('fechamento_faturas', {
  nome: 'Fechamento automático de faturas',
  exprPadrao: '45 23 * * *', // diariamente às 23:45
  fn: () => comAlerta('Fechamento automático de faturas', fecharFaturasDoMes),
});

// Marca como ATRASADA toda fatura FECHADA cujo vencimento já passou e não foi paga.
// Vencimento = dia `diaVencimentoFatura` do proprietário no mês SEGUINTE ao mesReferencia.
async function marcarFaturasAtrasadas() {
  try {
    const hoje = new Date();
    // Só FECHADA: PAGA (marcada manualmente em "Marcar como Pago") e CANCELADA nunca
    // atrasam; ABERTA ainda não venceu — ela primeiro fecha, pela configuração de
    // fechamento da EMPRESA (fecharFaturasDoMes/deveFecharHoje), e só depois vence.
    const faturas = await prisma.fatura.findMany({
      where:  { status: 'FECHADA', mesReferencia: { not: null } },
      select: { id: true, mesReferencia: true, proprietarioId: true, empresaId: true },
    });

    // O dia de vencimento é o do cadastro do cliente NAQUELA EMPRESA
    // (`ProprietarioPerfil.diaVencimentoFatura`, a tela de Proprietários). Ler de
    // `users` — como era feito aqui — pegava o valor legado/global: o mesmo cliente
    // pode vencer dia 5 numa clínica e dia 20 na outra.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { diaVencimentoDoProprietario } = require('./controllers/FaturaController');

    let atrasadas = 0;
    for (const fatura of faturas) {
      try {
        const dia = await diaVencimentoDoProprietario(fatura.proprietarioId, fatura.empresaId);
        if (!dia || !fatura.mesReferencia) continue;
        const [y, m] = String(fatura.mesReferencia).split('-').map(Number);
        if (!y || !m) continue;
        // m (1-based) usado como monthIndex → mês SEGUINTE ao de referência; fim do dia.
        const vencimento = new Date(y, m, Math.min(dia, 28), 23, 59, 59, 999);
        if (hoje > vencimento) {
          await prisma.fatura.update({ where: { id: fatura.id }, data: { status: 'ATRASADA' } });
          atrasadas++;
          logger.info(`[FaturaAtraso-Cron] Fatura id=${fatura.id} marcada como ATRASADA (venc=${vencimento.toISOString().slice(0,10)})`);
        }
      } catch (err: unknown) {
        logger.error(`[FaturaAtraso-Cron] Erro na fatura id=${fatura.id}: ${(err as Error).message}`);
      }
    }

    logger.info(`[FaturaAtraso-Cron] Concluído — ${atrasadas} fatura(s) marcada(s) como ATRASADA`);
    return {
      ok: true,
      notificar: atrasadas > 0,
      resumo: `${atrasadas} fatura(s) marcada(s) como ATRASADA (fechadas, vencidas e não pagas).`,
    };
  } catch (err: unknown) {
    return { ok: false, erro: err instanceof Error ? (err.stack || err.message) : String(err) };
  }
}

// Executa todo dia às 00:30 — marca faturas FECHADAS vencidas e não pagas como ATRASADAS.
registrarJob('marcar_faturas_atrasadas', {
  nome: 'Marcação de faturas atrasadas',
  exprPadrao: '30 0 * * *', // diariamente às 00:30
  fn: () => comAlerta('Marcação de faturas atrasadas', marcarFaturasAtrasadas),
});

// ===================== CRON — CANCELAMENTO DE AGENDAMENTOS NÃO REALIZADOS =====================
// Corporativo (todas as empresas). Liga/desliga e horário ficam sob controle do ADMIN
// na tela de Configuração (CronAgenda). Cancela os agendamentos ainda AGENDADO cujo
// horário já passou (não realizados/CONCLUIDO), preservando os EM_ANDAMENTO e futuros.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { cancelarAgendamentosNaoRealizados, marcarAgendamentosAtrasados } = require('./services/agendamentoCronService');
registrarJob('cancelar_agendamentos_nao_realizados', {
  nome: 'Cancelamento de agendamentos não realizados',
  exprPadrao: '30 23 * * *', // diariamente às 23:30
  fn: () => comAlerta('Cancelamento de agendamentos não realizados', cancelarAgendamentosNaoRealizados),
});

// Marca como ATRASADA o agendamento AGENDADO cujo horário + 30min já passou (status
// meramente informativo — Agendamentos e Mapa de Atendimento exibem o badge).
// Roda a cada 10 minutos: granularidade suficiente para a tolerância de 30min.
registrarJob('marcar_agendamentos_atrasados', {
  nome: 'Marcação de agendamentos atrasados',
  exprPadrao: '*/10 * * * *',
  fn: () => comAlerta('Marcação de agendamentos atrasados', marcarAgendamentosAtrasados),
});

// ===================== CRON — CANCELAMENTO DE PRESCRIÇÕES NÃO EXECUTADAS =====================
// Corporativo (todas as empresas). Grupos FINALIZADO cuja janela de tratamento de todos os
// itens já passou: sem nenhuma execução → CANCELADO; execução parcial → CANCELADO_PARCIALMENTE
// (itens não executados cancelados, executados/faturados preservados). Libera reservas de estoque.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { cancelarPrescricoesNaoExecutadas } = require('./services/prescricaoCronService');
registrarJob('cancelar_prescricoes_nao_executadas', {
  nome: 'Cancelamento de prescrições não executadas',
  exprPadrao: '40 23 * * *', // diariamente às 23:40
  fn: () => comAlerta('Cancelamento de prescrições não executadas', cancelarPrescricoesNaoExecutadas),
});

// ===================== CRON — CANCELAMENTO DE ORÇAMENTOS VENCIDOS =====================
// Corporativo (todas as empresas que configuraram "Validade do orçamento"). Orçamento
// que passou do prazo sem aprovação (nem parcial) vira CANCELADO. Empresa sem validade
// configurada não expira nada.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { cancelarOrcamentosVencidos } = require('./services/orcamentoCronService');
registrarJob('cancelar_orcamentos_vencidos', {
  nome: 'Cancelamento de orçamentos vencidos',
  exprPadrao: '50 23 * * *', // diariamente às 23:50
  fn: () => comAlerta('Cancelamento de orçamentos vencidos', cancelarOrcamentosVencidos),
});

// ===================== CRON — HIGIENE DOS DESAFIOS DE 2FA =====================
// Remove desafios de segundo fator vencidos/consumidos com mais de 24h. Sem isso
// a tabela cresce indefinidamente (um registro por tentativa de login).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { limparDesafiosAntigos } = require('./services/mfaService');
registrarJob('limpeza_desafios_2fa', {
  nome: 'Limpeza de desafios de 2FA',
  exprPadrao: '15 4 * * *', // diariamente às 04:15
  fn: () => comAlerta('Limpeza de desafios de 2FA', async () => {
    const removidos = await limparDesafiosAntigos();
    // notificar só quando houve trabalho — evita e-mail diário de rotina
    return removidos > 0 ? { ok: true, notificar: true, resumo: `${removidos} desafios removidos.` } : undefined;
  }),
});

export default app;