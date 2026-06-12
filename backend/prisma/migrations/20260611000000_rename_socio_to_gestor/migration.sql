-- Renomeia o cargo/perfil SOCIO para GESTOR em todos os registros existentes.
-- Ordem importa: tb_perfis_equipe primeiro — a FK de tb_matriz_perfis (equipeId, perfilSlug)
-- tem ON UPDATE CASCADE, então o slug propaga automaticamente para a matriz.

UPDATE "schs2vet"."tb_perfis_equipe"
SET "slug" = 'GESTOR',
    "label" = 'Gestor'
WHERE "slug" = 'SOCIO';

-- Garantia para registros órfãos eventualmente sem FK (no-op se o CASCADE já propagou)
UPDATE "schs2vet"."tb_matriz_perfis"
SET "perfilSlug" = 'GESTOR'
WHERE "perfilSlug" = 'SOCIO';

UPDATE "schs2vet"."tb_membros_equipe"
SET "cargo" = 'GESTOR'
WHERE "cargo" = 'SOCIO';

UPDATE "schs2vet"."tb_convites_equipe"
SET "cargo" = 'GESTOR'
WHERE "cargo" = 'SOCIO';
