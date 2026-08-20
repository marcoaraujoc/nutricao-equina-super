// frontend/src/components/DietaAcoesBar.tsx
// Barra de ações da dieta: Compartilhar | Imprimir | Exportar (PDF / Excel)
// Reutilizável em Dieta.tsx e outras páginas futuras.

import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import {
  Printer, Download, Share2, ChevronDown,
  X, MessageCircle, Mail, Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { gerarHtmlDieta, type PrintAnimal, type PrintPlan, type PrintItem, type PrintUser } from '../utils/Dietaprint';
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

// ─── Helper: blob → base64 ────────────────────────────────────────────────────

async function blobParaBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  return btoa(new Uint8Array(buf).reduce((s, b) => s + String.fromCharCode(b), ''));
}

// ─── Modal de compartilhamento ────────────────────────────────────────────────

function CompartilharModal({
  animal, plano, itens, user, onClose,
}: {
  animal:  AnimalParaAcoes;
  plano:   PlanoParaAcoes;
  itens:   PrintItem[];
  user:    PrintUser | null;
  onClose: () => void;
}) {
  const [estado, setEstado] = useState<'idle' | 'gerando' | 'enviando'>('idle');
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);

  const emailPropr = animal.user?.email  ?? '';
  const phoneRaw   = (animal.user?.phone ?? '').replace(/\D/g, '');
  const phoneWA    = phoneRaw.startsWith('55') ? phoneRaw : phoneRaw ? `55${phoneRaw}` : '';
  const textoWA    = `Segue a Dieta do Cavalo ${animal.nome}`;

  // ── WhatsApp ─────────────────────────────────────────────────────────────

  const handleWhatsApp = async () => {
    setEstado('gerando');
    try {
      const blob    = await gerarPdfBlob(animal, plano, itens, user);
      const arquivo = new File([blob], `dieta-${animal.nome}-${plano.nome}.pdf`, { type: 'application/pdf' });

      // Mobile: Web Share API com arquivo (anexa direto no WhatsApp)
      if (navigator.canShare && navigator.canShare({ files: [arquivo] })) {
        await navigator.share({
          files: [arquivo],
          title: `Plano de Dieta — ${animal.nome}`,
          text:  textoWA,
        });
        onClose();
        return;
      }

      // Desktop: baixa o PDF e abre WhatsApp Web com número/texto pré-preenchido
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href = url; a.download = arquivo.name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 100);

      const waUrl = phoneWA
        ? `https://wa.me/${phoneWA}?text=${encodeURIComponent(textoWA)}`
        : `https://web.whatsapp.com/send?text=${encodeURIComponent(textoWA)}`;
      setTimeout(() => window.open(waUrl, '_blank', 'noopener,noreferrer'), 500);
      toast('PDF baixado — anexe-o na conversa do WhatsApp.', { icon: '📎', duration: 5000 });
      onClose();
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') setErroInline('Erro ao preparar compartilhamento');
    } finally {
      setEstado('idle');
    }
  };

  // ── E-mail via backend (com anexo real) ──────────────────────────────────

  const handleEmail = async () => {
    if (!emailPropr) {
      setErroInline('Proprietário sem e-mail cadastrado');
      return;
    }
    setEstado('gerando');
    try {
      const blob    = await gerarPdfBlob(animal, plano, itens, user);
      setEstado('enviando');
      const base64  = await blobParaBase64(blob);

      await api.post('/dietas/compartilhar', {
        emailDestinatario: emailPropr,
        nomeProprietario:  animal.user?.fullName ?? '',
        nomeAnimal:        animal.nome,
        planoNome:         plano.nome,
        pdfBase64:         base64,
      });

      toast.success(`E-mail enviado para ${emailPropr}`);
      onClose();
    } catch {
      setErroInline('Erro ao enviar e-mail');
    } finally {
      setEstado('idle');
    }
  };

  const ocupado = estado !== 'idle';
  const label   = estado === 'gerando' ? 'Gerando PDF…' : estado === 'enviando' ? 'Enviando…' : '';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm border border-gray-100 overflow-hidden">

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="font-bold text-gray-900 text-sm">Compartilhar Dieta</h3>
            <p className="text-xs text-gray-400 mt-0.5">{animal.nome} · {plano.nome}</p>
          </div>
          <button onClick={onClose} disabled={ocupado} className="p-1 text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        {animal.user && (
          <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 space-y-0.5">
            <p className="text-xs font-semibold text-gray-700">{animal.user.fullName}</p>
            {emailPropr && <p className="text-xs text-gray-400">✉ {emailPropr}</p>}
            {phoneRaw   && <p className="text-xs text-gray-400">📱 {animal.user.phone}</p>}
          </div>
        )}

        <div className="p-5 space-y-3">
          {ocupado ? (
            <div className="flex items-center justify-center gap-2 py-6 text-emerald-700">
              <Loader2 size={20} className="animate-spin" />
              <span className="text-sm font-medium">{label}</span>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={handleWhatsApp}
                  className="flex flex-col items-center gap-2 py-4 bg-[#25D366] hover:bg-[#1da851] text-white rounded-xl font-semibold text-sm transition-colors">
                  <MessageCircle size={22} />
                  WhatsApp
                </button>
                <button
                  onClick={handleEmail}
                  disabled={!emailPropr}
                  className="flex flex-col items-center gap-2 py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 text-white rounded-xl font-semibold text-sm transition-colors">
                  <Mail size={22} />
                  E-mail
                </button>
              </div>
              {!emailPropr && (
                <p className="text-xs text-center text-amber-600">
                  Proprietário sem e-mail cadastrado
                </p>
              )}
              <InlineError message={erroInline} />

              <button onClick={onClose} className="w-full py-2 text-xs text-gray-400 hover:text-gray-600 transition-colors">
                Cancelar
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── DietaAcoesBar ────────────────────────────────────────────────────────────

export default function DietaAcoesBar({
  animal, plano, itens, user, compacto = false,
  podeImprimir = true, podeCompartilhar = true, podeExportar = true,
}: DietaAcoesBarProps) {
  const [exportandoPdf,        setExportandoPdf]        = useState(false);
  const [compartilhando,       setCompartilhando]       = useState(false);
  const [showCompartilhar,     setShowCompartilhar]     = useState(false);
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

  // ── Abrir modal compartilhar ─────────────────────────────────────────────

  const abrirCompartilhar = () => {
    setCompartilhando(true);
    setShowCompartilhar(true);
    setCompartilhando(false);
  };

  // ── Render ───────────────────────────────────────────────────────────────

  const semPermissao = (acao: string) =>
    setErroInline(`Sem permissão para ${acao}. Verifique com o responsável da equipe.`);

  if (compacto) {
    return (
      <>
        <InlineError message={erroInline} className="mb-2" />

        {podeCompartilhar && (
          <button onClick={abrirCompartilhar} title="Compartilhar"
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100">
            <Share2 size={15} />
          </button>
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
        {showCompartilhar && (
          <CompartilharModal animal={animal} plano={plano} itens={itens} user={user}
            onClose={() => setShowCompartilhar(false)} />
        )}
      </>
    );
  }

  return (
    <>
      <InlineError message={erroInline} className="mb-2" />

      <button
        onClick={podeCompartilhar ? abrirCompartilhar : () => semPermissao('compartilhar dieta')}
        disabled={compartilhando}
        className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs transition-colors disabled:opacity-60 ${
          podeCompartilhar
            ? 'border-gray-200 hover:bg-gray-50 text-gray-600'
            : 'border-gray-100 text-gray-300 cursor-not-allowed'
        }`}>
        {compartilhando
          ? <Loader2 size={13} className="animate-spin" />
          : <Share2 size={13} />}
        Compartilhar
      </button>

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

      {showCompartilhar && (
        <CompartilharModal animal={animal} plano={plano} itens={itens} user={user}
          onClose={() => setShowCompartilhar(false)} />
      )}
    </>
  );
}
