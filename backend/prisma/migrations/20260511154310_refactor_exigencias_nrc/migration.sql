-- 1. Derruba a FK primeiro (libera o índice)
ALTER TABLE `tb_exigencias_nrc` DROP FOREIGN KEY `tb_exigencias_nrc_nutrienteId_fkey`;

-- 2. Agora pode dropar o índice único antigo com segurança
DROP INDEX `tb_exigencias_nrc_unique` ON `tb_exigencias_nrc`;

-- 3. Altera o tipo da coluna peso de FLOAT para INT
ALTER TABLE `tb_exigencias_nrc` MODIFY COLUMN `peso` INTEGER NOT NULL;

-- 4. Adiciona as novas colunas
ALTER TABLE `tb_exigencias_nrc` 
  ADD COLUMN `categoriaAnimal` VARCHAR(100) NULL,
  ADD COLUMN `unidade` VARCHAR(20) NULL,
  ADD COLUMN `fonte` VARCHAR(100) NULL;

-- 5. Remove o default duplicado do updatedAt (se existir)
ALTER TABLE `tb_exigencias_nrc` 
  MODIFY COLUMN `updatedAt` DATETIME(3) NOT NULL;

-- 6. Recria o índice único com as novas colunas
CREATE UNIQUE INDEX `tb_exigencias_nrc_unique` 
  ON `tb_exigencias_nrc`(`nutrienteId`, `peso`, `categoriaAnimal`, `tipoExercicio`);

-- 7. Recria o índice simples para a FK
CREATE INDEX `tb_exigencias_nrc_nutrienteId_fkey` 
  ON `tb_exigencias_nrc`(`nutrienteId`);

-- 8. Recria a FK
ALTER TABLE `tb_exigencias_nrc` 
  ADD CONSTRAINT `tb_exigencias_nrc_nutrienteId_fkey` 
  FOREIGN KEY (`nutrienteId`) REFERENCES `tb_nutrientes`(`id`) 
  ON DELETE RESTRICT ON UPDATE CASCADE;