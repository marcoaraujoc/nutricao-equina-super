// src/pages/FaturaPublica.tsx
//
// Destino do link de fatura enviado por WhatsApp/e-mail (`${APP_URL}/#/fatura/:token`
// — ver backend/src/lib/faturaLinkPublico.js). PÁGINA PÚBLICA: quem abre não tem
// sessão no S2Vet, então usa `fetch` cru (sem `services/api.ts` — nada de cookie de
// sessão, nada do interceptor de 401/403 daquele cliente, que não se aplica aqui).
//
// SEGURANÇA — capability URL "pura" (decisão do usuário em 2026-09-11, revertendo
// uma camada de código de acesso que existiu por um instante): não há verificação
// nenhuma nesta tela, o TOKEN da URL é a única proteção — 64 caracteres aleatórios
// (alfabeto base64url, 384 bits de entropia — ver `gerarToken` no backend), então a
// tela só busca o PDF direto ao montar e mostra o que o servidor devolver.
import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { FileWarning, ShieldCheck, Download, Loader2 } from 'lucide-react';

const SHELL_CLS = 'min-h-screen bg-gray-50 flex items-center justify-center p-4';
const CARD_CLS  = 'bg-white rounded-3xl shadow-sm border border-gray-100 p-8 w-full max-w-md text-center';

export default function FaturaPublica() {
  const { token } = useParams<{ token: string }>();

  const [carregando, setCarregando] = useState(true);
  const [erro,        setErro]      = useState<string | null>(null);
  const [pdfUrl,      setPdfUrl]    = useState<string | null>(null);
  const [pdfNome,     setPdfNome]   = useState('fatura.pdf');
  const urlRevogarRef = useRef<string | null>(null);

  useEffect(() => {
    if (!token) { setErro('Link não encontrado.'); setCarregando(false); return; }
    (async () => {
      try {
        const res = await fetch(`/api/fatura-publica/${token}`);
        const contentType = res.headers.get('content-type') ?? '';

        if (res.ok && contentType.includes('application/pdf')) {
          const blob = await res.blob();
          const url  = URL.createObjectURL(blob);
          urlRevogarRef.current = url;
          setPdfUrl(url);
          const disposicao = res.headers.get('content-disposition') ?? '';
          const nomeMatch  = /filename="([^"]+)"/.exec(disposicao);
          if (nomeMatch) setPdfNome(nomeMatch[1]);
          return;
        }

        const json = await res.json().catch(() => ({}));
        setErro(json?.mensagem ?? 'Não foi possível abrir a fatura.');
      } catch {
        setErro('Não foi possível conectar ao servidor. Tente novamente.');
      } finally {
        setCarregando(false);
      }
    })();

    // Revoga o blob URL do PDF ao desmontar — evita vazar memória.
    return () => { if (urlRevogarRef.current) URL.revokeObjectURL(urlRevogarRef.current); };
  }, [token]);

  if (carregando) {
    return (
      <div className={SHELL_CLS}>
        <Loader2 className="animate-spin text-emerald-600" size={28} />
      </div>
    );
  }

  if (erro) {
    return (
      <div className={SHELL_CLS}>
        <div className={CARD_CLS}>
          <FileWarning className="mx-auto mb-3 text-amber-400" size={40} />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Não foi possível abrir a fatura</h1>
          <p className="text-sm text-gray-600 mb-4">{erro}</p>
          <p className="text-xs text-gray-400">
            <Link to="/login" className="text-emerald-600 hover:underline">Acesse o S2Vet</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="flex items-center justify-between gap-3 bg-white border-b border-gray-100 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 min-w-0">
          <ShieldCheck className="text-emerald-600 flex-shrink-0" size={18} />
          <span className="truncate">Fatura</span>
        </div>
        {pdfUrl && (
          <a
            href={pdfUrl}
            download={pdfNome}
            className="flex items-center gap-1.5 flex-shrink-0 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition-colors"
          >
            <Download size={14} /> Baixar PDF
          </a>
        )}
      </div>
      {pdfUrl && <iframe title="Fatura" src={pdfUrl} className="flex-1 w-full border-0" />}
    </div>
  );
}
