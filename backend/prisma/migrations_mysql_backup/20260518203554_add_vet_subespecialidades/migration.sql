-- CreateTable
CREATE TABLE `tb_vet_subespecialidades` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `vetPerfilId` INTEGER NOT NULL,
    `nome` VARCHAR(100) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tb_vet_subespecialidades` ADD CONSTRAINT `tb_vet_subespecialidades_vetPerfilId_fkey` FOREIGN KEY (`vetPerfilId`) REFERENCES `tb_vet_perfil`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
