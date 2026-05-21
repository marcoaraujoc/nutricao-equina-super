-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `fullName` VARCHAR(255) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `phone` VARCHAR(30) NULL,
    `role` VARCHAR(50) NOT NULL DEFAULT 'USER',
    `userType` VARCHAR(50) NOT NULL DEFAULT 'PROPRIETARIO',
    `cep` VARCHAR(10) NULL,
    `endereco` VARCHAR(255) NULL,
    `complemento` VARCHAR(100) NULL,
    `bairro` VARCHAR(100) NULL,
    `cidade` VARCHAR(100) NULL,
    `estado` VARCHAR(2) NULL,
    `createdAt` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `resetPasswordToken` VARCHAR(255) NULL,
    `resetPasswordExpires` DATETIME(0) NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    UNIQUE INDEX `users_resetPasswordToken_key`(`resetPasswordToken`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_animais` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` TEXT NOT NULL,
    `peso` DOUBLE NOT NULL,
    `dataNascimento` DATETIME(0) NULL,
    `sexo` TEXT NOT NULL,
    `photoUrl` TEXT NULL,
    `dataCadastro` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `especieId` INTEGER NOT NULL,
    `racaId` INTEGER NULL,
    `userId` INTEGER NOT NULL,
    `exercise` TEXT NULL,
    `periodicidade` TEXT NULL,

    INDEX `tb_animais_especieId_fkey`(`especieId`),
    INDEX `tb_animais_racaId_fkey`(`racaId`),
    INDEX `tb_animais_userId_fkey`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_especies` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` TEXT NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_racas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` TEXT NOT NULL,
    `especieId` INTEGER NOT NULL,

    INDEX `tb_racas_especieId_fkey`(`especieId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_dieta` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `animalId` INTEGER NOT NULL,
    `alimentoId` INTEGER NOT NULL,
    `qtdGramasDia` DOUBLE NOT NULL,
    `periodicidade` TEXT NULL,
    `unidade` TEXT NULL,
    `dataInicio` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `dataFim` DATETIME(0) NULL,
    `horario` TEXT NULL,
    `observacao` TEXT NULL,
    `dataCriacao` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `dataAlteracao` DATETIME(0) NOT NULL,
    `criadopor` INTEGER NOT NULL,
    `modificadopor` INTEGER NOT NULL,

    INDEX `tb_dieta_alimentoId_fkey`(`alimentoId`),
    INDEX `tb_dieta_animalId_fkey`(`animalId`),
    INDEX `tb_dieta_criadopor_fkey`(`criadopor`),
    INDEX `tb_dieta_modificadopor_fkey`(`modificadopor`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_alimentos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` TEXT NOT NULL,
    `categoria` TEXT NOT NULL,
    `fabricante` TEXT NULL,
    `forma` TEXT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_nutrientes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` TEXT NOT NULL,
    `categoria` TEXT NOT NULL,
    `unidadePadrao` TEXT NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_composicao_alimento` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `alimentoId` INTEGER NOT NULL,
    `nutrienteId` INTEGER NOT NULL,
    `valorPorKg` DOUBLE NOT NULL,
    `base` VARCHAR(50) NOT NULL DEFAULT 'Seca',

    INDEX `tb_composicao_alimento_nutrienteId_fkey`(`nutrienteId`),
    UNIQUE INDEX `tb_composicao_alimento_alimentoId_nutrienteId_key`(`alimentoId`, `nutrienteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_exames_nutricionais` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `animalId` INTEGER NOT NULL,
    `nutrienteId` INTEGER NOT NULL,
    `dataExame` DATETIME(0) NOT NULL,
    `valorEncontrado` DOUBLE NOT NULL,
    `unidade` TEXT NOT NULL,
    `valorMinRef` DOUBLE NULL,
    `valorMaxRef` DOUBLE NULL,
    `observacao` TEXT NULL,
    `arquivoUrl` TEXT NULL,

    INDEX `tb_exames_nutricionais_animalId_fkey`(`animalId`),
    INDEX `tb_exames_nutricionais_nutrienteId_fkey`(`nutrienteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_ocorrencias_saude` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `animalId` INTEGER NOT NULL,
    `dataInicio` DATETIME(0) NOT NULL,
    `dataFim` DATETIME(0) NULL,
    `problema` TEXT NOT NULL,
    `tratamento` TEXT NULL,
    `responsavel` TEXT NULL,

    INDEX `tb_ocorrencias_saude_animalId_fkey`(`animalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_audit_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `userName` TEXT NOT NULL,
    `email` TEXT NOT NULL,
    `action` TEXT NOT NULL,
    `timestamp` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `tb_audit_logs_userId_fkey`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_exigencias_nrc` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nutrienteId` INTEGER NOT NULL,
    `peso` FLOAT NOT NULL,
    `tipoExercicio` VARCHAR(100) NOT NULL,
    `valorExigido` FLOAT NOT NULL,
    `createdAt` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updatedAt` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `tb_exigencias_nrc_unique`(`nutrienteId`, `peso`, `tipoExercicio`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tb_animais` ADD CONSTRAINT `tb_animais_especieId_fkey` FOREIGN KEY (`especieId`) REFERENCES `tb_especies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_animais` ADD CONSTRAINT `tb_animais_racaId_fkey` FOREIGN KEY (`racaId`) REFERENCES `tb_racas`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_animais` ADD CONSTRAINT `tb_animais_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_racas` ADD CONSTRAINT `tb_racas_especieId_fkey` FOREIGN KEY (`especieId`) REFERENCES `tb_especies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_dieta` ADD CONSTRAINT `tb_dieta_alimentoId_fkey` FOREIGN KEY (`alimentoId`) REFERENCES `tb_alimentos`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_dieta` ADD CONSTRAINT `tb_dieta_animalId_fkey` FOREIGN KEY (`animalId`) REFERENCES `tb_animais`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_dieta` ADD CONSTRAINT `tb_dieta_criadopor_fkey` FOREIGN KEY (`criadopor`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_dieta` ADD CONSTRAINT `tb_dieta_modificadopor_fkey` FOREIGN KEY (`modificadopor`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_composicao_alimento` ADD CONSTRAINT `tb_composicao_alimento_alimentoId_fkey` FOREIGN KEY (`alimentoId`) REFERENCES `tb_alimentos`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_composicao_alimento` ADD CONSTRAINT `tb_composicao_alimento_nutrienteId_fkey` FOREIGN KEY (`nutrienteId`) REFERENCES `tb_nutrientes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_exames_nutricionais` ADD CONSTRAINT `tb_exames_nutricionais_animalId_fkey` FOREIGN KEY (`animalId`) REFERENCES `tb_animais`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_exames_nutricionais` ADD CONSTRAINT `tb_exames_nutricionais_nutrienteId_fkey` FOREIGN KEY (`nutrienteId`) REFERENCES `tb_nutrientes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_ocorrencias_saude` ADD CONSTRAINT `tb_ocorrencias_saude_animalId_fkey` FOREIGN KEY (`animalId`) REFERENCES `tb_animais`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_audit_logs` ADD CONSTRAINT `tb_audit_logs_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_exigencias_nrc` ADD CONSTRAINT `tb_exigencias_nrc_nutrienteId_fkey` FOREIGN KEY (`nutrienteId`) REFERENCES `tb_nutrientes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
