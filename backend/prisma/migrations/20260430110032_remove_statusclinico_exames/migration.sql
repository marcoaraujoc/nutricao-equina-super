/*
  Warnings:

  - You are about to drop the column `statusClinico` on the `tb_exames_nutricionais` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_tb_exames_nutricionais" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "animalId" INTEGER NOT NULL,
    "nutrienteId" INTEGER NOT NULL,
    "dataExame" DATETIME NOT NULL,
    "valorEncontrado" REAL NOT NULL,
    "unidade" TEXT NOT NULL,
    "valorMinRef" REAL,
    "valorMaxRef" REAL,
    "observacao" TEXT,
    CONSTRAINT "tb_exames_nutricionais_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "tb_animais" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "tb_exames_nutricionais_nutrienteId_fkey" FOREIGN KEY ("nutrienteId") REFERENCES "tb_nutrientes" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_tb_exames_nutricionais" ("animalId", "dataExame", "id", "nutrienteId", "observacao", "unidade", "valorEncontrado", "valorMaxRef", "valorMinRef") SELECT "animalId", "dataExame", "id", "nutrienteId", "observacao", "unidade", "valorEncontrado", "valorMaxRef", "valorMinRef" FROM "tb_exames_nutricionais";
DROP TABLE "tb_exames_nutricionais";
ALTER TABLE "new_tb_exames_nutricionais" RENAME TO "tb_exames_nutricionais";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
