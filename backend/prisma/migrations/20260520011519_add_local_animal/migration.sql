-- CreateTable
CREATE TABLE "schs2vet"."users" (
    "id" SERIAL NOT NULL,
    "fullName" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(30),
    "role" VARCHAR(50) NOT NULL DEFAULT 'USER',
    "userType" VARCHAR(50) NOT NULL DEFAULT 'PROPRIETARIO',
    "cep" VARCHAR(10),
    "endereco" VARCHAR(255),
    "complemento" VARCHAR(100),
    "bairro" VARCHAR(100),
    "cidade" VARCHAR(100),
    "estado" VARCHAR(2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "resetPasswordToken" VARCHAR(255),
    "resetPasswordExpires" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_animais" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "peso" DOUBLE PRECISION NOT NULL,
    "dataNascimento" TIMESTAMP(3),
    "sexo" TEXT NOT NULL,
    "photoUrl" TEXT,
    "dataCadastro" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "especieId" INTEGER NOT NULL,
    "racaId" INTEGER,
    "userId" INTEGER NOT NULL,
    "categoriaAnimal" VARCHAR(100),
    "tipoExercicio" VARCHAR(100),
    "veterinarioNome" VARCHAR(255),
    "veterinarioClinica" VARCHAR(255),
    "local" VARCHAR(255),
    "idadeAnos" INTEGER,

    CONSTRAINT "tb_animais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_especies" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,

    CONSTRAINT "tb_especies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_racas" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "especieId" INTEGER NOT NULL,

    CONSTRAINT "tb_racas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_planos_dieta" (
    "id" SERIAL NOT NULL,
    "animalId" INTEGER NOT NULL,
    "nome" VARCHAR(255) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "dataCriacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_planos_dieta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_dieta" (
    "id" SERIAL NOT NULL,
    "animalId" INTEGER NOT NULL,
    "alimentoId" INTEGER NOT NULL,
    "qtdGramasDia" DOUBLE PRECISION NOT NULL,
    "periodicidade" TEXT,
    "unidade" TEXT,
    "dataInicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataFim" TIMESTAMP(3),
    "horario" TEXT,
    "observacao" TEXT,
    "dataCriacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataAlteracao" TIMESTAMP(3) NOT NULL,
    "criadopor" INTEGER NOT NULL,
    "modificadopor" INTEGER NOT NULL,
    "planoDietaId" INTEGER,

    CONSTRAINT "tb_dieta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_alimentos" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "fabricante" TEXT,
    "forma" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "tb_alimentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_nutrientes" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "unidadePadrao" TEXT NOT NULL,

    CONSTRAINT "tb_nutrientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_composicao_alimento" (
    "id" SERIAL NOT NULL,
    "alimentoId" INTEGER NOT NULL,
    "nutrienteId" INTEGER NOT NULL,
    "especieId" INTEGER,
    "valorPorKg" DOUBLE PRECISION NOT NULL,
    "base" VARCHAR(50) NOT NULL DEFAULT 'Seca',

    CONSTRAINT "tb_composicao_alimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_exigencias_nrc" (
    "id" SERIAL NOT NULL,
    "nutrienteId" INTEGER NOT NULL,
    "peso" INTEGER NOT NULL,
    "categoriaAnimal" VARCHAR(100),
    "tipoExercicio" VARCHAR(100) NOT NULL,
    "valorExigido" DOUBLE PRECISION NOT NULL,
    "unidade" VARCHAR(20),
    "fonte" VARCHAR(100),
    "especieId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tb_exigencias_nrc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_exames_nutricionais" (
    "id" SERIAL NOT NULL,
    "animalId" INTEGER NOT NULL,
    "nutrienteId" INTEGER NOT NULL,
    "dataExame" TIMESTAMP(3) NOT NULL,
    "valorEncontrado" DOUBLE PRECISION NOT NULL,
    "unidade" TEXT NOT NULL,
    "valorMinRef" DOUBLE PRECISION,
    "valorMaxRef" DOUBLE PRECISION,
    "observacao" TEXT,
    "arquivoUrl" TEXT,

    CONSTRAINT "tb_exames_nutricionais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_exames_clinicos" (
    "id" SERIAL NOT NULL,
    "animalId" INTEGER NOT NULL,
    "veterinarioId" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SOLICITADO',
    "resultado" TEXT,
    "dataSolicitacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataResultado" TIMESTAMP(3),
    "arquivoUrl" TEXT,
    "observacao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "tb_exames_clinicos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_ocorrencias_saude" (
    "id" SERIAL NOT NULL,
    "animalId" INTEGER NOT NULL,
    "dataInicio" TIMESTAMP(3) NOT NULL,
    "dataFim" TIMESTAMP(3),
    "problema" TEXT NOT NULL,
    "tratamento" TEXT,
    "responsavel" TEXT,

    CONSTRAINT "tb_ocorrencias_saude_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_evolucoes_clinicas" (
    "id" SERIAL NOT NULL,
    "animalId" INTEGER NOT NULL,
    "veterinarioId" INTEGER NOT NULL,
    "modificadoPorId" INTEGER,
    "especialidade" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'EM_ANDAMENTO',
    "texto" TEXT NOT NULL,
    "dataInicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataFim" TIMESTAMP(3),
    "dataModificacao" TIMESTAMP(3),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "justificativaExclusao" TEXT,
    "aprovado" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "tb_evolucoes_clinicas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_prescricoes" (
    "id" SERIAL NOT NULL,
    "animalId" INTEGER NOT NULL,
    "veterinarioId" INTEGER NOT NULL,
    "medicamento" TEXT NOT NULL,
    "dose" TEXT NOT NULL,
    "frequencia" TEXT NOT NULL,
    "duracao" TEXT NOT NULL,
    "via" TEXT NOT NULL DEFAULT 'oral',
    "observacao" TEXT,
    "dataInicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataFim" TIMESTAMP(3),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "aprovado" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "tb_prescricoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_vacinas_clinicas" (
    "id" SERIAL NOT NULL,
    "animalId" INTEGER NOT NULL,
    "veterinarioId" INTEGER NOT NULL,
    "nome" TEXT NOT NULL,
    "lote" TEXT,
    "fabricante" TEXT,
    "dataAplicacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataReforco" TIMESTAMP(3),
    "observacao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "tb_vacinas_clinicas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_encaminhamentos_clinicos" (
    "id" SERIAL NOT NULL,
    "animalId" INTEGER NOT NULL,
    "veterinarioId" INTEGER NOT NULL,
    "especialidade" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "veterinarioDestino" TEXT,
    "clinicaDestino" TEXT,
    "urgencia" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "dataEncaminhamento" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "observacao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "tb_encaminhamentos_clinicos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_faturas" (
    "id" SERIAL NOT NULL,
    "animalId" INTEGER NOT NULL,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ABERTA',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_faturas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_fatura_itens" (
    "id" SERIAL NOT NULL,
    "faturaId" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quantidade" INTEGER NOT NULL DEFAULT 1,
    "veterinarioId" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_fatura_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_relatorios_salvos" (
    "id" SERIAL NOT NULL,
    "animalId" INTEGER NOT NULL,
    "planoDietaId" INTEGER,
    "payload" TEXT NOT NULL,
    "fonteCalculo" VARCHAR(50) NOT NULL,
    "pesoCalculado" DOUBLE PRECISION,
    "categoriaUsada" VARCHAR(100),
    "especieNome" VARCHAR(100),
    "geradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_relatorios_salvos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_audit_logs" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "userName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_ai_usage_logs" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "operacao" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "provedor" TEXT NOT NULL DEFAULT 'groq',
    "tokensEntrada" INTEGER NOT NULL,
    "tokensSaida" INTEGER NOT NULL,
    "tokensTotal" INTEGER NOT NULL,
    "custoUsd" DOUBLE PRECISION NOT NULL,
    "latenciaMs" INTEGER NOT NULL,
    "userId" INTEGER,
    "animalId" INTEGER,
    "sucesso" BOOLEAN NOT NULL DEFAULT true,
    "erroMensagem" TEXT,

    CONSTRAINT "tb_ai_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_vet_perfil" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "crmv" VARCHAR(20),
    "bio" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tb_vet_perfil_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_vet_especies" (
    "id" SERIAL NOT NULL,
    "vetPerfilId" INTEGER NOT NULL,
    "especieId" INTEGER NOT NULL,

    CONSTRAINT "tb_vet_especies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_vet_subespecialidades" (
    "id" SERIAL NOT NULL,
    "vetPerfilId" INTEGER NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_vet_subespecialidades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_vet_animal_solicitacoes" (
    "id" SERIAL NOT NULL,
    "animalId" INTEGER NOT NULL,
    "vetUserId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "mensagem" TEXT,
    "approvalToken" VARCHAR(64),
    "expiresAt" TIMESTAMP(3),
    "solicitanteId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tb_vet_animal_solicitacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_empresas" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "cnpj" TEXT,
    "telefone" TEXT,
    "endereco" TEXT,
    "ownerId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tb_empresas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_equipes" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_equipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_membros_equipe" (
    "id" SERIAL NOT NULL,
    "equipeId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "cargo" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_membros_equipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_convites_equipe" (
    "id" SERIAL NOT NULL,
    "equipeId" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "cargo" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_convites_equipe_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "schs2vet"."users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_resetPasswordToken_key" ON "schs2vet"."users"("resetPasswordToken");

-- CreateIndex
CREATE INDEX "tb_animais_especieId_idx" ON "schs2vet"."tb_animais"("especieId");

-- CreateIndex
CREATE INDEX "tb_animais_racaId_idx" ON "schs2vet"."tb_animais"("racaId");

-- CreateIndex
CREATE INDEX "tb_animais_userId_idx" ON "schs2vet"."tb_animais"("userId");

-- CreateIndex
CREATE INDEX "tb_racas_especieId_idx" ON "schs2vet"."tb_racas"("especieId");

-- CreateIndex
CREATE INDEX "tb_dieta_alimentoId_idx" ON "schs2vet"."tb_dieta"("alimentoId");

-- CreateIndex
CREATE INDEX "tb_dieta_animalId_idx" ON "schs2vet"."tb_dieta"("animalId");

-- CreateIndex
CREATE INDEX "tb_dieta_criadopor_idx" ON "schs2vet"."tb_dieta"("criadopor");

-- CreateIndex
CREATE INDEX "tb_dieta_modificadopor_idx" ON "schs2vet"."tb_dieta"("modificadopor");

-- CreateIndex
CREATE INDEX "tb_composicao_alimento_nutrienteId_idx" ON "schs2vet"."tb_composicao_alimento"("nutrienteId");

-- CreateIndex
CREATE INDEX "tb_composicao_alimento_especieId_idx" ON "schs2vet"."tb_composicao_alimento"("especieId");

-- CreateIndex
CREATE UNIQUE INDEX "tb_composicao_alimento_alimentoId_nutrienteId_key" ON "schs2vet"."tb_composicao_alimento"("alimentoId", "nutrienteId");

-- CreateIndex
CREATE INDEX "tb_exigencias_nrc_nutrienteId_idx" ON "schs2vet"."tb_exigencias_nrc"("nutrienteId");

-- CreateIndex
CREATE INDEX "tb_exigencias_nrc_especieId_idx" ON "schs2vet"."tb_exigencias_nrc"("especieId");

-- CreateIndex
CREATE UNIQUE INDEX "tb_exigencias_nrc_nutrienteId_peso_categoriaAnimal_tipoExer_key" ON "schs2vet"."tb_exigencias_nrc"("nutrienteId", "peso", "categoriaAnimal", "tipoExercicio");

-- CreateIndex
CREATE INDEX "tb_exames_nutricionais_animalId_idx" ON "schs2vet"."tb_exames_nutricionais"("animalId");

-- CreateIndex
CREATE INDEX "tb_exames_nutricionais_nutrienteId_idx" ON "schs2vet"."tb_exames_nutricionais"("nutrienteId");

-- CreateIndex
CREATE INDEX "tb_ocorrencias_saude_animalId_idx" ON "schs2vet"."tb_ocorrencias_saude"("animalId");

-- CreateIndex
CREATE INDEX "tb_relatorios_salvos_animalId_idx" ON "schs2vet"."tb_relatorios_salvos"("animalId");

-- CreateIndex
CREATE INDEX "tb_relatorios_salvos_geradoEm_idx" ON "schs2vet"."tb_relatorios_salvos"("geradoEm");

-- CreateIndex
CREATE INDEX "tb_audit_logs_userId_idx" ON "schs2vet"."tb_audit_logs"("userId");

-- CreateIndex
CREATE INDEX "tb_ai_usage_logs_createdAt_idx" ON "schs2vet"."tb_ai_usage_logs"("createdAt");

-- CreateIndex
CREATE INDEX "tb_ai_usage_logs_userId_idx" ON "schs2vet"."tb_ai_usage_logs"("userId");

-- CreateIndex
CREATE INDEX "tb_ai_usage_logs_operacao_idx" ON "schs2vet"."tb_ai_usage_logs"("operacao");

-- CreateIndex
CREATE UNIQUE INDEX "tb_vet_perfil_userId_key" ON "schs2vet"."tb_vet_perfil"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "tb_vet_perfil_crmv_key" ON "schs2vet"."tb_vet_perfil"("crmv");

-- CreateIndex
CREATE UNIQUE INDEX "tb_vet_especies_vetPerfilId_especieId_key" ON "schs2vet"."tb_vet_especies"("vetPerfilId", "especieId");

-- CreateIndex
CREATE UNIQUE INDEX "tb_vet_animal_solicitacoes_approvalToken_key" ON "schs2vet"."tb_vet_animal_solicitacoes"("approvalToken");

-- CreateIndex
CREATE INDEX "tb_vet_animal_solicitacoes_approvalToken_idx" ON "schs2vet"."tb_vet_animal_solicitacoes"("approvalToken");

-- CreateIndex
CREATE UNIQUE INDEX "tb_vet_animal_solicitacoes_animalId_vetUserId_key" ON "schs2vet"."tb_vet_animal_solicitacoes"("animalId", "vetUserId");

-- CreateIndex
CREATE UNIQUE INDEX "tb_empresas_cnpj_key" ON "schs2vet"."tb_empresas"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "tb_membros_equipe_equipeId_userId_key" ON "schs2vet"."tb_membros_equipe"("equipeId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "tb_convites_equipe_token_key" ON "schs2vet"."tb_convites_equipe"("token");

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_animais" ADD CONSTRAINT "tb_animais_especieId_fkey" FOREIGN KEY ("especieId") REFERENCES "schs2vet"."tb_especies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_animais" ADD CONSTRAINT "tb_animais_racaId_fkey" FOREIGN KEY ("racaId") REFERENCES "schs2vet"."tb_racas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_animais" ADD CONSTRAINT "tb_animais_userId_fkey" FOREIGN KEY ("userId") REFERENCES "schs2vet"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_racas" ADD CONSTRAINT "tb_racas_especieId_fkey" FOREIGN KEY ("especieId") REFERENCES "schs2vet"."tb_especies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_planos_dieta" ADD CONSTRAINT "tb_planos_dieta_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "schs2vet"."tb_animais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_dieta" ADD CONSTRAINT "tb_dieta_planoDietaId_fkey" FOREIGN KEY ("planoDietaId") REFERENCES "schs2vet"."tb_planos_dieta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_dieta" ADD CONSTRAINT "tb_dieta_alimentoId_fkey" FOREIGN KEY ("alimentoId") REFERENCES "schs2vet"."tb_alimentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_dieta" ADD CONSTRAINT "tb_dieta_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "schs2vet"."tb_animais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_dieta" ADD CONSTRAINT "tb_dieta_criadopor_fkey" FOREIGN KEY ("criadopor") REFERENCES "schs2vet"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_dieta" ADD CONSTRAINT "tb_dieta_modificadopor_fkey" FOREIGN KEY ("modificadopor") REFERENCES "schs2vet"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_composicao_alimento" ADD CONSTRAINT "tb_composicao_alimento_alimentoId_fkey" FOREIGN KEY ("alimentoId") REFERENCES "schs2vet"."tb_alimentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_composicao_alimento" ADD CONSTRAINT "tb_composicao_alimento_nutrienteId_fkey" FOREIGN KEY ("nutrienteId") REFERENCES "schs2vet"."tb_nutrientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_composicao_alimento" ADD CONSTRAINT "tb_composicao_alimento_especieId_fkey" FOREIGN KEY ("especieId") REFERENCES "schs2vet"."tb_especies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_exigencias_nrc" ADD CONSTRAINT "tb_exigencias_nrc_nutrienteId_fkey" FOREIGN KEY ("nutrienteId") REFERENCES "schs2vet"."tb_nutrientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_exigencias_nrc" ADD CONSTRAINT "tb_exigencias_nrc_especieId_fkey" FOREIGN KEY ("especieId") REFERENCES "schs2vet"."tb_especies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_exames_nutricionais" ADD CONSTRAINT "tb_exames_nutricionais_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "schs2vet"."tb_animais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_exames_nutricionais" ADD CONSTRAINT "tb_exames_nutricionais_nutrienteId_fkey" FOREIGN KEY ("nutrienteId") REFERENCES "schs2vet"."tb_nutrientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_exames_clinicos" ADD CONSTRAINT "tb_exames_clinicos_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "schs2vet"."tb_animais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_exames_clinicos" ADD CONSTRAINT "tb_exames_clinicos_veterinarioId_fkey" FOREIGN KEY ("veterinarioId") REFERENCES "schs2vet"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_ocorrencias_saude" ADD CONSTRAINT "tb_ocorrencias_saude_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "schs2vet"."tb_animais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_evolucoes_clinicas" ADD CONSTRAINT "tb_evolucoes_clinicas_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "schs2vet"."tb_animais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_evolucoes_clinicas" ADD CONSTRAINT "tb_evolucoes_clinicas_veterinarioId_fkey" FOREIGN KEY ("veterinarioId") REFERENCES "schs2vet"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_evolucoes_clinicas" ADD CONSTRAINT "tb_evolucoes_clinicas_modificadoPorId_fkey" FOREIGN KEY ("modificadoPorId") REFERENCES "schs2vet"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_prescricoes" ADD CONSTRAINT "tb_prescricoes_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "schs2vet"."tb_animais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_prescricoes" ADD CONSTRAINT "tb_prescricoes_veterinarioId_fkey" FOREIGN KEY ("veterinarioId") REFERENCES "schs2vet"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_vacinas_clinicas" ADD CONSTRAINT "tb_vacinas_clinicas_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "schs2vet"."tb_animais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_vacinas_clinicas" ADD CONSTRAINT "tb_vacinas_clinicas_veterinarioId_fkey" FOREIGN KEY ("veterinarioId") REFERENCES "schs2vet"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_encaminhamentos_clinicos" ADD CONSTRAINT "tb_encaminhamentos_clinicos_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "schs2vet"."tb_animais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_encaminhamentos_clinicos" ADD CONSTRAINT "tb_encaminhamentos_clinicos_veterinarioId_fkey" FOREIGN KEY ("veterinarioId") REFERENCES "schs2vet"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_faturas" ADD CONSTRAINT "tb_faturas_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "schs2vet"."tb_animais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_fatura_itens" ADD CONSTRAINT "tb_fatura_itens_faturaId_fkey" FOREIGN KEY ("faturaId") REFERENCES "schs2vet"."tb_faturas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_fatura_itens" ADD CONSTRAINT "tb_fatura_itens_veterinarioId_fkey" FOREIGN KEY ("veterinarioId") REFERENCES "schs2vet"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_relatorios_salvos" ADD CONSTRAINT "tb_relatorios_salvos_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "schs2vet"."tb_animais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_audit_logs" ADD CONSTRAINT "tb_audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "schs2vet"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_ai_usage_logs" ADD CONSTRAINT "tb_ai_usage_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "schs2vet"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_vet_perfil" ADD CONSTRAINT "tb_vet_perfil_userId_fkey" FOREIGN KEY ("userId") REFERENCES "schs2vet"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_vet_especies" ADD CONSTRAINT "tb_vet_especies_vetPerfilId_fkey" FOREIGN KEY ("vetPerfilId") REFERENCES "schs2vet"."tb_vet_perfil"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_vet_especies" ADD CONSTRAINT "tb_vet_especies_especieId_fkey" FOREIGN KEY ("especieId") REFERENCES "schs2vet"."tb_especies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_vet_subespecialidades" ADD CONSTRAINT "tb_vet_subespecialidades_vetPerfilId_fkey" FOREIGN KEY ("vetPerfilId") REFERENCES "schs2vet"."tb_vet_perfil"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_vet_animal_solicitacoes" ADD CONSTRAINT "tb_vet_animal_solicitacoes_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "schs2vet"."tb_animais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_vet_animal_solicitacoes" ADD CONSTRAINT "tb_vet_animal_solicitacoes_vetUserId_fkey" FOREIGN KEY ("vetUserId") REFERENCES "schs2vet"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_empresas" ADD CONSTRAINT "tb_empresas_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "schs2vet"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_equipes" ADD CONSTRAINT "tb_equipes_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "schs2vet"."tb_empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_membros_equipe" ADD CONSTRAINT "tb_membros_equipe_equipeId_fkey" FOREIGN KEY ("equipeId") REFERENCES "schs2vet"."tb_equipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_membros_equipe" ADD CONSTRAINT "tb_membros_equipe_userId_fkey" FOREIGN KEY ("userId") REFERENCES "schs2vet"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_convites_equipe" ADD CONSTRAINT "tb_convites_equipe_equipeId_fkey" FOREIGN KEY ("equipeId") REFERENCES "schs2vet"."tb_equipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
