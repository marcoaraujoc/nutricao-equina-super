-- CreateTable
CREATE TABLE "tb_animais" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nome" TEXT NOT NULL,
    "raca" TEXT,
    "peso" REAL NOT NULL,
    "dataNascimento" DATETIME,
    "sexo" TEXT NOT NULL,
    "tipoExercicio" TEXT NOT NULL,
    "dataCadastro" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ativo" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "tb_dieta" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "animalId" INTEGER NOT NULL,
    "produtoId" INTEGER NOT NULL,
    "qtdGramasDia" REAL NOT NULL,
    "dataInicio" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataFim" DATETIME,
    "horario" TEXT,
    "observacao" TEXT,
    CONSTRAINT "tb_dieta_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "tb_animais" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "tb_dieta_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "tb_produtos" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tb_exames_nutricionais" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "animalId" INTEGER NOT NULL,
    "nutrienteId" INTEGER NOT NULL,
    "dataExame" DATETIME NOT NULL,
    "valorEncontrado" REAL NOT NULL,
    "unidade" TEXT NOT NULL,
    "valorMinRef" REAL,
    "valorMaxRef" REAL,
    "observacao" TEXT,
    "statusClinico" TEXT,
    CONSTRAINT "tb_exames_nutricionais_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "tb_animais" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "tb_exames_nutricionais_nutrienteId_fkey" FOREIGN KEY ("nutrienteId") REFERENCES "tb_nutrientes" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tb_produtos" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nome" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "fabricante" TEXT,
    "forma" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "tb_nutrientes" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nome" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "unidadePadrao" TEXT NOT NULL,
    "codigo" TEXT,
    "essencial" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "tb_composicao_produto" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "produtoId" INTEGER NOT NULL,
    "nutrienteId" INTEGER NOT NULL,
    "valorPorKg" REAL NOT NULL,
    "base" TEXT NOT NULL DEFAULT 'Seca',
    CONSTRAINT "tb_composicao_produto_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "tb_produtos" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "tb_composicao_produto_nutrienteId_fkey" FOREIGN KEY ("nutrienteId") REFERENCES "tb_nutrientes" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tb_ocorrencias_saude" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "animalId" INTEGER NOT NULL,
    "dataInicio" DATETIME NOT NULL,
    "dataFim" DATETIME,
    "problema" TEXT NOT NULL,
    "tratamento" TEXT,
    "responsavel" TEXT,
    CONSTRAINT "tb_ocorrencias_saude_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "tb_animais" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "tb_nutrientes_codigo_key" ON "tb_nutrientes"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "tb_composicao_produto_produtoId_nutrienteId_key" ON "tb_composicao_produto"("produtoId", "nutrienteId");
