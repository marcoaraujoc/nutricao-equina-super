-- 🔴 REGISTRO NA FEI (2026-09-22, a pedido) — o paciente está inscrito na Fédération
-- Équestre Internationale?
--
-- POR QUE COLUNA PRÓPRIA, e não mais um texto em `registro_passaporte`: aquele campo
-- guarda o NÚMERO do registro/passaporte (nacional, de associação de raça, o que a
-- clínica tiver), e é preenchido à mão. "Está na FEI" é um SIM/NÃO que decide
-- elegibilidade para prova internacional e que a clínica precisa poder FILTRAR —
-- procurar isso dentro de um campo livre seria `LIKE '%fei%'`, que não é resposta.
--
-- ADITIVA e SEM BACKFILL: `false` é a verdade para todo paciente já cadastrado — quem
-- está na FEI é a exceção, e inventar `true` para alguém seria afirmar algo que
-- ninguém declarou. `NOT NULL DEFAULT false` não reescreve linha nenhuma no Postgres
-- moderno (default constante é metadado).
--
-- ⚠️ TENANCY: `tb_animais` já está sob RLS (tenant direto por `empresa_id`) e o
-- `ALTER TABLE` não mexe em policy nenhuma — a coluna nasce protegida pela mesma
-- regra das demais. Nada a acrescentar aqui.

ALTER TABLE "schs2vet"."tb_animais"
  ADD COLUMN IF NOT EXISTS "registrado_fei" BOOLEAN NOT NULL DEFAULT false;
