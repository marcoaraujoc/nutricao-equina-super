// frontend/src/components/AvisoCadastroEncontrado.tsx
//
// Faixa que explica o preenchimento automático por e-mail nos cadastros de pessoa.
//
// POR QUE EXISTE: o formulário se preencher sozinho é bom; se preencher sozinho SEM
// dizer por quê é assustador — a pessoa digita o e-mail, o nome muda na tela e ela não
// sabe se apagou algo. A faixa diz DE ONDE vieram os dados e o que o Salvar vai fazer.
//
// Fonte ÚNICA das quatro telas (Prestador, Fornecedor, Proprietário, Incluir Membro):
// quatro cópias divergiriam na primeira correção, e o que divergiria é justamente a
// frase que explica se o salvar CRIA ou ATUALIZA.
import { Info, AlertTriangle, X } from 'lucide-react';

interface Props {
  /** Texto já montado (ver `utils/cadastroPorEmail.ts#fraseCadastroEncontrado`). */
  mensagem: string;
  /** CADASTRO = carregou um registro existente; PESSOA = só preencheu o vazio. */
  tom?: 'carregado' | 'preenchido';
  /** Fechar a faixa. Não desfaz o preenchimento — só tira o aviso da frente. */
  onFechar?: () => void;
}

export default function AvisoCadastroEncontrado({ mensagem, tom = 'preenchido', onFechar }: Props) {
  // "Carregado" é o caso em que o Salvar deixa de CRIAR e passa a ATUALIZAR um cadastro
  // que já existe — mudança de consequência, então âmbar (aviso), não emerald (apoio).
  const carregado = tom === 'carregado';
  const cls = carregado
    ? 'bg-amber-50 border-amber-200 text-amber-800'
    : 'bg-emerald-50 border-emerald-100 text-emerald-700';
  const Icone = carregado ? AlertTriangle : Info;

  return (
    <div className={`flex items-start gap-2 border rounded-xl px-3 py-2.5 text-xs ${cls}`} role="status">
      <Icone size={13} className="flex-shrink-0 mt-0.5" />
      <span className="flex-1">{mensagem}</span>
      {onFechar && (
        <button type="button" onClick={onFechar} aria-label="Fechar aviso"
          className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity">
          <X size={13} />
        </button>
      )}
    </div>
  );
}
