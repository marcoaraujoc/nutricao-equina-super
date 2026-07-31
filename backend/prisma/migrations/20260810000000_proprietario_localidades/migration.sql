-- Localidades atendidas do PROPRIETÁRIO, cada uma com a SUA frequência de visitas.
-- Ex.: Sociedade Hípica Brasileira 2x/semana + Haras H.P. 3x/semana.
-- POR EMPRESA (mesma razão do tb_proprietario_perfis): o combinado da clínica A não é
-- o da clínica B, ainda que o cliente seja o mesmo login.
-- `users.frequencia_visitas` / `tb_proprietario_perfis.frequencia_visitas` continuam
-- existindo como AGREGADO (o MAIOR entre as localidades), para as leituras legadas.

CREATE TABLE IF NOT EXISTS "schs2vet"."tb_proprietario_localidades" (
  "id"                 SERIAL       NOT NULL,
  "user_id"            INTEGER      NOT NULL,
  "empresa_id"         INTEGER      NOT NULL,
  "localizacao_id"     INTEGER      NOT NULL,
  "frequencia_visitas" INTEGER      NOT NULL,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tb_proprietario_localidades_pkey" PRIMARY KEY ("id")
);

-- Uma frequência por localidade: aqui não existe "turno" como no local de trabalho
-- do profissional, então a mesma localidade não se repete para o mesmo cliente.
CREATE UNIQUE INDEX IF NOT EXISTS "tb_proprietario_localidades_user_empresa_local_key"
  ON "schs2vet"."tb_proprietario_localidades" ("user_id", "empresa_id", "localizacao_id");

CREATE INDEX IF NOT EXISTS "tb_proprietario_localidades_empresa_id_idx"
  ON "schs2vet"."tb_proprietario_localidades" ("empresa_id");

CREATE INDEX IF NOT EXISTS "tb_proprietario_localidades_localizacao_id_idx"
  ON "schs2vet"."tb_proprietario_localidades" ("localizacao_id");

DO $$ BEGIN
  ALTER TABLE "schs2vet"."tb_proprietario_localidades"
    ADD CONSTRAINT "tb_proprietario_localidades_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "schs2vet"."users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "schs2vet"."tb_proprietario_localidades"
    ADD CONSTRAINT "tb_proprietario_localidades_empresa_id_fkey"
    FOREIGN KEY ("empresa_id") REFERENCES "schs2vet"."tb_empresas"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "schs2vet"."tb_proprietario_localidades"
    ADD CONSTRAINT "tb_proprietario_localidades_localizacao_id_fkey"
    FOREIGN KEY ("localizacao_id") REFERENCES "schs2vet"."tb_localizacoes_animal"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- BACKFILL — o cliente que já tem frequência cadastrada e animais ativos num único
-- local ganha a linha correspondente (é a leitura óbvia do que estava registrado).
-- Cliente com animais em VÁRIOS locais fica de fora de propósito: não há como saber
-- como ele dividia as visitas, e chutar produziria um combinado que ninguém acordou.
INSERT INTO "schs2vet"."tb_proprietario_localidades"
  ("user_id", "empresa_id", "localizacao_id", "frequencia_visitas", "created_at", "updated_at")
SELECT
  p."user_id",
  p."empresa_id",
  MIN(a."localizacao_id")            AS localizacao_id,
  p."frequencia_visitas",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "schs2vet"."tb_proprietario_perfis" p
JOIN "schs2vet"."tb_animais" a
  ON a."userId" = p."user_id"
 AND a."empresaId" = p."empresa_id"
 AND a."ativo" = true
 AND a."localizacao_id" IS NOT NULL
WHERE p."frequencia_visitas" IS NOT NULL
  AND p."frequencia_visitas" BETWEEN 1 AND 7
GROUP BY p."user_id", p."empresa_id", p."frequencia_visitas"
HAVING COUNT(DISTINCT a."localizacao_id") = 1
ON CONFLICT ("user_id", "empresa_id", "localizacao_id") DO NOTHING;
