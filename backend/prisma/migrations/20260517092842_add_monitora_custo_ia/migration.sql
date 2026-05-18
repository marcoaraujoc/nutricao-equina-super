-- CreateTable
CREATE TABLE `tb_ai_usage_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `operacao` VARCHAR(191) NOT NULL,
    `modelo` VARCHAR(191) NOT NULL,
    `provedor` VARCHAR(191) NOT NULL DEFAULT 'groq',
    `tokensEntrada` INTEGER NOT NULL,
    `tokensSaida` INTEGER NOT NULL,
    `tokensTotal` INTEGER NOT NULL,
    `custoUsd` DOUBLE NOT NULL,
    `latenciaMs` INTEGER NOT NULL,
    `userId` INTEGER NULL,
    `animalId` INTEGER NULL,
    `sucesso` BOOLEAN NOT NULL DEFAULT true,
    `erroMensagem` VARCHAR(191) NULL,

    INDEX `tb_ai_usage_logs_createdAt_idx`(`createdAt`),
    INDEX `tb_ai_usage_logs_userId_idx`(`userId`),
    INDEX `tb_ai_usage_logs_operacao_idx`(`operacao`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tb_ai_usage_logs` ADD CONSTRAINT `tb_ai_usage_logs_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
