-- 🔴 COPY-ON-WRITE PARA O CATÁLOGO DE PROCEDIMENTOS (2026-09-25).
--
-- POR QUÊ: `tb_procedimentos_vet` é catálogo MISTO (`empresa_id` NULL = linha
-- GLOBAL do ADMIN; setado = linha DA CLÍNICA). Até aqui, ATIVAR/INATIVAR um item
-- global era RECUSADO (400 `ITEM_DO_SISTEMA`) — não havia como uma clínica tirar
-- um procedimento do sistema de circulação sem afetar as demais. A saída, no
-- mesmo padrão de `Medicamento`/`DocumentoTemplate`, é a clínica ganhar uma
-- CÓPIA PRÓPRIA na primeira vez que precisa alterar o estado do item global.
--
-- `origem_id` aponta para a linha GLOBAL da qual a cópia nasceu (como o
-- `DocumentoTemplate.origemId`) — é o que permite, depois do fork, ESCONDER o
-- item global da clínica que já tem a cópia (ela foi substituída, sem duplicata),
-- mesmo que a cópia seja renomeada depois (não é o caso aqui: o NOME continua
-- travado para item de origem global — só ativo/inativo e valor mudam).
--
-- ⚠️ NÃO copia o NOME do item para o índice: o nome só muda em procedimento
-- CRIADO PELA CLÍNICA (empresa_id já seu desde a origem) — regra que este plano
-- não altera.
--
-- ADITIVA, SEM BACKFILL: `origem_id` nasce NULL em toda linha existente (global
-- ou da clínica) — nenhuma delas "veio de" outra hoje.

ALTER TABLE "schs2vet"."tb_procedimentos_vet"
  ADD COLUMN IF NOT EXISTS "origem_id" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tb_procedimentos_vet_origem_id_fkey'
  ) THEN
    ALTER TABLE "schs2vet"."tb_procedimentos_vet"
      ADD CONSTRAINT "tb_procedimentos_vet_origem_id_fkey"
      FOREIGN KEY ("origem_id") REFERENCES "schs2vet"."tb_procedimentos_vet"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "tb_procedimentos_vet_origem_id_idx"
  ON "schs2vet"."tb_procedimentos_vet" ("origem_id");

-- Uma empresa não forka o MESMO item global duas vezes. Semântica PADRÃO do
-- Postgres (NULLs distintos, sem NULLS NOT DISTINCT): não incomoda as linhas
-- GLOBAIS (empresa_id NULL) nem os procedimentos que a própria clínica cria do
-- zero (origem_id NULL) — só barra (empresa_id, origem_id) repetido, os dois
-- preenchidos.
CREATE UNIQUE INDEX IF NOT EXISTS "tb_procedimentos_vet_empresa_id_origem_id_key"
  ON "schs2vet"."tb_procedimentos_vet" ("empresa_id", "origem_id");
