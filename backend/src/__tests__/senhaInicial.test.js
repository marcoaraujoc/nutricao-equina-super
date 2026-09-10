'use strict';

/**
 * SENHA INICIAL DE CONTA NOVA (2026-09-08, a pedido).
 *
 * Composição: 3 letras do e-mail (1ª maiúscula) + 2 últimos dígitos do telefone +
 * 3 letras do nome (com uma consoante quando só há 2) + 1 caractere especial.
 *
 * 🔴 O QUE ISTO SUBSTITUIU: a constante `Inicial_001`, impressa na tela de quem
 * cadastrava — um TERCEIRO, não o dono da conta — e igual para todo mundo. Quem
 * tivesse lido a tela uma vez sabia a senha de toda conta nova do sistema, inclusive
 * as que ainda não existiam.
 *
 * ⚠️ E havia um defeito silencioso junto: `AnimalController` anunciava por e-mail
 * `Inicial#001` (com `#`) enquanto o hash gravado era de `Inicial_001` (com `_`). O
 * proprietário recebia uma senha que nunca existiu e não conseguia entrar — sem erro
 * em lugar nenhum, porque as duas pontas nunca se comparavam. É o tipo de divergência
 * que só uma FONTE ÚNICA elimina, e é por isso que este arquivo existe.
 */

const { gerarSenhaInicial, ESPECIAL } = require('../lib/senhaInicial');

describe('composição pedida', () => {
  it('monta e-mail + telefone + nome + especial', () => {
    expect(gerarSenhaInicial({
      email: 'marcoaraujoc@gmail.com', telefone: '(11) 98765-4321', nome: 'Marco Araújo',
    })).toBe('Mar21Mar@');
  });

  it('usa os DOIS ÚLTIMOS dígitos do telefone, não os dois primeiros', () => {
    const s = gerarSenhaInicial({ email: 'ana@x.com', telefone: '11987654399', nome: 'Ana Lima' });
    expect(s).toContain('99');
    expect(s).toBe('Ana99Ana@');
  });

  it('ignora acento e pontuação — a senha não pode depender do teclado', () => {
    // "Ângela" e "Angela" precisam gerar a MESMA senha: o hash é gravado a partir
    // daqui e o e-mail anuncia o mesmo texto.
    expect(gerarSenhaInicial({ email: 'a.b@x.com', telefone: '1130', nome: 'Ângela' }))
      .toBe(gerarSenhaInicial({ email: 'a.b@x.com', telefone: '1130', nome: 'Angela' }));
  });

  it('o e-mail entra sem o domínio', () => {
    // Sem isto, "ze@gmail.com" e "ze@hotmail.com" gerariam senhas diferentes por causa
    // do provedor — e a regra fala das letras do e-mail, não do endereço inteiro.
    expect(gerarSenhaInicial({ email: 'joao@gmail.com', telefone: '1145', nome: 'Joao' }))
      .toBe(gerarSenhaInicial({ email: 'joao@hotmail.com', telefone: '1145', nome: 'Joao' }));
  });
});

describe('nome curto — a consoante da regra', () => {
  it('nome de 2 letras ganha a consoante', () => {
    expect(gerarSenhaInicial({ email: 'bo@x.com', telefone: '1199', nome: 'Bo' })).toBe('Box99Bok@');
  });

  it('nome de 1 letra ainda produz 3 posições — a senha não encolhe', () => {
    const s = gerarSenhaInicial({ email: 'k@x.com', telefone: '1177', nome: 'K' });
    expect(s).toHaveLength(9);
    expect(s.endsWith(ESPECIAL)).toBe(true);
  });
});

describe('cadastro incompleto não gera senha fraca', () => {
  // O que falta é dado do CLIENTE. Encolher a senha por causa disso entregaria a
  // conta mais frágil justamente a quem tem o cadastro pela metade.
  it.each([
    ['sem telefone', { email: 'ana@x.com', nome: 'Ana Paula' }],
    ['sem nome',     { email: 'ana@x.com', telefone: '11999' }],
    ['sem nada',     {}],
    ['argumento ausente', undefined],
  ])('%s → 9 caracteres, terminando no especial', (_rotulo, dados) => {
    const s = gerarSenhaInicial(dados);
    expect(s).toHaveLength(9);
    expect(s.endsWith(ESPECIAL)).toBe(true);
  });
});

describe('determinística — é o que permite reenviar o e-mail de boas-vindas', () => {
  it('mesmo cadastro, mesma senha', () => {
    const d = { email: 'rita@x.com', telefone: '11912345678', nome: 'Rita Souza' };
    expect(gerarSenhaInicial(d)).toBe(gerarSenhaInicial(d));
  });

  it('cadastros diferentes, senhas diferentes — o problema da constante única', () => {
    const a = gerarSenhaInicial({ email: 'rita@x.com', telefone: '1178', nome: 'Rita' });
    const b = gerarSenhaInicial({ email: 'caio@x.com', telefone: '1134', nome: 'Caio' });
    expect(a).not.toBe(b);
  });
});
