// src/components/LaudoTexto.tsx
//
// Renderiza o laudo de um exame CLÍNICO (campo `resultado`). Na maioria dos
// casos é texto simples — mas o laudo de exame de Imagem com mais de um
// arquivo anexado (ex.: Ultrassom + Raio-X no mesmo registro) vem com uma
// seção por arquivo, cada uma com um título em Markdown (`# Título`, ver
// `montarLaudoImagemFinal` no backend) e separadas por `---`. Sem isto, o
// título aparecia como texto literal ("# Exame Ultrassonográfico") dentro do
// `whitespace-pre-wrap` — não há parser de Markdown geral aqui, só o título
// ganha destaque (negrito); o resto do laudo é exibido como sempre foi.

const RE_TITULO = /^#{1,3}\s+(.+)$/;

function capitalizarPrimeiraLetra(s: string): string {
  const t = s.trim();
  return t.length > 0 ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

export default function LaudoTexto({ texto, className }: { texto: string; className?: string }) {
  const blocos = texto.split(/\n*---\n*/);

  return (
    <div className={className}>
      {blocos.map((bloco, i) => (
        <div key={i} className={i > 0 ? 'mt-3 pt-3 border-t border-gray-200' : undefined}>
          {bloco.split('\n').map((linha, j) => {
            const m = linha.match(RE_TITULO);
            if (m) return <p key={j} className="font-bold text-gray-900">{capitalizarPrimeiraLetra(m[1])}</p>;
            return linha ? <p key={j}>{linha}</p> : <div key={j} className="h-2" />;
          })}
        </div>
      ))}
    </div>
  );
}
