/*
  Warnings:

  - Added the required column `criadopor` to the `tb_dieta` table without a default value. This is not possible if the table is not empty.
  - Added the required column `dataAlteracao` to the `tb_dieta` table without a default value. This is not possible if the table is not empty.
  - Added the required column `modificadopor` to the `tb_dieta` table without a default value. This is not possible if the table is not empty.
  - Added the required column `periodicidade` to the `tb_dieta` table without a default value. This is not possible if the table is not empty.
  - Added the required column `quantidadePorVez` to the `tb_dieta` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_tb_dieta" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "animalId" INTEGER NOT NULL,
    "alimentoId" INTEGER NOT NULL,
    "qtdGramasDia" REAL NOT NULL,
    "periodicidade" TEXT NOT NULL,
    "quantidadePorVez" TEXT NOT NULL,
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
INSERT INTO "new_tb_dieta" ("alimentoId", "animalId", "dataFim", "dataInicio", "horario", "id", "observacao", "qtdGramasDia") SELECT "alimentoId", "animalId", "dataFim", "dataInicio", "horario", "id", "observacao", "qtdGramasDia" FROM "tb_dieta";
DROP TABLE "tb_dieta";
ALTER TABLE "new_tb_dieta" RENAME TO "tb_dieta";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
