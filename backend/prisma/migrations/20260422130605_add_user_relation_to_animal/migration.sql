/*
  Warnings:

  - You are about to drop the column `resetPasswordExpires` on the `tb_animais` table. All the data in the column will be lost.
  - You are about to drop the column `resetPasswordToken` on the `tb_animais` table. All the data in the column will be lost.

*/
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
    "userId" INTEGER,
    CONSTRAINT "tb_animais_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "tb_animais_especieId_fkey" FOREIGN KEY ("especieId") REFERENCES "tb_especies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "tb_animais_racaId_fkey" FOREIGN KEY ("racaId") REFERENCES "tb_racas" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_tb_animais" ("ativo", "dataCadastro", "dataNascimento", "especieId", "id", "nome", "peso", "photoUrl", "racaId", "sexo") SELECT "ativo", "dataCadastro", "dataNascimento", "especieId", "id", "nome", "peso", "photoUrl", "racaId", "sexo" FROM "tb_animais";
DROP TABLE "tb_animais";
ALTER TABLE "new_tb_animais" RENAME TO "tb_animais";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
