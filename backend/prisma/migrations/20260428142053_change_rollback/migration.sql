/*
  Warnings:

  - You are about to alter the column `userId` on the `tb_animais` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Int`.
  - You are about to alter the column `userId` on the `tb_audit_logs` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Int`.
  - You are about to alter the column `criadopor` on the `tb_dieta` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Int`.
  - You are about to alter the column `modificadopor` on the `tb_dieta` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Int`.
  - The primary key for the `users` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to alter the column `id` on the `users` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Int`.

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
    "userId" INTEGER NOT NULL,
    CONSTRAINT "tb_animais_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "tb_animais_especieId_fkey" FOREIGN KEY ("especieId") REFERENCES "tb_especies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "tb_animais_racaId_fkey" FOREIGN KEY ("racaId") REFERENCES "tb_racas" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_tb_animais" ("ativo", "dataCadastro", "dataNascimento", "especieId", "id", "nome", "peso", "photoUrl", "racaId", "sexo", "userId") SELECT "ativo", "dataCadastro", "dataNascimento", "especieId", "id", "nome", "peso", "photoUrl", "racaId", "sexo", "userId" FROM "tb_animais";
DROP TABLE "tb_animais";
ALTER TABLE "new_tb_animais" RENAME TO "tb_animais";
CREATE TABLE "new_tb_audit_logs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "userName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tb_audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_tb_audit_logs" ("action", "email", "id", "timestamp", "userId", "userName") SELECT "action", "email", "id", "timestamp", "userId", "userName" FROM "tb_audit_logs";
DROP TABLE "tb_audit_logs";
ALTER TABLE "new_tb_audit_logs" RENAME TO "tb_audit_logs";
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
INSERT INTO "new_tb_dieta" ("alimentoId", "animalId", "criadopor", "dataAlteracao", "dataCriacao", "dataFim", "dataInicio", "horario", "id", "modificadopor", "observacao", "periodicidade", "qtdGramasDia", "quantidadePorVez") SELECT "alimentoId", "animalId", "criadopor", "dataAlteracao", "dataCriacao", "dataFim", "dataInicio", "horario", "id", "modificadopor", "observacao", "periodicidade", "qtdGramasDia", "quantidadePorVez" FROM "tb_dieta";
DROP TABLE "tb_dieta";
ALTER TABLE "new_tb_dieta" RENAME TO "tb_dieta";
CREATE TABLE "new_users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "phone" TEXT,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "userType" TEXT NOT NULL DEFAULT 'PROPRIETARIO',
    "cep" TEXT,
    "endereco" TEXT,
    "complemento" TEXT,
    "bairro" TEXT,
    "cidade" TEXT,
    "estado" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "resetPasswordToken" TEXT,
    "resetPasswordExpires" DATETIME
);
INSERT INTO "new_users" ("ativo", "bairro", "cep", "cidade", "complemento", "createdAt", "email", "endereco", "estado", "fullName", "id", "passwordHash", "phone", "resetPasswordExpires", "resetPasswordToken", "role", "userType") SELECT "ativo", "bairro", "cep", "cidade", "complemento", "createdAt", "email", "endereco", "estado", "fullName", "id", "passwordHash", "phone", "resetPasswordExpires", "resetPasswordToken", "role", "userType" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_resetPasswordToken_key" ON "users"("resetPasswordToken");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
