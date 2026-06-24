-- CreateTable: tb_resenha_equino
CREATE TABLE "schs2vet"."tb_resenha_equino" (
    "id"                  SERIAL          NOT NULL,
    "animal_id"           INTEGER,
    "numero_cbh"          VARCHAR(100),
    "pais_nascimento"     VARCHAR(100)    DEFAULT 'Brasil',
    "registro_genealogia" VARCHAR(100),
    "pai"                 VARCHAR(255),
    "mae"                 VARCHAR(255),
    "pai_da_mae"          VARCHAR(255),
    "sinais_cabeca"       TEXT,
    "sinais_ae"           TEXT,
    "sinais_ad"           TEXT,
    "sinais_pe"           TEXT,
    "sinais_pd"           TEXT,
    "sinais_corpo"        TEXT,
    "marca_fogo"          VARCHAR(100),
    "outro_id"            VARCHAR(100),
    "grafica_data"        JSONB,
    "criado_por_id"       INTEGER,
    "created_at"          TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_resenha_equino_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (unique per animal)
CREATE UNIQUE INDEX "tb_resenha_equino_animal_id_key" ON "schs2vet"."tb_resenha_equino"("animal_id");

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_resenha_equino"
    ADD CONSTRAINT "tb_resenha_equino_animal_id_fkey"
    FOREIGN KEY ("animal_id") REFERENCES "schs2vet"."tb_animais"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_resenha_equino"
    ADD CONSTRAINT "tb_resenha_equino_criado_por_id_fkey"
    FOREIGN KEY ("criado_por_id") REFERENCES "schs2vet"."users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
