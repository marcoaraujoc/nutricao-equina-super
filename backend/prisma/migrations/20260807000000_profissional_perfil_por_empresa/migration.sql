-- Cadastro do PROFISSIONAL por EMPRESA (mesma regra já aplicada ao proprietário).
--
-- POR QUÊ: `User.email` é único global, então o mesmo profissional atendendo em duas
-- clínicas era UMA linha em `users` — editar o telefone/endereço/CRMV na empresa A
-- mudava o cadastro da empresa B, e incluir alguém que já existia trazia os dados da
-- outra empresa prontos. O `User` passa a ser só IDENTIDADE (e-mail, senha, userType,
-- ativo global) e o cadastro vive aqui, um registro por empresa. Mesmo login, cadastros
-- independentes — a empresa é escolhida no seletor de contexto que já existe.

CREATE TABLE IF NOT EXISTS schs2vet.tb_profissional_perfis (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES schs2vet.users(id)        ON DELETE CASCADE,
  empresa_id   INTEGER NOT NULL REFERENCES schs2vet.tb_empresas(id)  ON DELETE CASCADE,

  full_name    VARCHAR(255),
  phone        VARCHAR(30),
  cep          VARCHAR(10),
  endereco     VARCHAR(255),
  complemento  VARCHAR(100),
  bairro       VARCHAR(100),
  cidade       VARCHAR(100),
  estado       VARCHAR(2),
  -- CRMV por empresa: `tb_vet_perfil.crmv` é UNIQUE global e não comporta o mesmo
  -- profissional cadastrado de forma independente em mais de uma clínica.
  crmv         VARCHAR(20),
  ativo        BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "tb_profissional_perfis_user_id_empresa_id_key"
  ON schs2vet.tb_profissional_perfis(user_id, empresa_id);
CREATE INDEX IF NOT EXISTS "tb_profissional_perfis_empresa_id_idx"
  ON schs2vet.tb_profissional_perfis(empresa_id);

-- Especialidade também passa a ser POR EMPRESA: o mesmo profissional pode ser
-- ortopedista numa clínica e clínico geral na outra. NULL = vínculo legado (global).
ALTER TABLE schs2vet.tb_usuario_especialidades
  ADD COLUMN IF NOT EXISTS empresa_id INTEGER;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tb_usuario_especialidades_empresa_id_fkey'
  ) THEN
    ALTER TABLE schs2vet.tb_usuario_especialidades
      ADD CONSTRAINT tb_usuario_especialidades_empresa_id_fkey
      FOREIGN KEY (empresa_id) REFERENCES schs2vet.tb_empresas(id) ON DELETE CASCADE;
  END IF;
END $$;

-- O unique passa a incluir a empresa (NULLs distintos no PG mantêm o legado convivendo)
DROP INDEX IF EXISTS schs2vet."tb_usuario_especialidades_user_id_especialidade_id_key";
CREATE UNIQUE INDEX IF NOT EXISTS "tb_usuario_especialidades_user_esp_empresa_key"
  ON schs2vet.tb_usuario_especialidades(user_id, especialidade_id, empresa_id);
CREATE INDEX IF NOT EXISTS "tb_usuario_especialidades_empresa_id_idx"
  ON schs2vet.tb_usuario_especialidades(empresa_id);

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Um perfil por (profissional, empresa) em que ele JÁ é membro, copiando o cadastro
-- atual do User. Nada muda de comportamento hoje; a partir daqui, cada empresa edita
-- o seu, e uma empresa NOVA começa com o cadastro em branco.
INSERT INTO schs2vet.tb_profissional_perfis
  (user_id, empresa_id, full_name, phone, cep, endereco, complemento, bairro, cidade, estado, crmv, ativo)
SELECT DISTINCT ON (m."userId", e."empresaId")
       m."userId", e."empresaId",
       u."fullName", u.phone, u.cep, u.endereco, u.complemento, u.bairro, u.cidade, u.estado,
       vp.crmv, true
  FROM schs2vet.tb_membros_equipe m
  JOIN schs2vet.tb_equipes  e ON e.id = m."equipeId"
  JOIN schs2vet.users       u ON u.id = m."userId"
  LEFT JOIN schs2vet.tb_vet_perfil vp ON vp."userId" = m."userId"
 WHERE u."userType" <> 'PROPRIETARIO'
 ORDER BY m."userId", e."empresaId", m.id ASC
ON CONFLICT (user_id, empresa_id) DO NOTHING;

-- Especialidades existentes ficam com a empresa do vínculo MAIS ANTIGO do profissional
-- (a clínica que o cadastrou). Nas demais ele começa sem especialidade — que é
-- exatamente a regra de "cadastro novo em cada empresa".
UPDATE schs2vet.tb_usuario_especialidades ue
   SET empresa_id = sub."empresaId"
  FROM (
    SELECT DISTINCT ON (m."userId") m."userId", e."empresaId"
      FROM schs2vet.tb_membros_equipe m
      JOIN schs2vet.tb_equipes e ON e.id = m."equipeId"
     ORDER BY m."userId", m.id ASC
  ) sub
 WHERE ue.user_id = sub."userId"
   AND ue.empresa_id IS NULL;
