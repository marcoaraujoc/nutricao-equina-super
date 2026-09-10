-- MOTIVO DA RECUSA no orçamento (pedido de 2026-09-08).
--
-- Duas colunas, porque são dois atos diferentes:
--   • `tb_orcamentos.motivo_recusa`      → o orçamento INTEIRO foi rejeitado;
--   • `tb_orcamento_itens.motivo_recusa` → só ALGUNS itens foram (aprovação parcial).
--
-- Sem backfill: `NULL` = orçamento recusado ANTES desta mudança, quando o motivo não
-- era pedido. O relatório mostra "—" nesses, que é a verdade — inventar um motivo
-- retroativo seria pior que a lacuna.
--
-- ⚠️ As duas tabelas são do TENANT PLANE (RLS). Este arquivo só tem DDL, que não
-- passa por policy; se um dia precisar de UPDATE aqui, ele exige
-- `SELECT set_config('app.plataforma', 'on', true);` antes — senão afeta ZERO linhas
-- em silêncio (armadilha 42).
ALTER TABLE "schs2vet"."tb_orcamentos"
  ADD COLUMN IF NOT EXISTS "motivo_recusa" TEXT;

ALTER TABLE "schs2vet"."tb_orcamento_itens"
  ADD COLUMN IF NOT EXISTS "motivo_recusa" TEXT;
