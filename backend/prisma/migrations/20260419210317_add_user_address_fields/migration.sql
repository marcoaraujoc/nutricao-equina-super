/*
  Warnings:

  - You are about to drop the column `raca` on the `tb_animais` table. All the data in the column will be lost.
  - You are about to drop the column `tipoExercicio` on the `tb_animais` table. All the data in the column will be lost.
  - Added the required column `especieId` to the `tb_animais` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "users" ADD COLUMN "bairro" TEXT;
ALTER TABLE "users" ADD COLUMN "cep" TEXT;
ALTER TABLE "users" ADD COLUMN "cidade" TEXT;
ALTER TABLE "users" ADD COLUMN "complemento" TEXT;
ALTER TABLE "users" ADD COLUMN "endereco" TEXT;
ALTER TABLE "users" ADD COLUMN "estado" TEXT;

-- CreateTable
CREATE TABLE "tb_especies" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nome" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "tb_racas" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nome" TEXT NOT NULL,
    "especieId" INTEGER NOT NULL,
    CONSTRAINT "tb_racas_especieId_fkey" FOREIGN KEY ("especieId") REFERENCES "tb_especies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tb_animal_exercise" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "animalId" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "periodicidade" TEXT NOT NULL,
    CONSTRAINT "tb_animal_exercise_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "tb_animais" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_tb_animais" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nome" TEXT NOT NULL,
    "peso" REAL NOT NULL,
    "dataNascimento" DATETIME,
    "sexo" TEXT NOT NULL,
    "photoUrl" TEXT,
    "dataCadastro" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "especieId" INTEGER NOT NULL,
    "racaId" INTEGER,
    CONSTRAINT "tb_animais_especieId_fkey" FOREIGN KEY ("especieId") REFERENCES "tb_especies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "tb_animais_racaId_fkey" FOREIGN KEY ("racaId") REFERENCES "tb_racas" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_tb_animais" ("ativo", "dataCadastro", "dataNascimento", "id", "nome", "peso", "sexo") SELECT "ativo", "dataCadastro", "dataNascimento", "id", "nome", "peso", "sexo" FROM "tb_animais";
DROP TABLE "tb_animais";
ALTER TABLE "new_tb_animais" RENAME TO "tb_animais";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "tb_especies_nome_key" ON "tb_especies"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "tb_racas_nome_especieId_key" ON "tb_racas"("nome", "especieId");
