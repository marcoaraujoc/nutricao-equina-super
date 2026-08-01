-- Remuneração e acesso ao sistema do MEMBRO, por EMPRESA.
--
-- Moram em tb_usuario_empresa (e não em `users`) pela mesma razão de todo o resto do
-- cadastro: o profissional que atende em duas clínicas tem um acordo com cada uma —
-- salário aqui, comissão ali — e o acesso concedido por uma não vale pela outra.
--
-- tipo_pagamento  SALARIO | COMISSAO
-- forma_pagamento VALOR (R$) | PERCENTUAL (%)
-- valor_pagamento o número, na forma acima
--
-- NULL nos três = vínculo LEGADO (criado antes desta migration). A obrigatoriedade é
-- da aplicação, na inclusão e na edição do membro; a coluna fica nula para não inventar
-- um salário que ninguém acordou nos membros que já existem.
--
-- acesso_sistema: sem ele a pessoa não loga (fica só como cadastro da clínica —
-- tratador, prestador que não usa o sistema…). Entra NOT NULL DEFAULT true porque
-- quem já está lá dentro hoje continua entrando: default false trancaria todo mundo.
-- Base do futuro controle de usuários por plano.

ALTER TABLE "schs2vet"."tb_usuario_empresa"
  ADD COLUMN IF NOT EXISTS "tipo_pagamento"  VARCHAR(10),
  ADD COLUMN IF NOT EXISTS "forma_pagamento" VARCHAR(10),
  ADD COLUMN IF NOT EXISTS "valor_pagamento" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "acesso_sistema"  BOOLEAN NOT NULL DEFAULT true;

-- Quem consulta "esta pessoa pode logar?" no login pergunta por user_id.
CREATE INDEX IF NOT EXISTS "tb_usuario_empresa_acesso_sistema_idx"
  ON "schs2vet"."tb_usuario_empresa" ("user_id", "acesso_sistema");

-- O convite também carrega o acordo: o gestor decide remuneração e acesso AO CONVIDAR,
-- e é isso que passa a valer quando a pessoa aceita. Sem isto, quem entrasse por
-- convite (veterinário, estagiário) nasceria sem remuneração — e o campo só seria
-- "obrigatório" no caminho da inclusão direta.
ALTER TABLE "schs2vet"."tb_convites_equipe"
  ADD COLUMN IF NOT EXISTS "tipo_pagamento"  VARCHAR(10),
  ADD COLUMN IF NOT EXISTS "forma_pagamento" VARCHAR(10),
  ADD COLUMN IF NOT EXISTS "valor_pagamento" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "acesso_sistema"  BOOLEAN NOT NULL DEFAULT true;
