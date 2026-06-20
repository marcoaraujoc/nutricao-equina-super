CREATE TABLE IF NOT EXISTS schs2vet."tb_medicamento_especies" (
    "id"            SERIAL PRIMARY KEY,
    "medicamentoId" INTEGER NOT NULL,
    "especieId"     INTEGER NOT NULL,
    CONSTRAINT "tb_medicamento_especies_medicamentoId_fkey"
        FOREIGN KEY ("medicamentoId") REFERENCES schs2vet."tb_medicamentos"(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "tb_medicamento_especies_especieId_fkey"
        FOREIGN KEY ("especieId")     REFERENCES schs2vet."tb_especies"(id)    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "tb_medicamento_especies_medicamentoId_especieId_key"
    ON schs2vet."tb_medicamento_especies"("medicamentoId", "especieId");

CREATE INDEX IF NOT EXISTS "tb_medicamento_especies_medicamentoId_idx"
    ON schs2vet."tb_medicamento_especies"("medicamentoId");

CREATE INDEX IF NOT EXISTS "tb_medicamento_especies_especieId_idx"
    ON schs2vet."tb_medicamento_especies"("especieId");
