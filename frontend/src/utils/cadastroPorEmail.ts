// frontend/src/utils/cadastroPorEmail.ts
//
// Preenchimento automático dos cadastros de PESSOA pelo e-mail — o espelho de
// `backend/src/lib/cadastroPorEmail.js`. Usado por Prestador, Fornecedor,
// Proprietário e Incluir Membro.
//
// O que a tela faz com cada resposta:
//   CADASTRO → o registro daquele tipo JÁ EXISTE nesta empresa: a tela CARREGA e passa
//              a editá-lo. Sem isso o gestor preenchia o formulário inteiro e só
//              descobria no Salvar, com um 409.
//   PESSOA   → não há registro daquele tipo, mas a EMPRESA já cadastrou a pessoa em
//              outro papel: preenche SÓ o que estiver vazio (ver `preencherVazios`).
//   nada     → e-mail desconhecido AQUI. Não se distingue de "existe em outra clínica"
//              — o backend não conta, de propósito.
//
// ⚠️ O escopo é sempre a EMPRESA ATIVA, resolvido no backend (que ainda tem o RLS
// fail-closed por baixo). A tela NUNCA manda empresaId: quem o define é o contexto.

import api from '../services/api';
import { isValidEmail } from './validators';

/** Campos que a empresa mantém sobre a pessoa (subconjunto de CAMPOS_CADASTRO). */
export interface CadastroPessoa {
  fullName?:    string;
  phone?:       string;
  phone2?:      string;
  cpf?:         string;
  cnpj?:        string;
  cep?:         string;
  endereco?:    string;
  complemento?: string;
  bairro?:      string;
  cidade?:      string;
  estado?:      string;
}

export type RespostaPorEmail<T> =
  | { encontrado: false }
  | {
      encontrado: true;
      origem: 'CADASTRO';
      registro: T;
      perfil: string | null;
      rotuloPerfil: string | null;
    }
  | {
      encontrado: true;
      origem: 'PESSOA';
      cadastro: CadastroPessoa;
      perfil: string | null;
      rotuloPerfil: string | null;
      /** Só no Incluir Membro: aviso antecipado, o veredito continua sendo do salvar. */
      jaMembro?: boolean;
    };

const NADA: RespostaPorEmail<never> = { encontrado: false };

/**
 * Consulta o e-mail na rota do cadastro (`/cadastro/prestadores/por-email`, …).
 *
 * NUNCA lança: preenchimento automático é conveniência, e derrubar o formulário porque
 * a consulta falhou seria trocar um atalho por um impedimento. Falha, 403 (sem
 * permissão de leitura) e e-mail inválido caem todos em "não encontrado", e a pessoa
 * segue digitando como sempre digitou.
 */
export async function consultarCadastroPorEmail<T>(
  rota: string,
  email: string,
): Promise<RespostaPorEmail<T>> {
  const e = email.trim();
  if (!e || !isValidEmail(e)) return NADA;
  try {
    const res = await api.get(`${rota}?email=${encodeURIComponent(e)}`);
    const dados = res.data?.dados;
    if (!dados?.encontrado) return NADA;
    return dados as RespostaPorEmail<T>;
  } catch {
    return NADA;
  }
}

/**
 * Monta o patch do formulário com os campos da pessoa que AINDA ESTÃO VAZIOS.
 *
 * ⚠️ Nunca sobrescreve o que já está na tela: no caso PESSOA o cadastro da empresa é
 * uma SUGESTÃO (ela pode ter mudado de telefone desde que virou cliente), e apagar o
 * que a pessoa acabou de digitar por causa de um dado antigo é pior que não preencher.
 * No caso CADASTRO é o contrário — ali o registro É a verdade e a tela o carrega
 * inteiro, por outro caminho.
 *
 * `mapa` liga o nome do campo no cadastro ao nome dele NAQUELE formulário
 * (`phone → telefone`, por exemplo) e pode aplicar máscara.
 */
export function preencherVazios<F extends object>(
  form: F,
  cadastro: CadastroPessoa,
  mapa: Partial<Record<keyof CadastroPessoa, { campo: keyof F; formatar?: (v: string) => string }>>,
): Partial<F> {
  const patch: Record<string, unknown> = {};
  for (const [origem, destino] of Object.entries(mapa) as [keyof CadastroPessoa, { campo: keyof F; formatar?: (v: string) => string }][]) {
    const valor = cadastro[origem];
    if (valor == null || String(valor).trim() === '') continue;
    const atual = form[destino.campo];
    if (typeof atual === 'string' && atual.trim() !== '') continue;
    patch[destino.campo as string] = destino.formatar ? destino.formatar(String(valor)) : String(valor);
  }
  return patch as Partial<F>;
}

/** Frase da faixa de aviso — uma só redação para as quatro telas. */
export function fraseCadastroEncontrado(
  resposta: Extract<RespostaPorEmail<unknown>, { encontrado: true }>,
  nomeDoCadastro: string,
): string {
  if (resposta.origem === 'CADASTRO') {
    return `Já existe o cadastro de ${nomeDoCadastro.toLowerCase()} com este e-mail nesta clínica — os dados foram carregados e o salvar vai ATUALIZAR esse cadastro.`;
  }
  const papel = resposta.rotuloPerfil ? ` como ${resposta.rotuloPerfil}` : '';
  return `Esta pessoa já tem cadastro nesta clínica${papel}. Preenchemos os campos que estavam em branco — confira antes de salvar.`;
}
