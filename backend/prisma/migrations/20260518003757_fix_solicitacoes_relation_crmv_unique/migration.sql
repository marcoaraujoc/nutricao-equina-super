/*
  Warnings:

  - You are about to alter the column `crmv` on the `tb_vet_perfil` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `VarChar(20)`.
  - A unique constraint covering the columns `[crmv]` on the table `tb_vet_perfil` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `tb_vet_animal_solicitacoes` MODIFY `mensagem` TEXT NULL;

-- AlterTable
ALTER TABLE `tb_vet_perfil` MODIFY `crmv` VARCHAR(20) NULL,
    MODIFY `bio` TEXT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `tb_vet_perfil_crmv_key` ON `tb_vet_perfil`(`crmv`);
