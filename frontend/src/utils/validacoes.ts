// src/utils/validacoes.ts
//
// Biblioteca de VALIDADORES de campo — a regra que `CampoValidado` consome.
//
// CONTRATO: um validador recebe o valor e devolve a MENSAGEM do problema, ou `null`
// quando está tudo certo. Devolver a mensagem (e não um booleano) é o que permite ao
// campo dizer O QUE está errado — a mesma decisão de `utils/dataValidacao.ts`:
// "CPF inválido" manda a pessoa conferir onze dígitos; "CPF deve ter 11 dígitos (faltam
// 2)" resolve na hora.
//
// POR QUE EXISTE: `validarCPF`/`validarCNPJ` estavam COPIADOS LITERALMENTE em
// `CadastroFornecedor.tsx` e `CadastroPrestador.tsx` — duas cópias byte a byte, que
// divergiriam na primeira correção. `isValidEmail` já morava em `utils/validators.ts`,
// mas devolvia booleano e cada tela escrevia a própria mensagem.
//
// ⚠️ Validador NÃO reclama de campo VAZIO. Obrigatoriedade é outra pergunta, e quem a
// faz é `obrigatorio()` (ou a prop `obrigatorio` do `CampoValidado`). Misturar as duas
// faz um campo opcional acusar erro só por estar em branco.

import { isValidEmail } from './validators';

/** Devolve a mensagem do problema, ou `null` quando o valor é aceitável. */
export type Validador = (valor: string) => string | null;

const digitos = (v: string) => String(v ?? '').replace(/\D/g, '');

// ─── Documentos ──────────────────────────────────────────────────────────────

/** CPF com dígito verificador conferido (não só o tamanho). */
export function cpfValido(cpf: string): boolean {
  const n = digitos(cpf);
  if (n.length !== 11 || /^(\d)\1+$/.test(n)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += parseInt(n[i]) * (10 - i);
  let r = (s * 10) % 11; if (r >= 10) r = 0;
  if (r !== parseInt(n[9])) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += parseInt(n[i]) * (11 - i);
  r = (s * 10) % 11; if (r >= 10) r = 0;
  return r === parseInt(n[10]);
}

/** CNPJ com os dois dígitos verificadores conferidos. */
export function cnpjValido(cnpj: string): boolean {
  const n = digitos(cnpj);
  if (n.length !== 14 || /^(\d)\1+$/.test(n)) return false;
  const calc = (s: string, w: number[]) => {
    let soma = 0;
    for (let i = 0; i < w.length; i++) soma += parseInt(s[i]) * w[i];
    const r = soma % 11; return r < 2 ? 0 : 11 - r;
  };
  return calc(n, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === parseInt(n[12])
      && calc(n, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === parseInt(n[13]);
}

/** Quantos dígitos faltam/sobram — a mensagem que resolve o erro de digitação. */
function faltamDigitos(v: string, esperado: number): string | null {
  const n = digitos(v).length;
  if (n === esperado) return null;
  const diff = esperado - n;
  return diff > 0
    ? `Faltam ${diff} dígito${diff > 1 ? 's' : ''} (são ${esperado})`
    : `${-diff} dígito${-diff > 1 ? 's' : ''} a mais (são ${esperado})`;
}

export const cpf: Validador = (v) => {
  if (!digitos(v)) return null;
  return faltamDigitos(v, 11) ?? (cpfValido(v) ? null : 'CPF inválido — confira os números');
};

export const cnpj: Validador = (v) => {
  if (!digitos(v)) return null;
  return faltamDigitos(v, 14) ?? (cnpjValido(v) ? null : 'CNPJ inválido — confira os números');
};

/**
 * Aceita os dois e decide pelo TAMANHO — é como os cadastros de
 * fornecedor/prestador/proprietário funcionam (um campo, dois formatos).
 */
export const cpfOuCnpj: Validador = (v) => {
  const n = digitos(v);
  if (!n) return null;
  if (n.length <= 11) return cpf(v);
  return cnpj(v);
};

// ─── Contato ─────────────────────────────────────────────────────────────────

export const email: Validador = (v) => {
  const t = String(v ?? '').trim();
  if (!t) return null;
  if (!t.includes('@')) return 'E-mail sem @';
  return isValidEmail(t) ? null : 'E-mail inválido (ex.: nome@dominio.com.br)';
};

/** Fixo (10) ou celular (11), com DDD. */
export const telefone: Validador = (v) => {
  const n = digitos(v);
  if (!n) return null;
  if (n.length < 10) return `Telefone incompleto — faltam ${10 - n.length} dígito(s) com DDD`;
  if (n.length > 11) return 'Telefone com dígitos demais';
  // Celular tem 11 e começa com 9 no nono dígito; fixo tem 10. Não checamos o 9
  // porque numeração muda por região — o tamanho já pega o erro comum.
  return null;
};

export const cep: Validador = (v) => {
  const n = digitos(v);
  if (!n) return null;
  return n.length === 8 ? null : faltamDigitos(v, 8);
};

// ─── Profissional ────────────────────────────────────────────────────────────

const UFS = 'AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO';
const CRMV_REGEX = new RegExp(`^\\d{1,6}/(${UFS})$`, 'i');

export const crmv: Validador = (v) => {
  const t = String(v ?? '').trim();
  if (!t) return null;
  if (!t.includes('/')) return 'CRMV sem a UF — use o formato 12345/SP';
  return CRMV_REGEX.test(t) ? null : 'CRMV inválido — use o formato 12345/SP';
};

// ─── Genéricos ───────────────────────────────────────────────────────────────

export const obrigatorio = (rotulo = 'Campo'): Validador =>
  (v) => (String(v ?? '').trim() ? null : `${rotulo} é obrigatório`);

export const tamanhoMinimo = (min: number, rotulo = 'Campo'): Validador =>
  (v) => {
    const t = String(v ?? '').trim();
    if (!t) return null;
    return t.length >= min ? null : `${rotulo} deve ter ao menos ${min} caracteres`;
  };

export const numeroEntre = (min: number, max: number): Validador =>
  (v) => {
    const t = String(v ?? '').trim();
    if (!t) return null;
    const n = Number(t.replace(',', '.'));
    if (!Number.isFinite(n)) return 'Informe um número';
    if (n < min) return `Valor mínimo: ${min}`;
    if (n > max) return `Valor máximo: ${max}`;
    return null;
  };

/**
 * Encadeia validadores e devolve a PRIMEIRA mensagem.
 *
 * Primeira e não todas: uma pilha de três erros sob o campo é ruído — a pessoa
 * corrige um de cada vez, e o seguinte aparece quando o anterior sai.
 */
export const combinar = (...vs: (Validador | undefined | null)[]): Validador =>
  (valor) => {
    for (const v of vs) {
      if (!v) continue;
      const msg = v(valor);
      if (msg) return msg;
    }
    return null;
  };
