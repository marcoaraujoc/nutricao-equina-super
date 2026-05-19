/*
  Warnings:

  - A unique constraint covering the columns `[approvalToken]` on the table `tb_vet_animal_solicitacoes` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `tb_vet_animal_solicitacoes` ADD COLUMN `approvalToken` VARCHAR(64) NULL,
    ADD COLUMN `expiresAt` DATETIME(3) NULL,
    ADD COLUMN `solicitanteId` INTEGER NULL;

-- CreateIndex
CREATE UNIQUE INDEX `tb_vet_animal_solicitacoes_approvalToken_key` ON `tb_vet_animal_solicitacoes`(`approvalToken`);

-- CreateIndex
CREATE INDEX `tb_vet_animal_solicitacoes_approvalToken_idx` ON `tb_vet_animal_solicitacoes`(`approvalToken`);
