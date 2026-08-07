// backend/src/__tests__/tenancyRls.test.js
//
// GATE DE ARQUITETURA MULTI-TENANT — fase 1 de docs/MULTI-TENANCY-PLANO.md
//
// POR QUE ESTE TESTE EXISTE
// Esquecer um `checkPermission` numa rota dá 403 em algum lugar: alguém percebe. Esquecer
// RLS numa tabela nova NÃO DÁ NADA — a aplicação funciona, os testes passam, e aquela
// tabela simplesmente não tem isolamento. Você descobre quando um cliente vê o dado de
// outro. A ausência de policy é invisível em runtime; este teste é o que a torna visível.
//
// COMO ELE FUNCIONA
// Três listas, mantidas À MÃO neste arquivo, cobrindo as 90 tabelas do schema:
//
//   TENANT_PLANE     → JÁ protegida: exige ENABLE + FORCE + ao menos uma policy
//   AGUARDANDO_RLS   → vai ser protegida, ainda não foi (a migração em andamento)
//   SEM_RLS          → control plane e catálogo global: NUNCA terá RLS, por decisão
//
// A trava de verdade é a asserção 2: **tabela que não esteja em nenhuma das três reprova
// o build**. O teste não decide se `tb_nova_coisa` é de tenant — ele obriga alguém a
// decidir, no PR, com o contexto fresco. É o que transforma "lembrar de proteger" em
// "não conseguir esquecer".
//
// CONFORME AS FASES AVANÇAM: a tabela sai de AGUARDANDO_RLS e entra em TENANT_PLANE, na
// mesma migration que criou a policy. Quando AGUARDANDO_RLS ficar vazia, a migração
// acabou — a lista é o placar.

const { PrismaClient } = require('@prisma/client');

const SCHEMA = 'schs2vet';

// ─── TENANT PLANE — protegidas por RLS ────────────────────────────────────────
// Vazia na fase 1: nenhuma tabela tem RLS ainda (medido — 0 de 90).
const TENANT_PLANE = [
  // ✅ FASE 6 — a CANÁRIA. ENABLE + FORCE + policy com USING e WITH CHECK, provada
  // por `__tests__/rlsCanario.test.js` (isolamento de leitura, escrita e update, e
  // ausência de vazamento do tenant entre transações do pool).
  'tb_movimentos_estoque',
  // ✅ 2026-08-06 — DEFESA EM PROFUNDIDADE na tabela mais sensível (dado pessoal +
  // remuneração). Migrou de SEM_RLS (era control plane) para cá porque o gate DEVE
  // verificá-la: foi ligada com ENABLE+FORCE+policy por empresa (migration
  // 20260806240000). O login lê-a fora de contexto — resolvido carimbando empresa em
  // `resolverTipoNoContexto` e escopo de plataforma em `podeAcessarSistema`/
  // `empresasSemAcesso` (todas por user_id). Ver §16.5 do plano.
  'tb_usuario_empresa',
];

// ─── AGUARDANDO RLS — são de tenant, ainda sem policy ─────────────────────────
// Fonte: backend/scripts/inventarioTenancy.js + decisões D1–D10 do plano.
const AGUARDANDO_RLS = [
  // TENANT DIRETO — já têm a coluna de empresa (24, menos tb_ia_plano_empresa → control plane)
  'tb_agendamentos_clinicos', 'tb_ai_usage_logs', 'tb_animais', 'tb_empresa_configuracoes',
  'tb_equipes', 'tb_estoque_clinica', 'tb_evolucoes_clinicas', 'tb_fatura_item_catalogo',
  'tb_faturas', 'tb_fornecedores', 'tb_lotes_vacina', 'tb_midia_arquivos', 'tb_orcamentos',
  'tb_prescricao_grupos', 'tb_procedimento_combos', 'tb_procedimento_valores_empresa',
  'tb_profissional_perfis', 'tb_proprietario_localidades', 'tb_proprietario_perfis',
  'tb_resumo_atendimento_ia', 'tb_tratadores', 'tb_usuario_especialidades',

  // TENANT VIA PAI — herdam por FK; ganham `empresa_id` na fase 5 (33)
  'tb_convites_equipe', 'tb_designacoes_prestador', 'tb_dieta',
  'tb_encaminhamentos_clinicos', 'tb_evolucao_midias', 'tb_exame_clinico_resultado_itens',
  'tb_exame_imagem_anexos', 'tb_exames_clinicos', 'tb_exames_nutricionais',
  'tb_fatura_itens', 'tb_fornecedor_especialidades', 'tb_matriz_perfis',
  'tb_membro_locais_trabalho', 'tb_membros_equipe',
  // `tb_movimentos_estoque` SAIU daqui na fase 6 — foi promovida a TENANT_PLANE (a canária)
  'tb_ocorrencias_saude', 'tb_orcamento_itens', 'tb_perfis_equipe',
  'tb_permissoes_membros', 'tb_permissoes_proprietarios', 'tb_planos_dieta',
  'tb_prescricoes', 'tb_procedimento_combo_itens', 'tb_relatorios_salvos',
  'tb_resenha_equino', 'tb_resenha_grafica', 'tb_resenha_traco_regiao',
  'tb_reservas_estoque', 'tb_vacinas_clinicas', 'tb_vet_especies', 'tb_vet_perfil',
  'tb_vet_subespecialidades',
  // ✅ `tb_vet_animal_solicitacoes` SAIU daqui na fase 3 — a tabela foi removida
  // (migration 20260806000000). Foi o teste 3 ("nem citam tabela inexistente") que
  // apontou a divergência assim que o DROP rodou: a lista ainda a classificava.

  // CATÁLOGO MISTO — parte global, parte da empresa. Policy da forma (2) do §4.1:
  // lê o global, mas só grava/altera o próprio. Medido:
  //   tb_localizacoes_animal 5.192 globais + 7 de empresa   ← estava escondida como
  //     catálogo puro; o `empresaId` dela denunciou (CLAUDE.md: ADMIN cria SYSTEM,
  //     os demais criam CLIENTE)
  //   tb_medicamentos        4.876 globais + 2 de empresa
  //   tb_procedimentos_vet     938 globais + 2 de empresa
  //   tb_vacinas             vazia — a coluna `empresa_id` ainda precisa ser criada
  'tb_localizacoes_animal', 'tb_medicamentos', 'tb_procedimentos_vet', 'tb_vacinas',

  // PENDENTES resolvidas em D8: modelos de laudo, cada clínica monta o seu
  'tb_exame_grupos', 'tb_exame_itens', 'tb_imagem_exame_grupos', 'tb_imagem_exame_itens',
];

// ─── SEM RLS — control plane e catálogo global, por decisão ───────────────────
const SEM_RLS = [
  // CONTROL PLANE — o cadastro do SaaS não é de nenhum tenant, e o login precisa ler
  // parte disto ANTES de existir tenant (§7.2 do plano)
  '_prisma_migrations', 'tb_auditoria_permissoes', 'tb_configuracao_seguranca',
  'tb_cron_agenda', 'tb_cron_alerta_config', 'tb_cron_execucoes', 'tb_empresas',
  'tb_mfa_desafios', 'tb_modulos_sistema', 'tb_password_history',
  'users',
  // Plano comercial: só o ADMIN da plataforma escreve, e ele lê cross-tenant
  'tb_ia_plano_empresa',
  // Fase 2 — cadastro do SaaS. `tb_planos` é catálogo global (não é de empresa nenhuma);
  // `tb_assinaturas_empresa` TEM `empresa_id`, mas é control plane pelo mesmo motivo de
  // `tb_usuario_empresa`: o login precisa saber se a empresa está SUSPENSA (D3) ANTES de
  // existir tenant resolvido. Pô-la sob RLS criaria o deadlock de "para saber se pode
  // entrar, precisa já ter entrado".
  'tb_planos', 'tb_assinaturas_empresa',
  // ⚠️ `tb_audit_logs` — D11 RESOLVIDA: é TENANT PLANE, com a policy (b)
  // `empresa_id = tenant` e **sem** `OR IS NULL` (a mista faria todo gestor ver o
  // LOGIN/LOGOUT de todas as clínicas). As 911 linhas sem empresa foram apagadas na
  // fase 4. Continua nesta lista só até a FASE 7 criar a policy — o nulo que ainda
  // nasce em runtime (LOGIN antes de haver empresa resolvida) é evento de PLATAFORMA,
  // e a policy (b) já o restringe ao ADMIN.
  'tb_audit_logs',

  // CATÁLOGO GLOBAL PURO — ninguém cria linha própria
  'tb_alimentos', 'tb_crmv_sync_log', 'tb_crmv_validos', 'tb_especialidades',
  'tb_especies', 'tb_exigencias_nrc', 'tb_laboratorios', 'tb_medicamento_especies',
  'tb_medicamento_vias', 'tb_nutrientes', 'tb_racas', 'tb_regioes_anatomicas_equino',
  // D8: referência técnica (composição nutricional por espécie), igual para todas
  'tb_composicao_alimento',
];

// ─── Conexão ──────────────────────────────────────────────────────────────────
// O teste precisa de banco para ler o catálogo do PostgreSQL. Na CI ele é obrigatório —
// um gate que se pula sozinho não é gate. Na máquina do dev, sem banco alcançável, o
// teste é PULADO para não travar quem está mexendo em outra coisa.
const prisma = new PrismaClient();
let bancoOk = false;

beforeAll(async () => {
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    bancoOk = true;
  } catch (err) {
    if (process.env.CI) throw new Error(`Gate de tenancy exige banco na CI: ${err.message}`);
    console.warn('⚠️  tenancyRls: banco inacessível — teste PULADO (na CI ele falharia).');
  }
});

afterAll(async () => { await prisma.$disconnect(); });

/** Estado de RLS de cada tabela do schema, direto do catálogo. */
async function estadoDasTabelas() {
  return prisma.$queryRawUnsafe(`
    SELECT c.relname                      AS tabela,
           c.relrowsecurity               AS habilitado,
           c.relforcerowsecurity          AS forcado,
           count(p.polname)::int          AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_policy p ON p.polrelid = c.oid
     WHERE n.nspname = '${SCHEMA}' AND c.relkind = 'r'
     GROUP BY 1, 2, 3
     ORDER BY 1`);
}

describe('Gate de arquitetura multi-tenant (RLS)', () => {
  test('1. toda tabela do TENANT PLANE tem RLS habilitado, FORÇADO e com policy', async () => {
    if (!bancoOk) return;
    const estado = await estadoDasTabelas();

    // ⚠️ FORCE não é detalhe: `nutriadmin` é DONO das 90 tabelas, e no PostgreSQL o dono
    // IGNORA as policies sem `FORCE ROW LEVEL SECURITY`. Sem esta checagem, o gate
    // aprovaria uma tabela cujo isolamento é puramente decorativo (§3.1 do plano).
    const desprotegidas = estado
      .filter(t => TENANT_PLANE.includes(t.tabela))
      .filter(t => !t.habilitado || !t.forcado || t.policies === 0)
      .map(t => `${t.tabela} (enable=${t.habilitado} force=${t.forcado} policies=${t.policies})`);

    expect(desprotegidas).toEqual([]);
  });

  test('2. nenhuma tabela fica sem classificação — é a trava contra o esquecimento', async () => {
    if (!bancoOk) return;
    const estado = await estadoDasTabelas();
    const classificadas = new Set([...TENANT_PLANE, ...AGUARDANDO_RLS, ...SEM_RLS]);

    const naoClassificadas = estado.map(t => t.tabela).filter(t => !classificadas.has(t));

    if (naoClassificadas.length) {
      console.error(
        `\n🔴 Tabela(s) sem classificação de tenancy: ${naoClassificadas.join(', ')}\n` +
        '   Decida em backend/src/__tests__/tenancyRls.test.js:\n' +
        '     TENANT_PLANE    → é de empresa e a policy já existe\n' +
        '     AGUARDANDO_RLS  → é de empresa, a policy vem numa fase seguinte\n' +
        '     SEM_RLS         → control plane ou catálogo global (justifique no comentário)\n' +
        '   Ver docs/MULTI-TENANCY-PLANO.md §4.\n');
    }
    expect(naoClassificadas).toEqual([]);
  });

  test('3. as listas não se sobrepõem nem citam tabela inexistente', async () => {
    if (!bancoOk) return;
    const estado = await estadoDasTabelas();
    const existentes = new Set(estado.map(t => t.tabela));

    // Sobreposição = alguém moveu de lista e esqueceu de tirar da antiga; o gate passaria
    // achando que está protegida enquanto ela também consta como "sem RLS".
    const todas = [...TENANT_PLANE, ...AGUARDANDO_RLS, ...SEM_RLS];
    const duplicadas = todas.filter((t, i) => todas.indexOf(t) !== i);
    expect(duplicadas).toEqual([]);

    // Tabela listada que não existe = renomeada ou dropada sem atualizar o gate. Some do
    // banco e continua "classificada", escondendo que a sucessora não foi classificada.
    const fantasmas = todas.filter(t => !existentes.has(t));
    expect(fantasmas).toEqual([]);
  });

  test('4. o placar da migração — AGUARDANDO_RLS vazia = terminou', async () => {
    if (!bancoOk) return;
    const total = TENANT_PLANE.length + AGUARDANDO_RLS.length;
    const pct = total ? Math.round((TENANT_PLANE.length / total) * 100) : 100;
    console.log(
      `\n📊 Tenant plane: ${TENANT_PLANE.length}/${total} tabelas com RLS (${pct}%) · ` +
      `${AGUARDANDO_RLS.length} aguardando · ${SEM_RLS.length} fora do RLS por decisão\n`);
    // Sem asserção de propósito: este teste informa, não reprova. Quem reprova são os 1–3.
    expect(true).toBe(true);
  });
});
