-- Local(is) de trabalho do membro da equipe. Um membro pode ter vários locais na
-- mesma empresa, cada um com dias/horário próprios. Os campos de expediente único
-- em tb_membros_equipe continuam existindo como agregado (a Agenda ainda os lê).

CREATE TABLE "schs2vet"."tb_membro_locais_trabalho" (
    "id"                   SERIAL       NOT NULL,
    "membro_equipe_id"     INTEGER      NOT NULL,
    "localizacao_id"       INTEGER      NOT NULL,
    "diasTrabalho"         VARCHAR(20),
    "horaInicioTrabalho"   VARCHAR(5),
    "horaFimTrabalho"      VARCHAR(5),
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_membro_locais_trabalho_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tb_membro_locais_trabalho_membro_equipe_id_idx"
    ON "schs2vet"."tb_membro_locais_trabalho" ("membro_equipe_id");

CREATE INDEX "tb_membro_locais_trabalho_localizacao_id_idx"
    ON "schs2vet"."tb_membro_locais_trabalho" ("localizacao_id");

ALTER TABLE "schs2vet"."tb_membro_locais_trabalho"
    ADD CONSTRAINT "tb_membro_locais_trabalho_membro_equipe_id_fkey"
    FOREIGN KEY ("membro_equipe_id") REFERENCES "schs2vet"."tb_membros_equipe" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "schs2vet"."tb_membro_locais_trabalho"
    ADD CONSTRAINT "tb_membro_locais_trabalho_localizacao_id_fkey"
    FOREIGN KEY ("localizacao_id") REFERENCES "schs2vet"."tb_localizacoes_animal" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
