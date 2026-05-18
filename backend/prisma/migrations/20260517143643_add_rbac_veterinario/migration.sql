-- CreateTable
CREATE TABLE `tb_vet_perfil` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `crmv` VARCHAR(191) NULL,
    `bio` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tb_vet_perfil_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_vet_especies` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `vetPerfilId` INTEGER NOT NULL,
    `especieId` INTEGER NOT NULL,

    UNIQUE INDEX `tb_vet_especies_vetPerfilId_especieId_key`(`vetPerfilId`, `especieId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_vet_animal_solicitacoes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `animalId` INTEGER NOT NULL,
    `vetUserId` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDENTE',
    `mensagem` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tb_vet_animal_solicitacoes_animalId_vetUserId_key`(`animalId`, `vetUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_empresas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` VARCHAR(191) NOT NULL,
    `cnpj` VARCHAR(191) NULL,
    `telefone` VARCHAR(191) NULL,
    `endereco` VARCHAR(191) NULL,
    `ownerId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tb_empresas_cnpj_key`(`cnpj`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_equipes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` VARCHAR(191) NOT NULL,
    `empresaId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_membros_equipe` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `equipeId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `cargo` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `tb_membros_equipe_equipeId_userId_key`(`equipeId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_convites_equipe` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `equipeId` INTEGER NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `cargo` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDENTE',
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `tb_convites_equipe_token_key`(`token`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tb_vet_perfil` ADD CONSTRAINT `tb_vet_perfil_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_vet_especies` ADD CONSTRAINT `tb_vet_especies_vetPerfilId_fkey` FOREIGN KEY (`vetPerfilId`) REFERENCES `tb_vet_perfil`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_vet_especies` ADD CONSTRAINT `tb_vet_especies_especieId_fkey` FOREIGN KEY (`especieId`) REFERENCES `tb_especies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_vet_animal_solicitacoes` ADD CONSTRAINT `tb_vet_animal_solicitacoes_animalId_fkey` FOREIGN KEY (`animalId`) REFERENCES `tb_animais`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_vet_animal_solicitacoes` ADD CONSTRAINT `tb_vet_animal_solicitacoes_vetUserId_fkey` FOREIGN KEY (`vetUserId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_empresas` ADD CONSTRAINT `tb_empresas_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_equipes` ADD CONSTRAINT `tb_equipes_empresaId_fkey` FOREIGN KEY (`empresaId`) REFERENCES `tb_empresas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_membros_equipe` ADD CONSTRAINT `tb_membros_equipe_equipeId_fkey` FOREIGN KEY (`equipeId`) REFERENCES `tb_equipes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_membros_equipe` ADD CONSTRAINT `tb_membros_equipe_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_convites_equipe` ADD CONSTRAINT `tb_convites_equipe_equipeId_fkey` FOREIGN KEY (`equipeId`) REFERENCES `tb_equipes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
