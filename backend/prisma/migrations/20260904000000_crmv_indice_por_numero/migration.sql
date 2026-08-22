-- tb_crmv_validos passou a ser alimentada por VARREDURA SEQUENCIAL DO NÚMERO de
-- inscrição (crmvScraperService.js), não mais por busca de nome. O único dado
-- guardado até aqui era hash = SHA-256(numero+uf) — irreversível, então não dá pra
-- migrar as linhas existentes para o novo formato (numero/nome em claro). A tabela
-- é um ÍNDICE/CACHE do SISCAD (nunca a fonte de verdade), então esvaziar e deixar o
-- próximo scraping repovoar é seguro — não é dado clínico nem financeiro.
TRUNCATE TABLE "schs2vet"."tb_crmv_validos";

ALTER TABLE "schs2vet"."tb_crmv_validos"
  DROP CONSTRAINT IF EXISTS "tb_crmv_validos_hash_key",
  DROP COLUMN "hash",
  ADD COLUMN "numero" INTEGER NOT NULL,
  ADD COLUMN "nome" VARCHAR(200) NOT NULL,
  ADD COLUMN "classe" VARCHAR(10),
  ADD COLUMN "dataInscricao" DATE,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "tb_crmv_validos_numero_uf_key" ON "schs2vet"."tb_crmv_validos"("numero", "uf");
