import { PrismaClient } from '@prisma/client';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { comTenantAutomatico } = require('./prismaTenant');

// Singleton que evita múltiplas conexões em hot-reload (dev)
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

/**
 * ⚠️ O CLIENT EXPORTADO É O ESTENDIDO (fase 7b do multi-tenancy).
 *
 * `comTenantAutomatico` intercepta toda operação — de modelo, de SQL cru e o início de
 * `$transaction` — e carimba `app.empresa_id` quando há tenant no contexto da
 * requisição (`comEmpresa`, posto pelo middleware `tenantRls`). É o que faz o RLS valer
 * SEM alterar os 60 controllers: eles seguem chamando `prisma.animal.findMany(...)`.
 *
 * Sem tenant no contexto (cron, script, rota pública), a operação passa direto — quem
 * precisa de tenant ali usa `comTenant`/`paraCadaEmpresa` explicitamente.
 *
 * ⚠️ A extensão é aplicada UMA vez, sobre o singleton. Aplicá-la de novo (o client
 * estendido é um objeto NOVO) empilharia interceptadores e cada operação abriria
 * transação dentro de transação.
 */
const base: PrismaClient = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = base;
}

export const prisma: PrismaClient = comTenantAutomatico(base) as PrismaClient;

/**
 * Client SEM a extensão de tenant. Uso restrito e consciente:
 *   • `lib/tenantDb.js` e `lib/cronTenant.js`, que gerenciam a transação eles mesmos;
 *   • scripts de manutenção e migrations de dados.
 * Não usar em controller — ali o tenant tem de ser automático.
 */
export const prismaSemTenant: PrismaClient = base;

export default prisma;
