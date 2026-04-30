/*
  Warnings:

  - You are about to drop the column `quantidadePorVez` on the `tb_dieta` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_tb_dieta" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "animalId" INTEGER NOT NULL,
    "alimentoId" INTEGER NOT NULL,
    "qtdGramasDia" REAL NOT NULL,
    "periodicidade" TEXT,
    "unidade" TEXT,
    "dataInicio" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataFim" DATETIME,
    "horario" TEXT,
    "observacao" TEXT,
    "dataCriacao" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataAlteracao" DATETIME NOT NULL,
    "criadopor" INTEGER NOT NULL,
    "modificadopor" INTEGER NOT NULL,
    CONSTRAINT "tb_dieta_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "tb_animais" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "tb_dieta_alimentoId_fkey" FOREIGN KEY ("alimentoId") REFERENCES "tb_alimentos" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "tb_dieta_criadopor_fkey" FOREIGN KEY ("criadopor") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "tb_dieta_modificadopor_fkey" FOREIGN KEY ("modificadopor") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_tb_dieta" ("alimentoId", "animalId", "criadopor", "dataAlteracao", "dataCriacao", "dataFim", "dataInicio", "horario", "id", "modificadopor", "observacao", "periodicidade", "qtdGramasDia", "unidade") SELECT "alimentoId", "animalId", "criadopor", "dataAlteracao", "dataCriacao", "dataFim", "dataInicio", "horario", "id", "modificadopor", "observacao", "periodicidade", "qtdGramasDia", "unidade" FROM "tb_dieta";
DROP TABLE "tb_dieta";
ALTER TABLE "new_tb_dieta" RENAME TO "tb_dieta";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
