-- Deslogar automaticamente os outros dispositivos ao logar de novo. O access
-- token passa a carregar a versão de sessão do usuário no momento em que foi
-- emitido; todo login (senha, 2FA, Google) incrementa a coluna, e `authenticate`
-- compara a cada requisição — divergiu, o token é de uma sessão anterior e cai
-- na hora, em vez de esperar os ~30min do access token expirar sozinho.

ALTER TABLE "schs2vet"."users"
  ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 0;
