/*
  Warnings:

  - A unique constraint covering the columns `[resetPasswordToken]` on the table `tb_animais` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "tb_animais" ADD COLUMN "resetPasswordExpires" DATETIME;
ALTER TABLE "tb_animais" ADD COLUMN "resetPasswordToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "tb_animais_resetPasswordToken_key" ON "tb_animais"("resetPasswordToken");
