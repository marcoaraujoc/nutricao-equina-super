-- CreateTable
CREATE TABLE `tb_evolucoes_clinicas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `animalId` INTEGER NOT NULL,
    `veterinarioId` INTEGER NOT NULL,
    `modificadoPorId` INTEGER NULL,
    `especialidade` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'EM_ANDAMENTO',
    `texto` TEXT NOT NULL,
    `dataInicio` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dataFim` DATETIME(3) NULL,
    `dataModificacao` DATETIME(3) NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `justificativaExclusao` TEXT NULL,
    `aprovado` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_prescricoes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `animalId` INTEGER NOT NULL,
    `veterinarioId` INTEGER NOT NULL,
    `medicamento` VARCHAR(191) NOT NULL,
    `dose` VARCHAR(191) NOT NULL,
    `frequencia` VARCHAR(191) NOT NULL,
    `duracao` VARCHAR(191) NOT NULL,
    `via` VARCHAR(191) NOT NULL DEFAULT 'oral',
    `observacao` TEXT NULL,
    `dataInicio` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dataFim` DATETIME(3) NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `aprovado` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_vacinas_clinicas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `animalId` INTEGER NOT NULL,
    `veterinarioId` INTEGER NOT NULL,
    `nome` VARCHAR(191) NOT NULL,
    `lote` VARCHAR(191) NULL,
    `fabricante` VARCHAR(191) NULL,
    `dataAplicacao` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dataReforco` DATETIME(3) NULL,
    `observacao` TEXT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_encaminhamentos_clinicos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `animalId` INTEGER NOT NULL,
    `veterinarioId` INTEGER NOT NULL,
    `especialidade` VARCHAR(191) NOT NULL,
    `motivo` TEXT NOT NULL,
    `veterinarioDestino` VARCHAR(191) NULL,
    `clinicaDestino` VARCHAR(191) NULL,
    `urgencia` VARCHAR(191) NOT NULL DEFAULT 'NORMAL',
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDENTE',
    `dataEncaminhamento` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `observacao` TEXT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_exames_clinicos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `animalId` INTEGER NOT NULL,
    `veterinarioId` INTEGER NOT NULL,
    `tipo` VARCHAR(191) NOT NULL,
    `descricao` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'SOLICITADO',
    `resultado` TEXT NULL,
    `dataSolicitacao` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dataResultado` DATETIME(3) NULL,
    `arquivoUrl` VARCHAR(191) NULL,
    `observacao` TEXT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_faturas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `animalId` INTEGER NOT NULL,
    `total` DOUBLE NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ABERTA',
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_fatura_itens` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `faturaId` INTEGER NOT NULL,
    `tipo` VARCHAR(191) NOT NULL,
    `descricao` VARCHAR(191) NOT NULL,
    `valor` DOUBLE NOT NULL DEFAULT 0,
    `quantidade` INTEGER NOT NULL DEFAULT 1,
    `veterinarioId` INTEGER NOT NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tb_evolucoes_clinicas` ADD CONSTRAINT `tb_evolucoes_clinicas_animalId_fkey` FOREIGN KEY (`animalId`) REFERENCES `tb_animais`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_evolucoes_clinicas` ADD CONSTRAINT `tb_evolucoes_clinicas_veterinarioId_fkey` FOREIGN KEY (`veterinarioId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_evolucoes_clinicas` ADD CONSTRAINT `tb_evolucoes_clinicas_modificadoPorId_fkey` FOREIGN KEY (`modificadoPorId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_prescricoes` ADD CONSTRAINT `tb_prescricoes_animalId_fkey` FOREIGN KEY (`animalId`) REFERENCES `tb_animais`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_prescricoes` ADD CONSTRAINT `tb_prescricoes_veterinarioId_fkey` FOREIGN KEY (`veterinarioId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_vacinas_clinicas` ADD CONSTRAINT `tb_vacinas_clinicas_animalId_fkey` FOREIGN KEY (`animalId`) REFERENCES `tb_animais`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_vacinas_clinicas` ADD CONSTRAINT `tb_vacinas_clinicas_veterinarioId_fkey` FOREIGN KEY (`veterinarioId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_encaminhamentos_clinicos` ADD CONSTRAINT `tb_encaminhamentos_clinicos_animalId_fkey` FOREIGN KEY (`animalId`) REFERENCES `tb_animais`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_encaminhamentos_clinicos` ADD CONSTRAINT `tb_encaminhamentos_clinicos_veterinarioId_fkey` FOREIGN KEY (`veterinarioId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_exames_clinicos` ADD CONSTRAINT `tb_exames_clinicos_animalId_fkey` FOREIGN KEY (`animalId`) REFERENCES `tb_animais`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_exames_clinicos` ADD CONSTRAINT `tb_exames_clinicos_veterinarioId_fkey` FOREIGN KEY (`veterinarioId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_faturas` ADD CONSTRAINT `tb_faturas_animalId_fkey` FOREIGN KEY (`animalId`) REFERENCES `tb_animais`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_fatura_itens` ADD CONSTRAINT `tb_fatura_itens_faturaId_fkey` FOREIGN KEY (`faturaId`) REFERENCES `tb_faturas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_fatura_itens` ADD CONSTRAINT `tb_fatura_itens_veterinarioId_fkey` FOREIGN KEY (`veterinarioId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
