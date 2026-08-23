-- ════════════════════════════════════════════════════════════════════════════
-- Troca a verificação do link público de fatura: em vez dos 5 primeiros
-- dígitos do CPF/CNPJ do proprietário, um CÓDIGO de 4 caracteres (letras
-- maiúsculas/minúsculas + números) sorteado por link e mandado na mesma
-- mensagem (WhatsApp/e-mail) do link — pedido do usuário em 2026-09-11.
--
-- POR QUÊ: nem todo proprietário tem CPF/CNPJ cadastrado (o link ficava
-- bloqueado para ele) e o CPF não é um segredo de verdade — quem já sabe o
-- CPF do cliente (não é raro) abriria o link sem esforço. Um código sorteado
-- por envio resolve os dois problemas: todo proprietário ganha link, e quem
-- não recebeu a mensagem não tem como adivinhar.
--
-- Só o HASH (SHA-256) do código é gravado — nunca o código em claro, mesmo
-- padrão de `MfaDesafio.codigoHash` (lib/faturaLinkPublico.js#hashCodigo,
-- comparação com `crypto.timingSafeEqual`).
--
-- 🔴 GERADA, NÃO APLICADA — confirmar com o usuário antes de
--    DATABASE_URL=$DATABASE_URL_MIGRATIONS npx prisma migrate deploy
--    (depois, `npx prisma generate`). A tabela `tb_fatura_links_publicos`
--    (migration 20260910000000) foi criada e aplicada SEM nenhuma linha ainda
--    usada em produção — por isso a coluna nasce NOT NULL direto, sem
--    backfill: não existe fatura_link_publico anterior a este código.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "schs2vet"."tb_fatura_links_publicos"
  ADD COLUMN "codigo_acesso_hash" VARCHAR(64) NOT NULL;
