-- Migration: 20260613000000_vacinas_estoque
-- Adds vaccine catalog (tb_vacinas), lots per company (tb_lotes_vacina),
-- and extends tb_vacinas_clinicas with optional links to catalog + lot.

-- ── tb_vacinas: catálogo global de vacinas (gerenciado pelo ADMIN) ─────────────
CREATE TABLE IF NOT EXISTS schs2vet.tb_vacinas (
  id         SERIAL PRIMARY KEY,
  nome       VARCHAR(255) NOT NULL,
  fabricante VARCHAR(255),
  via        VARCHAR(100) NOT NULL DEFAULT 'Subcutânea (SC)',
  ativo      BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tb_vacinas_ativo ON schs2vet.tb_vacinas(ativo);

-- ── tb_lotes_vacina: lotes por empresa ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schs2vet.tb_lotes_vacina (
  id             SERIAL PRIMARY KEY,
  vacina_id      INTEGER NOT NULL REFERENCES schs2vet.tb_vacinas(id) ON DELETE CASCADE,
  empresa_id     INTEGER REFERENCES schs2vet.tb_empresas(id) ON DELETE SET NULL,
  lote           VARCHAR(100) NOT NULL,
  validade       TIMESTAMPTZ NOT NULL,
  qtd_total      INTEGER NOT NULL DEFAULT 0,
  qtd_disponivel INTEGER NOT NULL DEFAULT 0,
  ativo          BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tb_lotes_vacina_vacina_id  ON schs2vet.tb_lotes_vacina(vacina_id);
CREATE INDEX IF NOT EXISTS idx_tb_lotes_vacina_empresa_id ON schs2vet.tb_lotes_vacina(empresa_id);

-- ── tb_vacinas_clinicas: extensão com link ao catálogo ────────────────────────
ALTER TABLE schs2vet.tb_vacinas_clinicas
  ADD COLUMN IF NOT EXISTS vacina_id INTEGER REFERENCES schs2vet.tb_vacinas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lote_id   INTEGER REFERENCES schs2vet.tb_lotes_vacina(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dose      VARCHAR(50),
  ADD COLUMN IF NOT EXISTS via       VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_tb_vacinas_clinicas_vacina_id ON schs2vet.tb_vacinas_clinicas(vacina_id);
