-- 2026-09-30 — REALIZADO passa a ser o status FINAL do exame clínico.
-- O estado "Finalizado" (CONCLUIDO) saiu da tela de Exames do Atendimento; a
-- rota `finalizar` passou a gravar REALIZADO. Converte o legado.
--
-- 🔴 tb_exames_clinicos está sob FORCE RLS: sem o carimbo de plataforma o UPDATE
-- afeta ZERO linhas, com sucesso e sem aviso (armadilha 42). `true` = LOCAL à
-- transação da migration.
SELECT set_config('app.plataforma', 'on', true);

UPDATE "schs2vet"."tb_exames_clinicos"
   SET "status" = 'REALIZADO'
 WHERE "status" = 'CONCLUIDO';
