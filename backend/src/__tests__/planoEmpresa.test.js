// backend/src/__tests__/planoEmpresa.test.js
//
// Regras de ASSENTO do plano (fase 2 do multi-tenancy, docs/MULTI-TENANCY-PLANO.md §5.3).
// Sem banco: um client falso devolve o que cada cenário precisa. O que está sob teste é a
// REGRA — quem conta como assento e quando o limite reprova —, não o SQL.

// `planoEmpresa` puxa `lib/prisma.ts` (TypeScript) na cadeia de require, que o jest deste
// projeto não transpila — mesmo mock do `autoriaAtendimento.test.js`. Toda função sob
// teste recebe o client por parâmetro, então o prisma real nunca é usado aqui.
jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });

const { consomeAssento, garantirVagaDeUsuario, limiteUsuarios, usoDeAssentos } =
  require('../lib/planoEmpresa');

/** Client falso: `assinatura` alimenta limiteUsuarios; `assentos` alimenta a contagem. */
const clientFalso = ({ assinatura = null, assentos = 0 }) => ({
  $queryRawUnsafe: async (sql) =>
    sql.includes('tb_assinaturas_empresa') ? (assinatura ? [assinatura] : [])
                                           : [{ n: assentos }],
});

describe('consomeAssento — quem ocupa licença', () => {
  test('profissional com acesso e ativo OCUPA', () => {
    expect(consomeAssento({ perfil: 'VETERINARIO', acessoSistema: true, ativo: true })).toBe(true);
  });

  test('PROPRIETARIO nunca ocupa (D2: cliente com portal não é usuário faturável)', () => {
    expect(consomeAssento({ perfil: 'PROPRIETARIO', acessoSistema: true, ativo: true })).toBe(false);
  });

  test('sem acesso ao sistema não ocupa — é só cadastro da clínica', () => {
    expect(consomeAssento({ perfil: 'VETERINARIO', acessoSistema: false })).toBe(false);
  });

  test('inativo na empresa não ocupa', () => {
    expect(consomeAssento({ perfil: 'ENFERMEIRO', acessoSistema: true, ativo: false })).toBe(false);
  });
});

describe('limiteUsuarios — override vence o plano', () => {
  test('sem assinatura = ILIMITADO (null), não zero', async () => {
    // Empresa sem plano atribuído não pode virar "zero assentos": trancaria para fora as
    // clínicas que já operam.
    await expect(limiteUsuarios(1, clientFalso({}))).resolves.toBeNull();
  });

  test('usa o limite do plano quando não há override', async () => {
    const c = clientFalso({ assinatura: { override: null, plano: 5 } });
    await expect(limiteUsuarios(1, c)).resolves.toBe(5);
  });

  test('override negociado VENCE o limite do plano', async () => {
    const c = clientFalso({ assinatura: { override: 8, plano: 5 } });
    await expect(limiteUsuarios(1, c)).resolves.toBe(8);
  });

  test('plano com limite NULO (Ilimitado) continua ilimitado', async () => {
    const c = clientFalso({ assinatura: { override: null, plano: null } });
    await expect(limiteUsuarios(1, c)).resolves.toBeNull();
  });
});

describe('garantirVagaDeUsuario', () => {
  const comPlano = (plano, assentos) =>
    clientFalso({ assinatura: { override: null, plano }, assentos });

  test('deixa passar quando ainda cabe', async () => {
    await expect(garantirVagaDeUsuario(1, { client: comPlano(5, 3) })).resolves.toBeUndefined();
  });

  test('deixa passar no ÚLTIMO assento (4 ocupados de 5 → o 5º entra)', async () => {
    await expect(garantirVagaDeUsuario(1, { client: comPlano(5, 4) })).resolves.toBeUndefined();
  });

  test('REPROVA quando o plano está cheio', async () => {
    await expect(garantirVagaDeUsuario(1, { client: comPlano(5, 5) }))
      .rejects.toMatchObject({ code: 'LIMITE_USUARIOS_PLANO' });
  });

  test('a mensagem do 409 diz o limite, o uso e a saída', async () => {
    await expect(garantirVagaDeUsuario(1, { client: comPlano(5, 5) }))
      .rejects.toThrow(/5 usuários.*5 já estão em uso.*Altere o plano/s);
  });

  test('quem NÃO ocupa assento passa mesmo com o plano cheio', async () => {
    // Cadastrar um PROPRIETARIO (ou membro sem acesso) não pode esbarrar no limite.
    await expect(garantirVagaDeUsuario(1, { ocupaAssento: false, client: comPlano(5, 5) }))
      .resolves.toBeUndefined();
  });

  test('editar quem JÁ ocupa assento não é contado como assento novo', async () => {
    // Sem `jaOcupava`, salvar o cadastro de um membro existente reprovaria com o plano
    // cheio — o gestor não conseguiria nem corrigir um telefone.
    await expect(garantirVagaDeUsuario(1, { jaOcupava: 1, client: comPlano(5, 5) }))
      .resolves.toBeUndefined();
  });

  test('ilimitado nunca reprova', async () => {
    await expect(garantirVagaDeUsuario(1, { client: comPlano(null, 999) })).resolves.toBeUndefined();
  });
});

describe('usoDeAssentos — retrato para a tela', () => {
  test('mostra ocupados, limite e disponíveis', async () => {
    const c = clientFalso({ assinatura: { override: null, plano: 5 }, assentos: 3 });
    await expect(usoDeAssentos(1, c)).resolves.toEqual({
      limite: 5, ocupados: 3, ilimitado: false, disponiveis: 2,
    });
  });

  test('ilimitado não devolve número de disponíveis', async () => {
    const c = clientFalso({ assentos: 42 });
    await expect(usoDeAssentos(1, c)).resolves.toEqual({
      limite: null, ocupados: 42, ilimitado: true, disponiveis: null,
    });
  });

  test('nunca devolve disponíveis negativo (plano reduzido com gente dentro)', async () => {
    // Baixar o plano de 10 para 3 com 7 pessoas dentro é situação real. A tela precisa
    // dizer "0 disponíveis", não "-4".
    const c = clientFalso({ assinatura: { override: null, plano: 3 }, assentos: 7 });
    await expect(usoDeAssentos(1, c)).resolves.toMatchObject({ disponiveis: 0 });
  });
});
