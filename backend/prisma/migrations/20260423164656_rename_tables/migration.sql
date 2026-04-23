/*
  Warnings:

  - You are about to drop the `tb_composicao_produto` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `tb_produtos` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `produtoId` on the `tb_dieta` table. All the data in the column will be lost.
  - Added the required column `alimentoId` to the `tb_dieta` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "tb_composicao_produto_produtoId_nutrienteId_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "tb_composicao_produto";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "tb_produtos";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "tb_alimentos" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nome" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "fabricante" TEXT,
    "forma" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "tb_composicao_alimento" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "alimentoId" INTEGER NOT NULL,
    "nutrienteId" INTEGER NOT NULL,
    "valorPorKg" REAL NOT NULL,
    "base" TEXT NOT NULL DEFAULT 'Seca',
    CONSTRAINT "tb_composicao_alimento_alimentoId_fkey" FOREIGN KEY ("alimentoId") REFERENCES "tb_alimentos" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "tb_composicao_alimento_nutrienteId_fkey" FOREIGN KEY ("nutrienteId") REFERENCES "tb_nutrientes" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_tb_dieta" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "animalId" INTEGER NOT NULL,
    "alimentoId" INTEGER NOT NULL,
    "qtdGramasDia" REAL NOT NULL,
    "dataInicio" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataFim" DATETIME,
    "horario" TEXT,
    "observacao" TEXT,
    CONSTRAINT "tb_dieta_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "tb_animais" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "tb_dieta_alimentoId_fkey" FOREIGN KEY ("alimentoId") REFERENCES "tb_alimentos" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_tb_dieta" ("animalId", "dataFim", "dataInicio", "horario", "id", "observacao", "qtdGramasDia") SELECT "animalId", "dataFim", "dataInicio", "horario", "id", "observacao", "qtdGramasDia" FROM "tb_dieta";
DROP TABLE "tb_dieta";
ALTER TABLE "new_tb_dieta" RENAME TO "tb_dieta";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "tb_composicao_alimento_alimentoId_nutrienteId_key" ON "tb_composicao_alimento"("alimentoId", "nutrienteId");
