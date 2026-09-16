-- 🔴 MULTIDOSE PASSOU A MORAR NO ITEM DO CATÁLOGO (2026-09-15)
--
-- POR QUÊ: `multidose`/`doses_por_embalagem` nasceram em `tb_produtos_fornecedor`
-- (2026-09-12), que é o vínculo (empresa, item, FORNECEDOR). A tela de Produtos
-- deixou de pedir fornecedor — o que a clínica cadastra ali é o ITEM —, então o dado
-- ficaria sem onde ser gravado.
--
-- ⚠️ POR QUE AGORA É SEGURO PÔR ISTO EM `tb_medicamentos`, que é CATÁLOGO MISTO:
-- toda edição da tela de Produtos passa por COPY-ON-WRITE (`lib/catalogoEmpresa.js`)
-- — item GLOBAL vira cópia da empresa e é a CÓPIA que recebe a marcação. A linha
-- global nunca é escrita, e o RLS (`WITH CHECK empresa_id = app_empresa_id()`)
-- recusaria a escrita mesmo que o código tentasse.
--
-- ADITIVA e SEM BACKFILL: `false`/`NULL` = o comportamento de hoje. O que já está
-- marcado em `tb_produtos_fornecedor` continua valendo e VENCE — ver
-- `dosesPorEmbalagemDeMedicamentos`.
ALTER TABLE "schs2vet"."tb_medicamentos"
  ADD COLUMN IF NOT EXISTS "multidose" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "doses_por_embalagem" INTEGER;
