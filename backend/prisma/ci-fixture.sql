-- ════════════════════════════════════════════════════════════════════════════
-- FIXTURE DA CI — o mínimo de dados para os gates de RLS PROVAREM alguma coisa.
--
-- ⚠️ POR QUE ISTO EXISTE: os testes de comportamento (rlsCanario, prismaTenant) fazem
-- uma pergunta que num banco VAZIO não tem resposta — "a empresa A vê as linhas de B?".
-- Com zero linhas, `expect(visto).toBe(n)` compara 0 com 0 e PASSA sem provar nada.
-- Por isso `rlsCanario` exige `porEmpresa.length > 1`: ele se recusa a dar um verde
-- falso. Este arquivo é o que dá ao gate as DUAS empresas de que ele precisa.
--
-- ⚠️ NÃO É SEED DE APLICAÇÃO. Não roda em desenvolvimento nem em produção — só no
-- banco efêmero do job de CI, que nasce e morre no runner. Todo nome traz "(CI)" e
-- todo e-mail usa `.invalid` (TLD reservado pela RFC 2606, que nunca resolve), para
-- que uma cópia acidental deste arquivo num banco real seja óbvia à primeira vista.
--
-- ⚠️ RODA COMO SUPERUSUÁRIO (`postgres`), ANTES de os testes conectarem como
-- `zls2vetp1`. É deliberado: superusuário ignora RLS, então o fixture consegue criar
-- linhas para DUAS empresas diferentes. Se ele rodasse como a role da aplicação, as
-- policies o impediriam de semear a segunda empresa — e o gate ficaria sem o outro
-- lado da comparação.
--
-- Cadeia mínima, na ordem das FKs:
--   especie ─┐
--   medicamento ─┐
--   empresa → equipe → user → animal      (prismaTenant conta animais por empresa)
--                   └──────→ estoque → movimentos  (rlsCanario invade movimentos)
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_esp    int;
  v_med    int;
  v_emp    int;
  v_user   int;
  v_est    int;
  v_letra  text;
BEGIN
  -- Catálogos: uma linha só, compartilhada pelas duas empresas. `tb_especies` é
  -- CATÁLOGO GLOBAL e `tb_medicamentos` é CATÁLOGO MISTO com `empresaId` nulo (= linha
  -- global) — as duas ficam de fora do RLS de tenant de propósito, e é justamente isso
  -- que as torna seguras de compartilhar aqui.
  INSERT INTO schs2vet.tb_especies (nome)
       VALUES ('Equino (CI)')
    RETURNING id INTO v_esp;

  INSERT INTO schs2vet.tb_medicamentos (nome, "formaFarmaceutica", unidade, apresentacao, "updatedAt")
       VALUES ('Medicamento (CI)', 'INJETAVEL', 'ml', 'Frasco 10 ml', now())
    RETURNING id INTO v_med;

  -- Duas empresas: é o número mínimo para a pergunta "A enxerga o que é de B?" existir.
  FOREACH v_letra IN ARRAY ARRAY['A', 'B'] LOOP

    INSERT INTO schs2vet.tb_empresas (nome, "updatedAt")
         VALUES ('Clínica CI ' || v_letra, now())
      RETURNING id INTO v_emp;

    INSERT INTO schs2vet.tb_equipes (nome, "empresaId")
         VALUES ('Equipe CI ' || v_letra, v_emp);

    -- `passwordHash` recebe lixo de propósito: nenhum login é feito com este usuário.
    -- Um hash bcrypt VÁLIDO aqui seria uma credencial funcional versionada no git.
    INSERT INTO schs2vet.users ("fullName", email, "passwordHash")
         VALUES ('Gestor CI ' || v_letra,
                 'gestor.ci.' || lower(v_letra) || '@s2vet.invalid',
                 'SEM_LOGIN')
      RETURNING id INTO v_user;

    INSERT INTO schs2vet.tb_animais (nome, peso, sexo, "especieId", "userId", "empresaId")
         VALUES ('Paciente CI ' || v_letra, 400, 'MACHO', v_esp, v_user, v_emp);

    INSERT INTO schs2vet.tb_estoque_clinica ("medicamentoId", "empresaId", "updatedAt")
         VALUES (v_med, v_emp, now())
      RETURNING id INTO v_est;

    -- DOIS movimentos por empresa, e não um: com um só, um bug que devolvesse
    -- "a primeira linha que encontrar" passaria despercebido na contagem.
    INSERT INTO schs2vet.tb_movimentos_estoque (tipo, quantidade, "estoqueId")
         VALUES ('ENTRADA', 10, v_est),
                ('SAIDA',    2, v_est);

  END LOOP;
END $$;
