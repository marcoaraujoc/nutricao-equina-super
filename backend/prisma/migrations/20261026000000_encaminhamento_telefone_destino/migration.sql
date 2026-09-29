-- Telefone do destino do encaminhamento (2026-09-29) — no destino EXTERNO
-- (Profissional Externo, texto livre) o botão de WhatsApp usava, por engano, o
-- telefone do PROPRIETÁRIO do paciente (frontend/src/pages/SubModuloEncaminhamento.tsx
-- passava `animal?.user?.phone` para o EnviarWhatsApp independente do destino real).
-- Sem cadastro na clínica não havia de onde tirar o telefone certo, então o clique
-- em "Enviar por WhatsApp" saía sem ninguém saber para onde a mensagem foi.
--
-- Destino INTERNO (prestador do cadastro) NÃO usa esta coluna: o telefone dele é
-- lido AO VIVO do cadastro em lib/encaminhamentoPrestador.js — mesmo padrão do
-- nome, que também não é snapshot (renomear o prestador deve aparecer no histórico).
ALTER TABLE "schs2vet"."tb_encaminhamentos_clinicos"
  ADD COLUMN IF NOT EXISTS "telefone_destino" VARCHAR(20);
