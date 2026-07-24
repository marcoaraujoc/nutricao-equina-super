-- Especialidades POR LOCAL de trabalho do membro (CSV de IDs de tb_especialidades).
-- Um profissional pode atuar em especialidades diferentes em cada local (ex.: cirurgião
-- num haras seg/ter/qua, dermatologista noutro qui/sex/sáb). As especialidades do
-- profissional (UsuarioEspecialidade) passam a ser a UNIÃO das especialidades dos locais.
ALTER TABLE "schs2vet"."tb_membro_locais_trabalho"
  ADD COLUMN IF NOT EXISTS "especialidadesIds" VARCHAR(255);
