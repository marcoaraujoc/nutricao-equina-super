// src/components/BrandS2Vet.tsx
// Marca do PRODUTO (S2Vet) — usada no header e no rodapé do shell.
// Não confundir com a logomarca da EMPRESA do contexto ativo (EmpresaContext.marca),
// que identifica a clínica assinante e aparece na Sidebar e no rodapé.
//
// ARTE OFICIAL: guardada NO BANCO (tb_midia_arquivos, pasta 'marca', publico=true) e
// servida por `GET /api/marca`. Carregada/atualizada por
// `backend/scripts/carregarMarcaProduto.js`.
//
// POR QUE saiu do filesystem, se ela é pública de qualquer forma: não foi por
// segurança — esta rota PRECISA ser aberta, porque a marca aparece antes de existir
// sessão. Foi para não sobrar NENHUM código servindo arquivo de disco na aplicação;
// com ela no banco o `express.static` some por completo e ninguém o reintroduz por
// descuido. De quebra, deploy deixa de exigir volume compartilhado.
//
// Rota SEM parâmetro de propósito: não recebe chave do cliente, então não há como
// usá-la para alcançar arquivo de paciente (esses saem por `/api/midia/:chave`,
// autenticado e autorizado por dono).
//
// O PNG JÁ TRAZ O NOME ESCRITO. Por isso header e rodapé não repetem "S2Vet" nem
// tagline ao lado dele — a marca é auto-suficiente.

type Tamanho = 'sm' | 'md';

// Só a ALTURA é fixada; a largura acompanha a proporção da arte (`w-auto`, ~2,1:1).
//
// A arte foi RECORTADA na margem (o arquivo original tinha 62% da tela em vazio, o
// que fazia o logo parecer minúsculo: a 40px de caixa, só ~21px eram desenho). Com o
// recorte, a altura da caixa é a altura real do desenho.
const ALTURA: Record<Tamanho, string> = {
  sm: 'h-9',            // rodapé
  md: 'h-11 md:h-14',   // header
};

interface Props {
  size?: Tamanho;
  className?: string;
}

export default function BrandS2Vet({ size = 'md', className = '' }: Props) {
  return (
    <img
      src="/api/marca"
      alt="S2Vet"
      // Marca ainda não carregada no banco (404): esconde em vez de exibir o ícone
      // de imagem quebrada
      onError={(e) => { e.currentTarget.style.display = 'none'; }}
      className={`${ALTURA[size]} w-auto object-contain flex-shrink-0 ${className}`}
    />
  );
}
