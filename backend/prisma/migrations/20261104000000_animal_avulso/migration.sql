-- 🔴 PACIENTE AVULSO (2026-10-04, a pedido) — o paciente é de atendimento pontual,
-- fora da carteira fixa da clínica?
--
-- SIM/NÃO em coluna própria para poder ser filtrado/relatado.
-- No avulso, LOCALIZAÇÃO e E-MAIL/TELEFONE do proprietário são obrigatórios
-- (conferido em `AnimalController.criar`/`atualizar`).
--
-- ADITIVA e SEM BACKFILL: `false` é a verdade para todo paciente já cadastrado —
-- ninguém declarou avulso nenhum. `NOT NULL DEFAULT false` é só metadado no Postgres
-- moderno (não reescreve linhas).
--
-- ⚠️ TENANCY: `tb_animais` já está sob RLS (tenant direto por `empresa_id`); o
-- `ALTER TABLE` não mexe em policy — a coluna nasce protegida pela mesma regra.

ALTER TABLE "schs2vet"."tb_animais"
  ADD COLUMN IF NOT EXISTS "avulso" BOOLEAN NOT NULL DEFAULT false;
