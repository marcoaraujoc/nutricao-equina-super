// src/pages/Configuracoes.tsx
import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import { Camera, Loader2 } from 'lucide-react';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import { usePermissoes } from '../hooks/usePermissoes';

// ─── Utilitário de compressão (mesmo padrão de Animal.tsx) ───────────────────
const comprimirImagem = (file: File, maxWidth = 1200, qualidade = 0.82): Promise<File> =>
  new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { width, height } = img;
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width  = maxWidth;
      }

      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; }
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
            type:         'image/jpeg',
            lastModified: Date.now(),
          }));
        },
        'image/jpeg',
        qualidade,
      );
    };

    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });

// ─── Regra de fechamento ──────────────────────────────────────────────────────
// Opções apresentadas ao usuário. PRIMEIRO_DIA_MES é só um atalho de UX para
// DIA_FIXO com dia=1 — o backend não distingue os dois.
type TipoSelecao = 'DIA_ESPECIFICO' | 'PRIMEIRO_DIA_MES' | 'ULTIMO_DIA_MES' | 'DIA_UTIL';

const ORDINAIS = ['1º', '2º', '3º', '4º', '5º', '6º', '7º', '8º', '9º', '10º'];

export default function Configuracoes() {
  const { isGestor, loading: loadingPerms } = usePermissoes();

  const [loading,      setLoading]      = useState(true);
  const [salvando,     setSalvando]     = useState(false);
  const [logoPreview,  setLogoPreview]  = useState<string | null>(null);
  const [logoFile,     setLogoFile]     = useState<File | null>(null);
  const [logoRemovido, setLogoRemovido] = useState(false);

  const [tipoSelecao,    setTipoSelecao]    = useState<TipoSelecao>('ULTIMO_DIA_MES');
  const [diaEspecifico,  setDiaEspecifico]  = useState('5');
  const [nDiaUtil,       setNDiaUtil]       = useState('5');

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/equipes/configuracoes');
      if (!res.data) return; // 403 silencioso — ver services/api.ts
      const dados = res.data?.dados;
      if (dados) {
        setLogoPreview(dados.logoUrl ?? null);

        if (dados.tipoFechamento === 'DIA_UTIL') {
          setTipoSelecao('DIA_UTIL');
          setNDiaUtil(String(dados.diaFechamentoFatura ?? 5));
        } else if (dados.tipoFechamento === 'DIA_FIXO' && dados.diaFechamentoFatura === 1) {
          setTipoSelecao('PRIMEIRO_DIA_MES');
        } else if (dados.tipoFechamento === 'DIA_FIXO') {
          setTipoSelecao('DIA_ESPECIFICO');
          setDiaEspecifico(String(dados.diaFechamentoFatura ?? 5));
        } else {
          setTipoSelecao('ULTIMO_DIA_MES');
        }
      }
    } catch {
      toast.error('Erro ao carregar configurações.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loadingPerms || !isGestor) return; // gating — evita chamada prematura antes de carregar permissões
    carregar();
  }, [loadingPerms, isGestor, carregar]);

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Preview imediato antes de comprimir
    const reader = new FileReader();
    reader.onloadend = () => setLogoPreview(reader.result as string);
    reader.readAsDataURL(file);

    // Comprime em background
    const comprimido = await comprimirImagem(file);
    setLogoFile(comprimido);
    setLogoRemovido(false);

    // Atualiza preview com versão comprimida
    const reader2 = new FileReader();
    reader2.onloadend = () => setLogoPreview(reader2.result as string);
    reader2.readAsDataURL(comprimido);
  };

  const handleRemoverLogo = () => {
    setLogoPreview(null);
    setLogoFile(null);
    setLogoRemovido(true);
  };

  const handleSalvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isGestor) {
      toast.error('Sem permissão para salvar configurações. Verifique com o responsável da equipe.');
      return;
    }

    let tipoFechamento: 'DIA_FIXO' | 'DIA_UTIL' | 'ULTIMO_DIA_MES';
    let diaFechamentoFatura: number | null;

    if (tipoSelecao === 'ULTIMO_DIA_MES') {
      tipoFechamento = 'ULTIMO_DIA_MES';
      diaFechamentoFatura = null;
    } else if (tipoSelecao === 'PRIMEIRO_DIA_MES') {
      tipoFechamento = 'DIA_FIXO';
      diaFechamentoFatura = 1;
    } else if (tipoSelecao === 'DIA_UTIL') {
      const n = Number(nDiaUtil);
      if (!Number.isInteger(n) || n < 1 || n > 10) {
        toast.error('O dia útil deve estar entre 1 e 10.');
        return;
      }
      tipoFechamento = 'DIA_UTIL';
      diaFechamentoFatura = n;
    } else {
      const n = Number(diaEspecifico);
      if (!Number.isInteger(n) || n < 1 || n > 31) {
        toast.error('O dia específico deve estar entre 1 e 31.');
        return;
      }
      tipoFechamento = 'DIA_FIXO';
      diaFechamentoFatura = n;
    }

    setSalvando(true);
    try {
      const fd = new FormData();
      fd.append('tipoFechamento', tipoFechamento);
      if (diaFechamentoFatura != null) fd.append('diaFechamentoFatura', String(diaFechamentoFatura));
      if (logoFile) fd.append('logo', logoFile);
      if (logoRemovido) fd.append('removerLogo', 'true');

      const res = await api.put('/equipes/configuracoes', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const dados = res.data?.dados;
      if (dados) setLogoPreview(dados.logoUrl ?? null);
      setLogoFile(null);
      setLogoRemovido(false);
      toast.success('Configurações salvas com sucesso!');
    } catch {
      // interceptor já trata isPermissionError silenciosamente
      toast.error('Erro ao salvar configurações.');
    } finally {
      setSalvando(false);
    }
  };

  if (!loadingPerms && !isGestor) {
    return (
      <PageContainer maxWidth="3xl">
        <div className="text-center py-16">
          <h2 className="text-xl font-semibold text-gray-700">Acesso não autorizado</h2>
          <p className="text-gray-500 mt-2">Você não tem permissão para visualizar esta página.</p>
        </div>
      </PageContainer>
    );
  }

  if (loadingPerms || loading) {
    return (
      <PageContainer maxWidth="3xl">
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-emerald-600" size={32} />
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer maxWidth="3xl">
      <BotaoVoltar />
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Configurações</h1>

      <div className="bg-white shadow rounded-3xl p-5 sm:p-8">

        {/* Logotipo */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <label className="cursor-pointer group">
            <div className="w-32 h-32 rounded-3xl border-4 border-emerald-600 overflow-hidden bg-gray-50 shadow-inner transition-all group-hover:scale-105 flex items-center justify-center">
              {logoPreview
                ? <img src={logoPreview} alt="Logotipo da empresa" className="w-full h-full object-contain" />
                : <div className="flex flex-col items-center gap-1 text-emerald-500 p-3">
                    <Camera size={28} />
                    <span className="text-xs font-medium text-gray-400 text-center leading-tight">Adicionar logotipo</span>
                  </div>
              }
            </div>
            <input type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
          </label>
          {logoPreview && (
            <button type="button" onClick={handleRemoverLogo}
              className="text-xs text-gray-400 hover:text-red-500 underline transition-colors">
              Remover logotipo
            </button>
          )}
        </div>

        <form onSubmit={handleSalvar} className="space-y-5">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Fechamento da fatura
            </label>
            <select
              value={tipoSelecao}
              onChange={e => setTipoSelecao(e.target.value as TipoSelecao)}
              className="w-full border border-gray-300 rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="ULTIMO_DIA_MES">Último dia do mês</option>
              <option value="PRIMEIRO_DIA_MES">Primeiro dia do mês</option>
              <option value="DIA_ESPECIFICO">Dia específico do mês</option>
              <option value="DIA_UTIL">Dia útil do mês</option>
            </select>

            {tipoSelecao === 'DIA_ESPECIFICO' && (
              <input
                type="number"
                min={1}
                max={31}
                value={diaEspecifico}
                onChange={e => setDiaEspecifico(e.target.value)}
                placeholder="Ex: 5"
                className="w-full border border-gray-300 rounded-2xl px-4 py-2.5 text-sm mt-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            )}

            {tipoSelecao === 'DIA_UTIL' && (
              <select
                value={nDiaUtil}
                onChange={e => setNDiaUtil(e.target.value)}
                className="w-full border border-gray-300 rounded-2xl px-4 py-2.5 text-sm mt-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {ORDINAIS.map((label, i) => (
                  <option key={i} value={i + 1}>{label} dia útil</option>
                ))}
              </select>
            )}

            <p className="text-xs text-gray-400 mt-1">
              {tipoSelecao === 'DIA_UTIL'
                ? 'Dia útil considera fins de semana e feriados nacionais.'
                : 'Se o dia escolhido não existir no mês (ex: dia 31 em fevereiro), a fatura fecha no último dia do mês.'}
            </p>
          </div>

          <button
            type="submit"
            disabled={salvando}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold rounded-2xl py-3 transition-colors"
          >
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
        </form>
      </div>
    </PageContainer>
  );
}
