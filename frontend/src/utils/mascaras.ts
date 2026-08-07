// src/utils/mascaras.ts
//
// Máscaras de digitação compartilhadas (documento, telefone, CEP).
//
// ⚠️ Estas funções estavam COPIADAS em 8 telas de cadastro (Animal, CadastroEmpresa,
// CadastroFornecedor, CadastroLocalizacao, CadastroPessoal, CadastroProprietario,
// CadastroTratador e UsuarioFormModal). Cópia de máscara é o caso clássico de divergência
// silenciosa: quem corrige o CPF numa tela não corrige nas outras sete, e o mesmo
// documento passa a ser exibido de dois jeitos dependendo de onde foi digitado.
//
// Tela NOVA importa daqui — não faça a 9ª cópia. As 7 telas legadas ainda têm a delas;
// migrar cada uma quando for tocada (mesmo caminho que `utils/animalInfo.ts` seguiu).

/** Remove tudo que não for dígito. Base de todas as máscaras. */
export const soDigitos = (v: string) => v.replace(/\D/g, '');

/**
 * CPF (11 dígitos) e CNPJ (14) na MESMA máscara — o campo aceita os dois e troca de
 * formato conforme o comprimento. É o que permite um único campo "CNPJ / CPF": a clínica
 * pessoa física assina com CPF, a pessoa jurídica com CNPJ, e quem digita não escolhe
 * o tipo antes.
 */
export function mascaraDocumento(v: string): string {
  const d = soDigitos(v).slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

/** Fixo (10 dígitos) e celular (11) — o 9º dígito muda onde entra o hífen. */
export const mascaraTelefone = (v: string) => {
  const d = soDigitos(v).slice(0, 11);
  return d.length <= 10
    ? d.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2')
    : d.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
};

export const mascaraCep = (v: string) =>
  soDigitos(v).slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2');
