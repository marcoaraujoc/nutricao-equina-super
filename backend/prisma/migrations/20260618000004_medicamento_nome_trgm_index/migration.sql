-- Habilita extensão de trigrama para buscas substring eficientes (ILIKE '%x%')
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Índice btree em nome — acelera ORDER BY nome e buscas por prefixo
CREATE INDEX IF NOT EXISTS "tb_medicamentos_nome_idx"
  ON schs2vet."tb_medicamentos" ("nome");

-- Índice GIN trigrama em nome — torna ILIKE '%busca%' O(log n) em vez de O(n)
CREATE INDEX IF NOT EXISTS "tb_medicamentos_nome_trgm_idx"
  ON schs2vet."tb_medicamentos" USING gin ("nome" gin_trgm_ops);
