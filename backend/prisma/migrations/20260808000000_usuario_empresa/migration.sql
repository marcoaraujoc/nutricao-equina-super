-- UsuarioEmpresa — tabela de ligação usuário × empresa.
--
-- `users` passa a guardar SÓ identidade/autenticação. O PERFIL (tipo de usuário
-- naquela empresa) e o CADASTRO (nome, telefone, documento, endereço, CRMV,
-- condição comercial) passam a viver aqui, uma linha por (usuário, empresa).
--
-- Unifica tb_profissional_perfis + tb_proprietario_perfis, acrescentando a coluna
-- `perfil` — que antes só existia como MembroEquipe.cargo (por EQUIPE, não por
-- empresa) ou como o `users.user_type` GLOBAL (que era o vazamento entre clínicas).

CREATE TABLE IF NOT EXISTS "schs2vet"."tb_usuario_empresa" (
  "id"                    SERIAL       PRIMARY KEY,
  "user_id"               INTEGER      NOT NULL,
  "empresa_id"            INTEGER      NOT NULL,
  "perfil"                VARCHAR(20)  NOT NULL,
  "full_name"             VARCHAR(255),
  "phone"                 VARCHAR(30),
  "phone2"                VARCHAR(30),
  "cpf"                   VARCHAR(14),
  "cnpj"                  VARCHAR(18),
  "cep"                   VARCHAR(10),
  "endereco"              VARCHAR(255),
  "complemento"           VARCHAR(100),
  "bairro"                VARCHAR(100),
  "cidade"                VARCHAR(100),
  "estado"                VARCHAR(2),
  "crmv"                  VARCHAR(20),
  "mensalista"            BOOLEAN      NOT NULL DEFAULT false,
  "valor_assistencia"     DOUBLE PRECISION,
  "frequencia_visitas"    INTEGER,
  "dia_vencimento_fatura" INTEGER,
  "ativo"                 BOOLEAN      NOT NULL DEFAULT true,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tb_usuario_empresa_user_id_fkey"
    FOREIGN KEY ("user_id")    REFERENCES "schs2vet"."users"(id)        ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tb_usuario_empresa_empresa_id_fkey"
    FOREIGN KEY ("empresa_id") REFERENCES "schs2vet"."tb_empresas"(id)  ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "tb_usuario_empresa_user_id_empresa_id_key"
  ON "schs2vet"."tb_usuario_empresa"("user_id", "empresa_id");
CREATE INDEX IF NOT EXISTS "tb_usuario_empresa_empresa_id_idx" ON "schs2vet"."tb_usuario_empresa"("empresa_id");
CREATE INDEX IF NOT EXISTS "tb_usuario_empresa_perfil_idx"     ON "schs2vet"."tb_usuario_empresa"("perfil");

-- ── BACKFILL ────────────────────────────────────────────────────────────────
-- 1) PROFISSIONAIS: uma linha por vínculo de equipe (a empresa vem da equipe).
--    O perfil é o CARGO do membro; o cadastro vem do tb_profissional_perfis
--    daquela empresa e, na falta dele, do próprio `users` (legado).
--    DISTINCT ON: o mesmo usuário pode ter mais de uma equipe na MESMA empresa —
--    aqui vira uma linha só (o vínculo mais recente manda no perfil).
INSERT INTO "schs2vet"."tb_usuario_empresa"
  ("user_id", "empresa_id", "perfil", "full_name", "phone", "cep", "endereco",
   "complemento", "bairro", "cidade", "estado", "crmv", "ativo")
SELECT DISTINCT ON (m."userId", e."empresaId")
  m."userId",
  e."empresaId",
  m."cargo",
  COALESCE(pp."full_name",   u."fullName"),
  COALESCE(pp."phone",       u."phone"),
  COALESCE(pp."cep",         u."cep"),
  COALESCE(pp."endereco",    u."endereco"),
  COALESCE(pp."complemento", u."complemento"),
  COALESCE(pp."bairro",      u."bairro"),
  COALESCE(pp."cidade",      u."cidade"),
  COALESCE(pp."estado",      u."estado"),
  pp."crmv",
  COALESCE(pp."ativo", true)
  FROM "schs2vet"."tb_membros_equipe" m
  JOIN "schs2vet"."tb_equipes"  e  ON e.id = m."equipeId"
  JOIN "schs2vet"."users"       u  ON u.id = m."userId"
  LEFT JOIN "schs2vet"."tb_profissional_perfis" pp
         ON pp."user_id" = m."userId" AND pp."empresa_id" = e."empresaId"
 ORDER BY m."userId", e."empresaId", m."createdAt" DESC
ON CONFLICT ("user_id", "empresa_id") DO NOTHING;

-- 2) CLIENTES: uma linha por cadastro de proprietário. Quem já entrou como
--    profissional acima não é sobrescrito (ON CONFLICT DO NOTHING) — o perfil
--    profissional na empresa vence o de cliente na mesma empresa.
INSERT INTO "schs2vet"."tb_usuario_empresa"
  ("user_id", "empresa_id", "perfil", "full_name", "phone", "phone2", "cpf", "cnpj",
   "cep", "endereco", "complemento", "bairro", "cidade", "estado",
   "mensalista", "valor_assistencia", "frequencia_visitas", "dia_vencimento_fatura", "ativo")
SELECT
  pr."user_id", pr."empresa_id", 'PROPRIETARIO',
  COALESCE(pr."full_name", u."fullName"), COALESCE(pr."phone", u."phone"), pr."phone2",
  COALESCE(pr."cpf", u."cpf"), COALESCE(pr."cnpj", u."cnpj"),
  COALESCE(pr."cep", u."cep"), COALESCE(pr."endereco", u."endereco"),
  COALESCE(pr."complemento", u."complemento"), COALESCE(pr."bairro", u."bairro"),
  COALESCE(pr."cidade", u."cidade"), COALESCE(pr."estado", u."estado"),
  pr."mensalista", pr."valor_assistencia", pr."frequencia_visitas", pr."dia_vencimento_fatura",
  COALESCE(pr."ativo", true)
  FROM "schs2vet"."tb_proprietario_perfis" pr
  JOIN "schs2vet"."users" u ON u.id = pr."user_id"
ON CONFLICT ("user_id", "empresa_id") DO NOTHING;

-- 3) CLIENTES SEM PERFIL: proprietário que só tem animal na empresa (legado, antes
--    do ProprietarioPerfil existir) também precisa da linha de vínculo.
INSERT INTO "schs2vet"."tb_usuario_empresa"
  ("user_id", "empresa_id", "perfil", "full_name", "phone", "phone2", "cpf", "cnpj",
   "cep", "endereco", "complemento", "bairro", "cidade", "estado",
   "mensalista", "valor_assistencia", "frequencia_visitas", "ativo")
SELECT DISTINCT ON (a."userId", a."empresaId")
  a."userId", a."empresaId", 'PROPRIETARIO',
  u."fullName", u."phone", u."phone2", u."cpf", u."cnpj",
  u."cep", u."endereco", u."complemento", u."bairro", u."cidade", u."estado",
  COALESCE(u."mensalista", false), u."valorAssistencia", u."frequenciaVisitas", true
  FROM "schs2vet"."tb_animais" a
  JOIN "schs2vet"."users" u ON u.id = a."userId"
 WHERE a."empresaId" IS NOT NULL AND a."ativo" = true
 ORDER BY a."userId", a."empresaId"
ON CONFLICT ("user_id", "empresa_id") DO NOTHING;

-- 4) DONOS DE EMPRESA sem vínculo de equipe registrado (legado): entram como GESTOR.
INSERT INTO "schs2vet"."tb_usuario_empresa"
  ("user_id", "empresa_id", "perfil", "full_name", "phone", "cep", "endereco",
   "complemento", "bairro", "cidade", "estado", "ativo")
SELECT emp."ownerId", emp.id, 'GESTOR',
       u."fullName", u."phone", u."cep", u."endereco",
       u."complemento", u."bairro", u."cidade", u."estado", true
  FROM "schs2vet"."tb_empresas" emp
  JOIN "schs2vet"."users" u ON u.id = emp."ownerId"
 WHERE emp."ownerId" IS NOT NULL
ON CONFLICT ("user_id", "empresa_id") DO NOTHING;
