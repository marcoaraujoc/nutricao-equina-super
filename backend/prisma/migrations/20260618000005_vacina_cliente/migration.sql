-- Migration: adiciona campo cliente em tb_vacinas_clinicas
-- cliente = true → vacina fornecida pelo cliente, não debita estoque nem lança na fatura

ALTER TABLE schs2vet.tb_vacinas_clinicas
  ADD COLUMN IF NOT EXISTS cliente BOOLEAN NOT NULL DEFAULT false;
