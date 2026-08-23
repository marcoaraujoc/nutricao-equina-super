-- ════════════════════════════════════════════════════════════════════════════
-- Remove o "Responsável Financeiro" do cadastro do animal — feature REMOVIDA
-- (não só desativada), a pedido explícito do usuário em 2026-09-09.
--
-- 🔴 GERADA, NÃO APLICADA — confirmar com o usuário antes de
--    DATABASE_URL=$DATABASE_URL_MIGRATIONS npx prisma migrate deploy
--    (o usuário padrão do app não tem CREATE/ALTER no schema — CLAUDE.md §11).
--    Depois de aplicada, rodar `npx prisma generate`.
--
-- POR QUÊ: `Fatura` é POR PROPRIETÁRIO (uma linha agrega os itens de TODOS os
-- animais dele no mês) e `Fatura.status` é um valor ÚNICO para a fatura
-- inteira — não existe hoje pagamento parcial por animal/grupo. O "Responsável
-- Financeiro" (`Animal.resp_financeiro_*`, checkbox em Animal.tsx) só trocava o
-- CONTATO de envio (WhatsApp/e-mail) do PRIMEIRO animal com override
-- encontrado — a fatura continuava sendo UMA só, endereçada por inteiro a essa
-- pessoa, mesmo quando só um dos animais do proprietário tinha responsável
-- diferente. Resultado: a mensagem saía para o contato errado com frequência
-- (nenhuma tela dividia o PDF por grupo, e o fallback manual de WhatsApp nem
-- normalizava o telefone para o formato internacional). Reconstruir isso
-- direito exigiria pagamento rastreado por item/grupo dentro da fatura — fora
-- do escopo pedido; a decisão foi remover a feature, não consertá-la agora.
--
-- Nenhum código lê mais estas colunas (ver AnimalController.js, Animal.tsx,
-- FaturaController.js, Faturamento.tsx — a lógica de `anexarContatoEnvio` e o
-- formulário "Responsável Financeiro" foram removidos na mesma sessão).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "schs2vet"."tb_animais" DROP COLUMN IF EXISTS "resp_financeiro_proprio";
ALTER TABLE "schs2vet"."tb_animais" DROP COLUMN IF EXISTS "resp_financeiro_nome";
ALTER TABLE "schs2vet"."tb_animais" DROP COLUMN IF EXISTS "resp_financeiro_email";
ALTER TABLE "schs2vet"."tb_animais" DROP COLUMN IF EXISTS "resp_financeiro_telefone";
