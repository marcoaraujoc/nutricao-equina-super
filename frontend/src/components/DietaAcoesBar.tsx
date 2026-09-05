// frontend/src/components/DietaAcoesBar.tsx
// Barra de ações da dieta: WhatsApp · E-mail | Imprimir | Exportar (PDF / Excel)
// Reutilizável em Dieta.tsx e outras páginas futuras.
//
// 🔴 O botão "Compartilhar" (2026-09-05) DEIXOU DE EXISTIR: ele abria um modal que
// mandava a dieta só por E-MAIL, com o PDF gerado no NAVEGADOR (html2canvas —
// captura de tela, texto não selecionável). No lugar entrou o mesmo par de botões do
// resto do sistema (`CompartilharPdfBotoes`): WhatsApp e e-mail, PDF do Puppeteer
// anexado de verdade, barra de progresso e resultado no centro da tela.
// ⚠️ `gerarPdfBlob` FICA — é o "Exportar PDF", que baixa o arquivo no navegador e
// não passa pelo servidor.

import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { Printer, Download, ChevronDown, Loader2 } from 'lucide-react';
import { gerarHtmlDieta, prepararDieta, type PrintAnimal, type PrintPlan, type PrintItem, type PrintUser } from '../utils/Dietaprint';
import CompartilharPdfBotoes from './CompartilharPdfBotoes';
import { htmlParaPdfBlob } from '../utils/gerarPdf';
import { imprimirHtml } from '../utils/print/imprimirHtml';
import InlineError from './InlineError';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface AnimalParaAcoes extends PrintAnimal {
  id?: number;
  user?: { fullName: string; email: string; phone?: string | null } | null;
}

export interface PlanoParaAcoes extends PrintPlan {
  id?: number;
  nome: string;
}

export interface DietaAcoesBarProps {
  animal:            AnimalParaAcoes;
  plano:             PlanoParaAcoes;
  itens:             PrintItem[];
  user:              PrintUser | null;
  /** Variante compacta (só ícones, sem labels) — para uso em cabeçalhos mobile */
  compacto?:         boolean;
  podeImprimir?:     boolean;
  podeCompartilhar?: boolean;
  podeExportar?:     boolean;
}

// ─── Helper: gerar PDF como Blob (utils/gerarPdf.ts — compartilhado com toda a aplicação) ──

function gerarPdfBlob(
  animal: PrintAnimal,
  plano:  PrintPlan,
  itens:  PrintItem[],
  user:   PrintUser | null,
): Promise<Blob> {
  return htmlParaPdfBlob(gerarHtmlDieta(animal, plano, itens, user));
}

// ─── DietaAcoesBar ────────────────────────────────────────────────────────────

export default function DietaAcoesBar({
  animal, plano, itens, user, compacto = false,
  podeImprimir = true, podeCompartilhar = true, podeExportar = true,
}: DietaAcoesBarProps) {
  const [exportandoPdf,        setExportandoPdf]        = useState(false);
  const [showExportMenu,       setShowExportMenu]       = useState(false);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline,           setErroInline]           = useState<string | null>(null);
  const exportMenuRef = { current: null as HTMLDivElement | null };

  useEffect(() => {
    if (!showExportMenu) return;
    const handler = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node))
        setShowExportMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showExportMenu]);

  // ── Imprimir ────────────────────────────────────────────────────────────

  const imprimir = () => {
    imprimirHtml(gerarHtmlDieta(animal, plano, itens, user));
  };

  // ── Enviar por WhatsApp / e-mail ────────────────────────────────────────
  //
  // Substituiu o antigo botão "Compartilhar", que abria um modal e mandava só por
  // e-mail, com o PDF gerado no NAVEGADOR (captura de tela). Agora é o mesmo par de
  // botões do resto do sistema: PDF do Puppeteer (texto selecionável), anexado de
  // verdade, com barra de progresso e o resultado no centro da tela.
  // ⚠️ `gerarHtml` é SÍNCRONO — o preparo das imagens vai em `aoPreparar`.
  const opcoesEnvio = {
    gerarHtml:   () => gerarHtmlDieta(animal, plano, itens, user),
    nomeArquivo: `dieta-${animal.nome}-${plano.nome}.pdf`.replace(/\s+/g, '-'),
    texto:       `Segue o plano alimentar de ${animal.nome} — ${plano.nome}.`,
    documento:   'Dieta',
    titulo:      `Plano Alimentar — ${animal.nome}`,
  };

  // ── Exportar PDF ────────────────────────────────────────────────────────

  const exportarPdf = async () => {
    setExportandoPdf(true);
    setShowExportMenu(false);
    try {
      const blob = await gerarPdfBlob(animal, plano, itens, user);
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = `dieta-${animal.nome}-${plano.nome}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch {
      setErroInline('Erro ao gerar PDF');
    } finally {
      setExportandoPdf(false);
    }
  };

  // ── Exportar Excel ──────────────────────────────────────────────────────

  const exportarExcel = () => {
    if (itens.length === 0) { setErroInline('Nenhum item na dieta para exportar'); return; }
    const wb      = XLSX.utils.book_new();
    const headers = ['Alimento', 'Quantidade', 'Unidade', 'Periodicidade', 'Horário'];
    const rows    = itens.map(i => [i.alimento?.nome ?? '—', i.qtdGramasDia, i.unidade, i.periodicidade, i.horario ?? '—']);
    const ws      = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols']   = [{ wch: 30 }, { wch: 12 }, { wch: 10 }, { wch: 22 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws, plano.nome.slice(0, 31));
    XLSX.writeFile(wb, `dieta-${animal.nome}-${plano.nome}.xlsx`);
    setShowExportMenu(false);
  };


  // ── Render ───────────────────────────────────────────────────────────────

  const semPermissao = (acao: string) =>
    setErroInline(`Sem permissão para ${acao}. Verifique com o responsável da equipe.`);

  if (compacto) {
    return (
      <>
        <InlineError message={erroInline} className="mb-2" />

        {podeCompartilhar && (
          <CompartilharPdfBotoes
            {...opcoesEnvio}
            aoPreparar={() => prepararDieta(animal)}
            telefone={animal.user?.phone}
            emailPara={animal.user?.email}
          />
        )}
        {podeImprimir && (
          <button onClick={imprimir} title="Imprimir"
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100">
            <Printer size={15} />
          </button>
        )}
        {podeExportar && (
          <button onClick={exportarPdf} disabled={exportandoPdf} title="Exportar PDF"
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-50">
            {exportandoPdf
              ? <Loader2 size={15} className="animate-spin" />
              : <Download size={15} />}
          </button>
        )}
      </>
    );
  }

  return (
    <>
      <InlineError message={erroInline} className="mb-2" />

      {podeCompartilhar && (
        <CompartilharPdfBotoes
          {...opcoesEnvio}
          aoPreparar={() => prepararDieta(animal)}
          telefone={animal.user?.phone}
          emailPara={animal.user?.email}
        />
      )}

      <button
        onClick={podeImprimir ? imprimir : () => semPermissao('imprimir dieta')}
        className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs transition-colors ${
          podeImprimir
            ? 'border-gray-200 hover:bg-gray-50 text-gray-600'
            : 'border-gray-100 text-gray-300 cursor-not-allowed'
        }`}>
        <Printer size={13} /> Imprimir
      </button>

      <div className="relative" ref={el => { exportMenuRef.current = el; }}>
        <button
          onClick={podeExportar ? () => setShowExportMenu(v => !v) : () => semPermissao('exportar dieta')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
            podeExportar
              ? 'bg-emerald-700 hover:bg-emerald-800 text-white'
              : 'bg-gray-100 text-gray-300 cursor-not-allowed'
          }`}>
          {exportandoPdf
            ? <Loader2 size={13} className="animate-spin" />
            : <Download size={13} />}
          Exportar <ChevronDown size={11} />
        </button>
        {showExportMenu && podeExportar && (
          <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 py-1 min-w-[150px]">
            <button onClick={exportarPdf}
              className="w-full text-left px-4 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2">
              <Printer size={13} /> PDF
            </button>
            <button onClick={exportarExcel}
              className="w-full text-left px-4 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2">
              <Download size={13} /> Excel (.xlsx)
            </button>
          </div>
        )}
      </div>
    </>
  );
}
