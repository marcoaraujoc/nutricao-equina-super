// src/components/CampoValidado.tsx
//
// Campo de texto que se valida sozinho: ao SAIR do campo, conteúdo inválido fica
// VERMELHO e a descrição do problema aparece logo abaixo.
//
// É o `DateInput` generalizado. Lá a validação de data vive dentro do componente e as
// 14 telas que o usam ganharam a mensagem de erro sem tocar em nada; aqui vale o mesmo
// para e-mail, CPF/CNPJ, telefone, CEP, CRMV e o que mais entrar em
// `utils/validacoes.ts`.
//
// POR QUE EXISTE: a aplicação tinha TRÊS jeitos de mostrar erro de campo, e nenhum
// validava ao sair —
//   · `ErroAcao` + `classeErro` → erro da AÇÃO, só aparece ao clicar em Salvar;
//   · `FieldError` + `inputErrCls` → só desenha, quem valida é a tela;
//   · o `ErroCampo` local de `Animal.tsx` → mais uma cópia, com estado próprio.
// O resultado prático era o mesmo do campo de data antes de 2026-08-28: você digitava
// um e-mail sem "@", trocava de campo, nada acontecia, e só descobria no Salvar — com
// a mensagem no rodapé do modal, longe do campo culpado.
//
// QUANDO O ERRO APARECE (e quando some), que é o que faz a diferença no uso:
//   · digitando pela 1ª vez  → NÃO reclama. Errar no meio da digitação é normal.
//   · ao SAIR do campo       → valida e mostra.
//   · corrigindo depois disso→ revalida a cada tecla, e a mensagem some assim que o
//                              valor fica bom (não espera sair de novo).
//
// USO
//   <CampoValidado label="E-mail" value={email} onChange={setEmail}
//                  validar={v.email} placeholder="nome@dominio.com.br" />
//   <CampoValidado label="CPF / CNPJ" value={doc} onChange={setDoc}
//                  validar={v.cpfOuCnpj} mascara={mascaraDoc} obrigatorio />

import { useEffect, useId, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { Validador } from '../utils/validacoes';
import { combinar, obrigatorio as validadorObrigatorio } from '../utils/validacoes';

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** Rótulo acima do campo. Omitido, quem desenha o rótulo é a tela. */
  label?: string;
  /** Regra do campo — `utils/validacoes.ts`. Sem ela, só a obrigatoriedade vale. */
  validar?: Validador;
  /** Acrescenta "é obrigatório" à validação e o asterisco ao rótulo. */
  obrigatorio?: boolean;
  /** Formata enquanto digita (CPF, telefone, CEP…). Recebe e devolve o texto. */
  mascara?: (v: string) => string;
  tipo?: 'text' | 'email' | 'tel' | 'number' | 'password';
  multilinha?: boolean;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  /** Texto de apoio abaixo do campo — some quando há erro, para não competir. */
  ajuda?: string;
  /**
   * Erro vindo de FORA (resposta do servidor, validação do submit). VENCE a validação
   * local: "E-mail já cadastrado" é um fato que o campo sozinho não tem como saber.
   */
  erro?: string | null;
  /** Classe da caixa do input. O padrão acompanha o resto dos formulários. */
  className?: string;
  autoComplete?: string;
  'aria-label'?: string;
}

const CAIXA_PADRAO =
  'w-full border rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none transition-colors';

export default function CampoValidado({
  value, onChange, label, validar, obrigatorio = false, mascara,
  tipo = 'text', multilinha = false, rows = 3, placeholder, disabled,
  maxLength, ajuda, erro: erroExterno = null, className, autoComplete, ...rest
}: Props) {
  const id = useId();
  const [tocado, setTocado] = useState(false);
  const [erroLocal, setErroLocal] = useState<string | null>(null);

  const regra = combinar(
    obrigatorio ? validadorObrigatorio(label ?? 'Campo') : null,
    validar,
  );

  // Formulário resetado / modal reaberto: o valor volta a vazio e o campo deixa de ser
  // "visitado". Sem isto, reabrir o cadastro mostraria em vermelho o erro do
  // preenchimento ANTERIOR, num campo que a pessoa ainda nem tocou.
  useEffect(() => {
    if (value === '') { setTocado(false); setErroLocal(null); }
  }, [value]);

  const aoMudar = (bruto: string) => {
    const v = mascara ? mascara(bruto) : bruto;
    onChange(v);
    // Só revalida enquanto digita DEPOIS que o campo já foi visitado — antes disso,
    // reclamar de um e-mail pela metade é ruído.
    if (tocado) setErroLocal(regra(v));
  };

  const aoSair = () => {
    setTocado(true);
    setErroLocal(regra(value));
  };

  const erro = erroExterno ?? erroLocal;

  const classeCaixa = [
    className ?? CAIXA_PADRAO,
    erro ? 'border-red-400 bg-red-50/30 focus:border-red-500' : 'border-gray-200 focus:border-emerald-500',
  ].join(' ');

  const comuns = {
    id,
    value,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => aoMudar(e.target.value),
    onBlur: aoSair,
    placeholder,
    disabled,
    maxLength,
    autoComplete,
    'aria-label': rest['aria-label'] ?? label,
    'aria-invalid': erro ? true : undefined,
    // Liga o campo à mensagem para o leitor de tela — sem isto, quem usa leitor ouve
    // "inválido" e não descobre o motivo.
    'aria-describedby': erro ? `${id}-erro` : (ajuda ? `${id}-ajuda` : undefined),
    className: classeCaixa,
  };

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={id} className="block text-xs text-gray-500 mb-1">
          {label}{obrigatorio && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}

      {multilinha
        ? <textarea {...comuns} rows={rows} className={`${classeCaixa} resize-none`} />
        : <input {...comuns} type={tipo} />}

      {erro
        ? <p id={`${id}-erro`} role="alert" className="text-[11px] text-red-500 mt-1">{erro}</p>
        : ajuda && <p id={`${id}-ajuda`} className="text-[11px] text-gray-400 mt-1">{ajuda}</p>}
    </div>
  );
}
