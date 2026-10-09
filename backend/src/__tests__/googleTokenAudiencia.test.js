// backend/src/__tests__/googleTokenAudiencia.test.js
//
// O que este arquivo protege: o "Entrar com Google" só pode aceitar token EMITIDO
// PARA O S2VET. O login validava o token apenas pelo /userinfo, que responde para
// token de QUALQUER aplicativo — o dono de um app qualquer reaproveitava o token de
// quem entrou nele e abria sessão no S2Vet como aquela pessoa, sem senha e sem 2FA.
// Quebra em SILÊNCIO: o login legítimo continua funcionando igual.

'use strict';

const fs = require('fs');
const path = require('path');
const { validarTokenInfo, clientIdsPermitidos } = require('../lib/googleToken');

const NOSSO = '111-nosso.apps.googleusercontent.com';
const OUTRO = '999-outro-app.apps.googleusercontent.com';

const tokenInfo = (extra = {}) => ({
  aud: NOSSO, azp: NOSSO, sub: '42', email: 'vet@clinica.com.br',
  email_verified: 'true', expires_in: '3599', ...extra,
});

const ENV = { ...process.env };
afterEach(() => { process.env = { ...ENV }; });

describe('validarTokenInfo — audiência', () => {
  test('aceita token emitido para o Client ID do S2Vet', () => {
    expect(validarTokenInfo(tokenInfo(), [NOSSO])).toEqual({ email: 'vet@clinica.com.br', sub: '42' });
  });

  test('🔴 recusa token VÁLIDO emitido para outro aplicativo', () => {
    expect(() => validarTokenInfo(tokenInfo({ aud: OUTRO, azp: OUTRO }), [NOSSO]))
      .toThrow(expect.objectContaining({ code: 'AUDIENCIA' }));
  });

  test('recusa quando aud e azp faltam (nunca "sem audiência = aceita")', () => {
    expect(() => validarTokenInfo(tokenInfo({ aud: undefined, azp: undefined }), [NOSSO]))
      .toThrow(expect.objectContaining({ code: 'AUDIENCIA' }));
  });

  test('usa azp como reserva quando aud não vem', () => {
    expect(validarTokenInfo(tokenInfo({ aud: undefined }), [NOSSO]).sub).toBe('42');
  });

  test('aceita qualquer um dos IDs da lista (troca de cliente OAuth)', () => {
    expect(validarTokenInfo(tokenInfo({ aud: OUTRO, azp: OUTRO }), [NOSSO, OUTRO]).sub).toBe('42');
  });
});

describe('validarTokenInfo — demais condições', () => {
  test('🔴 fail-closed: sem GOOGLE_CLIENT_ID configurado, recusa', () => {
    expect(() => validarTokenInfo(tokenInfo(), []))
      .toThrow(expect.objectContaining({ code: 'CONFIG' }));
  });

  test('recusa e-mail não verificado', () => {
    expect(() => validarTokenInfo(tokenInfo({ email_verified: 'false' }), [NOSSO]))
      .toThrow(expect.objectContaining({ code: 'EMAIL_NAO_VERIFICADO' }));
  });

  test('recusa resposta de erro do Google', () => {
    expect(() => validarTokenInfo({ error: 'invalid_token' }, [NOSSO]))
      .toThrow(expect.objectContaining({ code: 'INVALIDO' }));
  });

  test('recusa token expirado', () => {
    expect(() => validarTokenInfo(tokenInfo({ expires_in: '0' }), [NOSSO]))
      .toThrow(expect.objectContaining({ code: 'INVALIDO' }));
  });
});

describe('clientIdsPermitidos', () => {
  test('lê a lista separada por vírgula, ignorando espaços e vazios', () => {
    process.env.GOOGLE_CLIENT_ID = ` ${NOSSO} , ,${OUTRO} `;
    expect(clientIdsPermitidos()).toEqual([NOSSO, OUTRO]);
  });

  test('variável ausente = lista vazia', () => {
    delete process.env.GOOGLE_CLIENT_ID;
    expect(clientIdsPermitidos()).toEqual([]);
  });
});

describe('gate estrutural — o controller passa pela validação', () => {
  const src = fs.readFileSync(path.join(__dirname, '../controllers/GoogleController.js'), 'utf8');

  test('GoogleController usa verificarAccessTokenGoogle', () => {
    expect(src).toMatch(/verificarAccessTokenGoogle\(/);
  });

  test('GoogleController não consulta o /userinfo por conta própria', () => {
    expect(src).not.toMatch(/oauth2\/v3\/userinfo/);
  });
});
