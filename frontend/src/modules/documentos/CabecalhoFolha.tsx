// src/modules/documentos/CabecalhoFolha.tsx
// O cabeçalho padrão desenhado em JSX — preview A4 do editor, tela de emissão,
// visualização do emitido e fluxo mobile.
//
// A REGRA (o que entra, em que ordem, o que some vazio) mora em `./cabecalho.ts`;
// aqui é só o desenho. O espelho em STRING, para a impressão e o PDF do Puppeteer,
// é `utils/DocumentoPrint.ts#cabecalhoHtml` — ao mexer no visual, mexa nos dois.
//
// ⚠️ Estilo INLINE, não classe do Tailwind: o PDF do editor é gerado por html2canvas
// fotografando este DOM, e a folha precisa sair igual fora da árvore de estilos do
// app. É a mesma escolha do `BlocoView` e do `PreviewA4`.

import { cabecalhoVazio } from './cabecalho';
import type { DadosCabecalho } from './cabecalho';

export default function CabecalhoFolha({ dados }: { dados: DadosCabecalho }) {
  if (cabecalhoVazio(dados)) return null;

  return (
    <header style={{ borderBottom: '1px solid #e5e7eb', paddingBottom: 10, marginBottom: 14 }}>
      {/* Logo no canto superior esquerdo. Sem logo cadastrada, o nome da clínica
          ocupa o lugar dela — o papel precisa dizer de quem é. */}
      {dados.logoUrl
        ? <img src={dados.logoUrl} alt="" style={{ maxHeight: 52, maxWidth: 190, objectFit: 'contain', display: 'block' }} />
        : dados.empresaNome
          ? <p style={{ fontSize: 14, fontWeight: 700, margin: 0, color: '#111827' }}>{dados.empresaNome}</p>
          : null}

      {/* TÍTULO CENTRALIZADO na largura da folha (a pedido, 2026-09-03) — a logo
          continua à esquerda, e por isso o centro é o da folha, não o do que sobra
          ao lado dela. */}
      {dados.titulo && (
        <h1 style={{
          fontSize: 17, fontWeight: 700, letterSpacing: '0.02em', margin: '10px 0 0',
          color: '#111827', textAlign: 'center',
        }}>
          {dados.titulo}
        </h1>
      )}
    </header>
  );
}
