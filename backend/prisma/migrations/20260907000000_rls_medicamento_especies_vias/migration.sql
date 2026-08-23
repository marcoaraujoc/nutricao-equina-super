-- ════════════════════════════════════════════════════════════════════════════
-- RLS em tb_medicamento_especies / tb_medicamento_vias — gap aberto pela nova
-- funcionalidade "cadastrar medicamento/vacina novo direto da tela de atendimento"
-- (MedicamentoController.garantirCatalogoManual / lib/catalogoManual.js).
--
-- As duas eram classificadas como CATÁLOGO GLOBAL PURO ("ninguém cria linha
-- própria") — verdade até esta sessão: só o ADMIN escrevia nelas, pela tela global
-- de Medicamentos. Agora QUALQUER gestor cria um medicamento/vacina PRIVADO da
-- própria empresa (tb_medicamentos.empresa_id setado) e a função vincula a
-- espécie do animal a ele (`vincularEspecie`, tb_medicamento_especies) — a
-- premissa "ninguém escreve linha própria" não vale mais.
--
-- MEDIDO ao vivo, sem NENHUM contexto de tenant (cenário fail-closed que toda
-- tabela de tenant já respeita desde a fase 7c — ver migration 20260806220000):
--   SELECT COUNT(*) FROM tb_medicamento_especies;  -- devolvia 12300 (deveria ser 0)
--   SELECT COUNT(*) FROM tb_medicamento_vias;       -- devolvia 10611 (deveria ser 0)
-- Ou seja: as DUAS tabelas eram legíveis (e escrevíveis) por qualquer conexão sem
-- tenant nenhum — exatamente o vazamento que o resto do schema já fechou.
--
-- ── POR QUE NÃO É UM "TENANT VIA PAI" COMUM ────────────────────────────────
-- `tb_medicamentos` é CATÁLOGO MISTO (empresa_id NULL = linha global do ADMIN,
-- ~4.878 linhas; empresa_id setado = item privado da clínica). O gerador padrão
-- (`scripts/gerarPoliciesRls.js`) produziria `pai.empresa_id = tenant`, sem o
-- `OR IS NULL` — isso apagaria da LEITURA as vias/espécies de TODO o catálogo
-- global (a maioria absoluta dos dados) para qualquer empresa, quebrando a busca
-- de medicamento/vacina em Prescrição, Vacina e Orçamento. Por isso a policy foi
-- escrita à mão, espelhando a MESMA assimetria que `tb_medicamentos` já usa:
--   USING      → lê o global (empresa_id IS NULL) OU o próprio (empresa_id = tenant)
--   WITH CHECK → só ESCREVE o que é da própria empresa (nunca altera o catálogo do ADMIN)
--
-- Validado após aplicar: a busca de medicamento/vacina (que hoje devolve as ~4.878
-- linhas globais) precisa continuar devolvendo o mesmo volume — se cair para só as
-- linhas da empresa, a policy saiu errada.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "schs2vet"."tb_medicamento_especies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_medicamento_especies" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_medicamento_especies" ON "schs2vet"."tb_medicamento_especies";
CREATE POLICY "tenant_tb_medicamento_especies" ON "schs2vet"."tb_medicamento_especies"
  USING (
    "schs2vet"."app_plataforma"() OR (
      EXISTS (SELECT 1 FROM "schs2vet"."tb_medicamentos" p0
              WHERE p0."id" = "medicamentoId"
                AND (p0."empresa_id" = "schs2vet"."app_empresa_id"() OR p0."empresa_id" IS NULL))
    )
  )
  WITH CHECK (
    "schs2vet"."app_plataforma"() OR (
      EXISTS (SELECT 1 FROM "schs2vet"."tb_medicamentos" p0
              WHERE p0."id" = "medicamentoId"
                AND p0."empresa_id" = "schs2vet"."app_empresa_id"())
    )
  );

ALTER TABLE "schs2vet"."tb_medicamento_vias" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_medicamento_vias" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_medicamento_vias" ON "schs2vet"."tb_medicamento_vias";
CREATE POLICY "tenant_tb_medicamento_vias" ON "schs2vet"."tb_medicamento_vias"
  USING (
    "schs2vet"."app_plataforma"() OR (
      EXISTS (SELECT 1 FROM "schs2vet"."tb_medicamentos" p0
              WHERE p0."id" = "medicamentoId"
                AND (p0."empresa_id" = "schs2vet"."app_empresa_id"() OR p0."empresa_id" IS NULL))
    )
  )
  WITH CHECK (
    "schs2vet"."app_plataforma"() OR (
      EXISTS (SELECT 1 FROM "schs2vet"."tb_medicamentos" p0
              WHERE p0."id" = "medicamentoId"
                AND p0."empresa_id" = "schs2vet"."app_empresa_id"())
    )
  );
