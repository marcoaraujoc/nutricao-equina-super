/*
  Warnings:

  - You are about to drop the column `codigo` on the `tb_nutrientes` table. All the data in the column will be lost.
  - You are about to drop the column `essencial` on the `tb_nutrientes` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_tb_nutrientes" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nome" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "unidadePadrao" TEXT NOT NULL
);
INSERT INTO "new_tb_nutrientes" ("categoria", "id", "nome", "unidadePadrao") SELECT "categoria", "id", "nome", "unidadePadrao" FROM "tb_nutrientes";
DROP TABLE "tb_nutrientes";
ALTER TABLE "new_tb_nutrientes" RENAME TO "tb_nutrientes";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
