// src/components/BrandS2Vet.tsx
// Marca do PRODUTO (S2Vet) — usada no header e no rodapé do shell.
// Não confundir com a logomarca da EMPRESA do contexto ativo (EmpresaContext.marca),
// que identifica a clínica assinante e aparece na Sidebar e no rodapé.
//
// ARTE OFICIAL: `backend/uploads/empresas/s2vet-logo.png`, servida em
// `/uploads/empresas/s2vet-logo.png` — o MESMO diretório das logomarcas das empresas
// clientes (EmpresaConfiguracao.logoUrl), por decisão de manter tudo num lugar só.
// O Vite proxia `/uploads` em dev e o backend serve o estático em produção.
//
// Nome FIXO de propósito: as logos de empresa recebem nome aleatório (capability URL)
// porque são conteúdo de cliente; esta é asset do produto e precisa ser referenciável
// estaticamente daqui.
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
      src="/uploads/empresas/s2vet-logo.png"
      alt="S2Vet"
      // Arquivo ausente: esconde em vez de exibir o ícone de imagem quebrada
      onError={(e) => { e.currentTarget.style.display = 'none'; }}
      className={`${ALTURA[size]} w-auto object-contain flex-shrink-0 ${className}`}
    />
  );
}
