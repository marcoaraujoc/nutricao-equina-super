-- "Atender somente no local de trabalho" para o PRESTADOR (pedido de 2026-09-08).
--
-- Irmão de `tb_membros_equipe.restringir_por_local`, mas em tabela própria: o
-- Prestador NÃO cria MembroEquipe (ver PrestadorController#provisionarLogin), então
-- não havia onde guardar o que a tela passou a perguntar.
--
-- `DEFAULT false` = o comportamento de hoje. Ligar por padrão esconderia pacientes de
-- todo prestador já cadastrado, sem ninguém ter pedido.
--
-- `tb_prestadores` está sob RLS (tenant direto). Este arquivo só tem DDL, que não
-- passa por policy; DML aqui exigiria `set_config('app.plataforma', ...)` (armadilha 42).
ALTER TABLE "schs2vet"."tb_prestadores"
  ADD COLUMN IF NOT EXISTS "restringir_por_local" BOOLEAN NOT NULL DEFAULT false;
