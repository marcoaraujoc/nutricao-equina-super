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
// (alfabeto base64url, 384 bits de entropia — ver `gerarToken` no backend).
//
// SEM CABEÇALHO PRÓPRIO — a pedido do usuário: o PDF (mesmo HTML da impressão,
// ver utils/FaturaExport.ts) já é o documento de referência e já tem seu próprio
// cabeçalho; uma barra da PÁGINA por cima duplicava informação e o navegador já
// mostra sua própria barra de ferramentas do visualizador de PDF (zoom, baixar,
// imprimir). O iframe ocupa a tela inteira; nada além do PDF é renderizado aqui.
//
// A rota `/resumo` (GET, antes do PDF) continua sendo chamada — não para exibir
// nada, mas porque é ELA que: (1) distingue "revogado" de "expirado" para a tela
// de erro, e (2) conta como "a fatura foi acessada" no backend (qtdAcessos/
// ultimoAcessoEm + auditoria ACESSO_PUBLICO — ver lib/faturaLinkPublico.js#obterResumo).
import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { FileWarning, Loader2, Ban, Clock } from 'lucide-react';

const SHELL_CLS = 'min-h-screen bg-gray-50 flex items-center justify-center p-4';
const CARD_CLS  = 'bg-white rounded-3xl shadow-sm border border-gray-100 p-8 w-full max-w-md text-center';

export default function FaturaPublica() {
  const { token } = useParams<{ token: string }>();

  const [carregando, setCarregando] = useState(true);
  const [erro,        setErro]      = useState<string | null>(null);
  const [tipoErro,    setTipoErro]  = useState<'revogado' | 'expirado' | null>(null);
  const [pdfUrl,      setPdfUrl]    = useState<string | null>(null);
  const urlRevogarRef = useRef<string | null>(null);

  useEffect(() => {
    if (!token) { setErro('Link não encontrado.'); setCarregando(false); return; }
    (async () => {
      try {
        const resResumo = await fetch(`/api/fatura-publica/${token}/resumo`);
        if (!resResumo.ok) {
          const jsonResumo = await resResumo.json().catch(() => ({}));
          setErro(jsonResumo?.mensagem ?? 'Não foi possível abrir a fatura.');
          setTipoErro(jsonResumo?.revogado ? 'revogado' : jsonResumo?.expirado ? 'expirado' : null);
          setCarregando(false);
          return;
        }

        const res = await fetch(`/api/fatura-publica/${token}`);
        const contentType = res.headers.get('content-type') ?? '';
        if (res.ok && contentType.includes('application/pdf')) {
          const blob = await res.blob();
          const url  = URL.createObjectURL(blob);
          urlRevogarRef.current = url;
          setPdfUrl(url);
        }
      } catch {
        setErro('Não foi possível conectar ao servidor. Tente novamente.');
      } finally {
        setCarregando(false);
      }
    })();

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
    const Icone = tipoErro === 'revogado' ? Ban : tipoErro === 'expirado' ? Clock : FileWarning;
    return (
      <div className={SHELL_CLS}>
        <div className={CARD_CLS}>
          <Icone className="mx-auto mb-3 text-amber-400" size={40} />
          <h1 className="text-xl font-bold text-gray-900 mb-2">
            {tipoErro === 'revogado' ? 'Link revogado' : tipoErro === 'expirado' ? 'Link expirado' : 'Não foi possível abrir a fatura'}
          </h1>
          <p className="text-sm text-gray-600 mb-4">{erro}</p>
          <p className="text-xs text-gray-400">
            <Link to="/login" className="text-emerald-600 hover:underline">Acesse o S2Vet</Link>
          </p>
        </div>
      </div>
    );
  }

  if (!pdfUrl) return null;
  return <iframe title="Fatura" src={pdfUrl} className="w-screen h-screen border-0 block" />;
}
