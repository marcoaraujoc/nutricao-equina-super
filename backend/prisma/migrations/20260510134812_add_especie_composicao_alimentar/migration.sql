-- AlterTable
ALTER TABLE `tb_composicao_alimento` ADD COLUMN `especieId` INTEGER NULL;

-- AlterTable
ALTER TABLE `tb_dieta` ADD COLUMN `planoDietaId` INTEGER NULL;

-- CreateTable
CREATE TABLE `tb_planos_dieta` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `animalId` INTEGER NOT NULL,
    `nome` VARCHAR(255) NOT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `dataCriacao` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `tb_composicao_alimento_especieId_idx` ON `tb_composicao_alimento`(`especieId`);

-- AddForeignKey
ALTER TABLE `tb_dieta` ADD CONSTRAINT `tb_dieta_planoDietaId_fkey` FOREIGN KEY (`planoDietaId`) REFERENCES `tb_planos_dieta`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_planos_dieta` ADD CONSTRAINT `tb_planos_dieta_animalId_fkey` FOREIGN KEY (`animalId`) REFERENCES `tb_animais`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_composicao_alimento` ADD CONSTRAINT `tb_composicao_alimento_especieId_fkey` FOREIGN KEY (`especieId`) REFERENCES `tb_especies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
