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
    CONSTRAINT "tb_dieta_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "tb_animais" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "tb_dieta_alimentoId_fkey" FOREIGN KEY ("alimentoId") REFERENCES "tb_alimentos" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "tb_dieta_criadopor_fkey" FOREIGN KEY ("criadopor") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "tb_dieta_modificadopor_fkey" FOREIGN KEY ("modificadopor") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_tb_dieta" ("alimentoId", "animalId", "criadopor", "dataAlteracao", "dataCriacao", "dataFim", "dataInicio", "horario", "id", "modificadopor", "observacao", "periodicidade", "qtdGramasDia", "unidade") SELECT "alimentoId", "animalId", "criadopor", "dataAlteracao", "dataCriacao", "dataFim", "dataInicio", "horario", "id", "modificadopor", "observacao", "periodicidade", "qtdGramasDia", "unidade" FROM "tb_dieta";
DROP TABLE "tb_dieta";
ALTER TABLE "new_tb_dieta" RENAME TO "tb_dieta";
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
    "arquivoUrl" TEXT,
    CONSTRAINT "tb_exames_nutricionais_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "tb_animais" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "tb_exames_nutricionais_nutrienteId_fkey" FOREIGN KEY ("nutrienteId") REFERENCES "tb_nutrientes" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_tb_exames_nutricionais" ("animalId", "arquivoUrl", "dataExame", "id", "nutrienteId", "observacao", "unidade", "valorEncontrado", "valorMaxRef", "valorMinRef") SELECT "animalId", "arquivoUrl", "dataExame", "id", "nutrienteId", "observacao", "unidade", "valorEncontrado", "valorMaxRef", "valorMinRef" FROM "tb_exames_nutricionais";
DROP TABLE "tb_exames_nutricionais";
ALTER TABLE "new_tb_exames_nutricionais" RENAME TO "tb_exames_nutricionais";
CREATE TABLE "new_tb_ocorrencias_saude" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "animalId" INTEGER NOT NULL,
    "dataInicio" DATETIME NOT NULL,
    "dataFim" DATETIME,
    "problema" TEXT NOT NULL,
    "tratamento" TEXT,
    "responsavel" TEXT,
    CONSTRAINT "tb_ocorrencias_saude_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "tb_animais" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_tb_ocorrencias_saude" ("animalId", "dataFim", "dataInicio", "id", "problema", "responsavel", "tratamento") SELECT "animalId", "dataFim", "dataInicio", "id", "problema", "responsavel", "tratamento" FROM "tb_ocorrencias_saude";
DROP TABLE "tb_ocorrencias_saude";
ALTER TABLE "new_tb_ocorrencias_saude" RENAME TO "tb_ocorrencias_saude";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
