-- CreateEnum: VistaResenha
CREATE TYPE "schs2vet"."VistaResenha" AS ENUM (
  'LATERAL',
  'CABECA_FRONTAL',
  'FOCINHO',
  'PESCOCO_INFERIOR',
  'MEMBROS_ANTERIORES',
  'MEMBROS_POSTERIORES'
);

-- CreateEnum: TipoMarcacaoResenha
CREATE TYPE "schs2vet"."TipoMarcacaoResenha" AS ENUM (
  'PELO_BRANCO',
  'CICATRIZ',
  'MANCHA',
  'REDEMOINHO'
);

-- CreateTable: tb_regioes_anatomicas_equino
CREATE TABLE "schs2vet"."tb_regioes_anatomicas_equino" (
    "id"         SERIAL        NOT NULL,
    "codigo"     VARCHAR(60)   NOT NULL,
    "label_pt"   VARCHAR(120)  NOT NULL,
    "label_en"   VARCHAR(120),
    "label_es"   VARCHAR(120),
    "vista"      "schs2vet"."VistaResenha" NOT NULL,
    "poligono"   JSONB         NOT NULL,
    "ativo"      BOOLEAN       NOT NULL DEFAULT true,
    "ordem"      INTEGER       NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_regioes_anatomicas_equino_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tb_regioes_anatomicas_equino_codigo_key"
    ON "schs2vet"."tb_regioes_anatomicas_equino"("codigo");

-- CreateTable: tb_resenha_grafica
CREATE TABLE "schs2vet"."tb_resenha_grafica" (
    "id"           SERIAL        NOT NULL,
    "animal_id"    INTEGER       NOT NULL,
    "vista"        "schs2vet"."VistaResenha" NOT NULL,
    "vetor_tracos" JSONB         NOT NULL,
    "snapshot_png" TEXT,
    "versao"       INTEGER       NOT NULL DEFAULT 1,
    "criado_por_id" INTEGER      NOT NULL,
    "created_at"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_resenha_grafica_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tb_resenha_grafica_animal_id_vista_key"
    ON "schs2vet"."tb_resenha_grafica"("animal_id", "vista");

CREATE INDEX "tb_resenha_grafica_animal_id_idx"
    ON "schs2vet"."tb_resenha_grafica"("animal_id");

-- CreateTable: tb_resenha_traco_regiao
CREATE TABLE "schs2vet"."tb_resenha_traco_regiao" (
    "id"                  SERIAL         NOT NULL,
    "resenha_grafica_id"  INTEGER        NOT NULL,
    "traco_index"         INTEGER        NOT NULL,
    "regiao_id"           INTEGER        NOT NULL,
    "tipo_marcacao"       "schs2vet"."TipoMarcacaoResenha" NOT NULL,
    "percentual_overlap"  DECIMAL(5, 2),
    "created_at"          TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_resenha_traco_regiao_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tb_resenha_traco_regiao_resenha_grafica_id_idx"
    ON "schs2vet"."tb_resenha_traco_regiao"("resenha_grafica_id");

CREATE INDEX "tb_resenha_traco_regiao_regiao_id_idx"
    ON "schs2vet"."tb_resenha_traco_regiao"("regiao_id");

-- AddForeignKey: tb_resenha_grafica -> tb_animais
ALTER TABLE "schs2vet"."tb_resenha_grafica"
    ADD CONSTRAINT "tb_resenha_grafica_animal_id_fkey"
    FOREIGN KEY ("animal_id") REFERENCES "schs2vet"."tb_animais"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: tb_resenha_grafica -> users
ALTER TABLE "schs2vet"."tb_resenha_grafica"
    ADD CONSTRAINT "tb_resenha_grafica_criado_por_id_fkey"
    FOREIGN KEY ("criado_por_id") REFERENCES "schs2vet"."users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: tb_resenha_traco_regiao -> tb_resenha_grafica
ALTER TABLE "schs2vet"."tb_resenha_traco_regiao"
    ADD CONSTRAINT "tb_resenha_traco_regiao_resenha_grafica_id_fkey"
    FOREIGN KEY ("resenha_grafica_id") REFERENCES "schs2vet"."tb_resenha_grafica"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: tb_resenha_traco_regiao -> tb_regioes_anatomicas_equino
ALTER TABLE "schs2vet"."tb_resenha_traco_regiao"
    ADD CONSTRAINT "tb_resenha_traco_regiao_regiao_id_fkey"
    FOREIGN KEY ("regiao_id") REFERENCES "schs2vet"."tb_regioes_anatomicas_equino"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
