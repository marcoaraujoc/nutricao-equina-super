-- Resumo de atendimentos do animal gerado por IA (tela AnimalDetail).
-- Persistido por (animal, empresa do contexto) — só é regenerado/apendado quando
-- surgem eventos novos (clínicos ou itens manuais de fatura).
CREATE TABLE IF NOT EXISTS "schs2vet"."tb_resumo_atendimento_ia" (
  "id"               SERIAL PRIMARY KEY,
  "animal_id"        INTEGER NOT NULL,
  "empresa_id"       INTEGER,
  "resumo"           TEXT NOT NULL DEFAULT '',
  "ultimo_evento_em" TIMESTAMP(3),
  "total_eventos"    INTEGER NOT NULL DEFAULT 0,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "tb_resumo_atendimento_ia_animal_id_empresa_id_key"
  ON "schs2vet"."tb_resumo_atendimento_ia" ("animal_id", "empresa_id");
CREATE INDEX IF NOT EXISTS "tb_resumo_atendimento_ia_animal_id_idx"
  ON "schs2vet"."tb_resumo_atendimento_ia" ("animal_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'tb_resumo_atendimento_ia_animal_id_fkey') THEN
    ALTER TABLE "schs2vet"."tb_resumo_atendimento_ia"
      ADD CONSTRAINT "tb_resumo_atendimento_ia_animal_id_fkey"
      FOREIGN KEY ("animal_id") REFERENCES "schs2vet"."tb_animais"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'tb_resumo_atendimento_ia_empresa_id_fkey') THEN
    ALTER TABLE "schs2vet"."tb_resumo_atendimento_ia"
      ADD CONSTRAINT "tb_resumo_atendimento_ia_empresa_id_fkey"
      FOREIGN KEY ("empresa_id") REFERENCES "schs2vet"."tb_empresas"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
