-- WhatsApp da empresa (somente dígitos, DDD+número) — envio/recebimento de mensagens
ALTER TABLE "schs2vet"."tb_empresa_configuracoes" ADD COLUMN IF NOT EXISTS "whatsapp" TEXT;
