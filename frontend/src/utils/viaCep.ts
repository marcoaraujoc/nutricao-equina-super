// src/utils/viaCep.ts
// Busca de endereço por CEP (ViaCEP), o mesmo serviço que os cadastros já usam.
//
// A chamada é feita DO NAVEGADOR, direto no ViaCEP (a API libera CORS) — é assim em
// todas as telas de cadastro desde sempre, e por isso não há rota no backend para
// isto. Falha é SILENCIOSA e devolve `null`: o CEP é uma conveniência para não
// digitar o endereço inteiro, nunca um bloqueio; serviço fora do ar não pode impedir
// ninguém de preencher o campo à mão.
//
// ⚠️ Existem ~9 cópias deste `fetch` espalhadas pelas telas de cadastro (proprietário,
// fornecedor, prestador, empresa, localização, cadastro pessoal…). Este arquivo nasceu
// com o autopreenchimento da Central de Documentos; ao tocar em uma daquelas telas,
// troque a cópia local por este util em vez de fazer a décima.

export interface EnderecoCep {
  logradouro:  string;
  complemento: string;
  bairro:      string;
  cidade:      string;
  estado:      string;
}

/** Só os dígitos — o campo pode vir "22793-237" ou "22793237". */
export const digitosDoCep = (cep: string): string => String(cep ?? '').replace(/\D/g, '');

/** Máscara `00000-000`, aplicada enquanto se digita. */
export const mascaraCep = (cep: string): string => {
  const d = digitosDoCep(cep).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
};

/** `null` quando o CEP não tem 8 dígitos, não existe, ou o serviço não respondeu. */
export async function buscarEnderecoPorCep(cep: string): Promise<EnderecoCep | null> {
  const nums = digitosDoCep(cep);
  if (nums.length !== 8) return null;
  try {
    const res  = await fetch(`https://viacep.com.br/ws/${nums}/json/`);
    const data = await res.json();
    if (data?.erro) return null;
    return {
      logradouro:  data.logradouro  ?? '',
      complemento: data.complemento ?? '',
      bairro:      data.bairro      ?? '',
      cidade:      data.localidade  ?? '',
      estado:      data.uf          ?? '',
    };
  } catch {
    return null;
  }
}
