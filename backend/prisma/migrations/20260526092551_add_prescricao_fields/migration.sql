-- AlterTable
ALTER TABLE "schs2vet"."tb_prescricoes" ADD COLUMN     "diasAplicacaoFim" INTEGER,
ADD COLUMN     "diasAplicacaoInicio" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "dosagem" TEXT,
ADD COLUMN     "duracaoDias" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "horaInicio" TEXT,
ADD COLUMN     "horariosGerados" JSONB,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'RASCUNHO',
ADD COLUMN     "tipo" TEXT NOT NULL DEFAULT 'MEDICAMENTO',
ADD COLUMN     "unidade" TEXT,
ALTER COLUMN "dose" SET DEFAULT '',
ALTER COLUMN "frequencia" SET DEFAULT '',
ALTER COLUMN "duracao" SET DEFAULT '',
ALTER COLUMN "via" SET DEFAULT 'Oral';
