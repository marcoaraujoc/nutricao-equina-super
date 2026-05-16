/*
  Warnings:

  - You are about to drop the column `exercise` on the `tb_animais` table. All the data in the column will be lost.
  - You are about to drop the column `periodicidade` on the `tb_animais` table. All the data in the column will be lost.
  - You are about to alter the column `updatedAt` on the `tb_exigencias_nrc` table. The data in that column could be lost. The data in that column will be cast from `DateTime(3)` to `DateTime(0)`.

*/
-- AlterTable
ALTER TABLE `tb_animais` DROP COLUMN `exercise`,
    DROP COLUMN `periodicidade`,
    ADD COLUMN `categoriaAnimal` VARCHAR(100) NULL,
    ADD COLUMN `idadeAnos` INTEGER NULL,
    ADD COLUMN `tipoExercicio` VARCHAR(100) NULL,
    ADD COLUMN `veterinarioClinica` VARCHAR(255) NULL,
    ADD COLUMN `veterinarioNome` VARCHAR(255) NULL;

-- AlterTable
ALTER TABLE `tb_exigencias_nrc` ADD COLUMN `especieId` INTEGER NULL,
    MODIFY `updatedAt` DATETIME(0) NOT NULL;

-- CreateTable
CREATE TABLE `tb_relatorios_salvos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `animalId` INTEGER NOT NULL,
    `planoDietaId` INTEGER NULL,
    `payload` LONGTEXT NOT NULL,
    `fonteCalculo` VARCHAR(50) NOT NULL,
    `pesoCalculado` DOUBLE NULL,
    `categoriaUsada` VARCHAR(100) NULL,
    `especieNome` VARCHAR(100) NULL,
    `geradoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tb_relatorios_salvos_animalId_idx`(`animalId`),
    INDEX `tb_relatorios_salvos_geradoEm_idx`(`geradoEm`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `tb_exigencias_nrc_especieId_fkey` ON `tb_exigencias_nrc`(`especieId`);

-- AddForeignKey
ALTER TABLE `tb_exigencias_nrc` ADD CONSTRAINT `tb_exigencias_nrc_especieId_fkey` FOREIGN KEY (`especieId`) REFERENCES `tb_especies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_relatorios_salvos` ADD CONSTRAINT `tb_relatorios_salvos_animalId_fkey` FOREIGN KEY (`animalId`) REFERENCES `tb_animais`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
