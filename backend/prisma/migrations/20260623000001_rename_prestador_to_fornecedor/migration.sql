-- Rename cargo slug de PRESTADOR → FORNECEDOR em todas as tabelas relevantes.
-- Algumas equipes já têm FORNECEDOR (criado pelo seed/código), então precisamos
-- mesclar em vez de simplesmente renomear, para evitar violação de unique constraint.
--
-- Ordem obrigatória: tb_perfis_equipe PRIMEIRO.
-- A FK de tb_matriz_perfis (equipeId, perfilSlug) tem ON DELETE CASCADE e ON UPDATE CASCADE
-- apontando para tb_perfis_equipe (equipeId, slug), portanto:
--   DELETE de tb_perfis_equipe → cascade-deleta tb_matriz_perfis correspondentes
--   UPDATE de tb_perfis_equipe.slug → cascade-atualiza tb_matriz_perfis.perfilSlug

-- Step 1: Equipes que já têm FORNECEDOR — deletar o PRESTADOR duplicado.
-- O ON DELETE CASCADE remove automaticamente as linhas em tb_matriz_perfis para (equipeId, 'PRESTADOR').
DELETE FROM schs2vet."tb_perfis_equipe"
WHERE "slug" = 'PRESTADOR'
AND "equipeId" IN (
  SELECT "equipeId" FROM schs2vet."tb_perfis_equipe" WHERE "slug" = 'FORNECEDOR'
);

-- Step 2: Renomear PRESTADOR → FORNECEDOR nas equipes que não tinham FORNECEDOR.
-- O ON UPDATE CASCADE propaga para tb_matriz_perfis.perfilSlug automaticamente.
UPDATE schs2vet."tb_perfis_equipe"
SET "slug" = 'FORNECEDOR',
    "label" = 'Fornecedor'
WHERE "slug" = 'PRESTADOR';

-- Step 3: MembroEquipe — cargo primário
UPDATE schs2vet."tb_membros_equipe"
SET "cargo" = 'FORNECEDOR'
WHERE "cargo" = 'PRESTADOR';

-- Step 4: MembroEquipe — cargos secundários (array)
UPDATE schs2vet."tb_membros_equipe"
SET "cargos" = array_replace("cargos", 'PRESTADOR', 'FORNECEDOR')
WHERE 'PRESTADOR' = ANY("cargos");

-- Step 5: ConviteEquipe — cargo
UPDATE schs2vet."tb_convites_equipe"
SET "cargo" = 'FORNECEDOR'
WHERE "cargo" = 'PRESTADOR';
