-- Foto da pessoa, POR EMPRESA (tb_usuario_empresa).
--
-- Mora aqui, e não em `users`, pela MESMA razão do nome/telefone/endereço/CRMV: o
-- cadastro que a clínica mantém sobre a pessoa é dela. Quem atende em duas clínicas
-- tem um cadastro em cada uma, e a foto acompanha o cadastro — trocar a foto na
-- clínica A não reescreve o cadastro que a B mantém.
--
-- NULL = sem foto (a tela mostra as iniciais). Guarda a URL devolvida pelo
-- StorageProvider (hoje /uploads/profissionais/<nome-aleatório>), nunca o binário.

ALTER TABLE "schs2vet"."tb_usuario_empresa"
  ADD COLUMN IF NOT EXISTS "foto_url" TEXT;
