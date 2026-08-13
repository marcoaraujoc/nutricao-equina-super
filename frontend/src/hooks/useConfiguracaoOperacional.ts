// src/hooks/useConfiguracaoOperacional.ts
//
// Estado e regras da seção "operacional" do Cadastro da Empresa (`/cadastro/empresa`) —
// logotipo, fechamento de fatura, WhatsApp (número + conexão via Evolution API),
// espécies atendidas, expediente de atendimento, tempo de consulta padrão e validade
// do orçamento. GET/PUT continuam os MESMOS endpoints (`/equipes/configuracoes`).
//
// Extraído de `components/ConfiguracoesOperacionaisSection.tsx` (2026-08-19): a tela
// passou a intercalar estes campos com os de Identificação/Endereço (o WhatsApp, por
// exemplo, mora na mesma linha de E-mail/Telefone) — um componente que renderiza tudo
// de uma vez não permite esse entrelaçamento. Este hook só guarda ESTADO e REGRA; quem
// desenha a tela é `pages/CadastroEmpresa.tsx`, na ordem que fizer sentido ali.

import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import type { ErroAcaoDados } from '../components/ErroAcao';

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

export type TipoSelecao = 'DIA_ESPECIFICO' | 'PRIMEIRO_DIA_MES' | 'ULTIMO_DIA_MES' | 'DIA_UTIL';

export const ORDINAIS = ['1º', '2º', '3º', '4º', '5º', '6º', '7º', '8º', '9º', '10º'];

export const VALIDADE_ORC_MIN = 1;
export const VALIDADE_ORC_MAX = 365;

// Espécies que a empresa pode declarar como atendidas. O catálogo de especialidades
// tem mais espécies (Canino/Felino/Réptil), mas esta tela só oferece as que o produto
// atende hoje — a lista fica presa a nomes, não a IDs, porque o id de Especie varia
// por base. Comparação sem acento/caixa. Mesma lista de EquipeManager.tsx.
const ESPECIES_PERMITIDAS = ['EQUINO', 'BOVINO'];
const normalizarNome = (s: string) =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toUpperCase();

export const DIAS_SEMANA = [
  { v: 0, l: 'Dom' }, { v: 1, l: 'Seg' }, { v: 2, l: 'Ter' }, { v: 3, l: 'Qua' },
  { v: 4, l: 'Qui' }, { v: 5, l: 'Sex' }, { v: 6, l: 'Sáb' },
];

export const maskWhatsapp = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2)  return d;
  if (d.length <= 6)  return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

/** Status de conexão do WhatsApp — ver `WhatsAppStatusField` para o mapeamento em cor. */
export type WaStatus = 'CARREGANDO' | 'CONECTADO' | 'AGUARDANDO_QR' | 'DESCONECTADO';

export function useConfiguracaoOperacional() {
  const [erroAcao, setErroAcao] = useState<ErroAcaoDados | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [logoPreview,  setLogoPreview]  = useState<string | null>(null);
  const [logoFile,     setLogoFile]     = useState<File | null>(null);
  const [logoRemovido, setLogoRemovido] = useState(false);

  const [tipoSelecao,    setTipoSelecao]    = useState<TipoSelecao>('ULTIMO_DIA_MES');
  const [diaEspecifico,  setDiaEspecifico]  = useState('5');
  const [erroDia,        setErroDia]        = useState<string | null>(null);
  const [nDiaUtil,       setNDiaUtil]       = useState('5');
  const [whatsapp,       setWhatsapp]       = useState('');

  // ── Conexão WhatsApp (Evolution API — via backend; nada da Evolution chega aqui) ──
  const [waStatus,     setWaStatus]     = useState<WaStatus>('CARREGANDO');
  const [waDisponivel, setWaDisponivel] = useState(true);
  const [waQr,         setWaQr]         = useState<string | null>(null);
  const [waAcao,       setWaAcao]       = useState(false);
  const waPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pararPollWa = useCallback(() => {
    if (waPollRef.current) { clearInterval(waPollRef.current); waPollRef.current = null; }
  }, []);

  const carregarWaStatus = useCallback(async () => {
    try {
      const res = await api.get('/equipes/whatsapp/status');
      if (!res.data) return;
      setWaStatus(res.data?.dados?.status ?? 'DESCONECTADO');
      setWaDisponivel(Boolean(res.data?.dados?.disponivel));
    } catch { setWaDisponivel(false); setWaStatus('DESCONECTADO'); }
  }, []);

  useEffect(() => { carregarWaStatus(); return pararPollWa; }, [carregarWaStatus, pararPollWa]);

  const handleWaConectar = useCallback(async (reconectar = false) => {
    setWaAcao(true);
    setErroAcao(null); // uma tentativa nova limpa o erro da anterior — senão a luz
                        // fica presa em vermelho mesmo depois de um sucesso.
    try {
      const res   = await api.post(`/equipes/whatsapp/${reconectar ? 'reconectar' : 'conectar'}`);
      const dados = res.data?.dados;
      setWaStatus(dados?.status ?? 'DESCONECTADO');
      if (dados?.qrcodeBase64) {
        setWaQr(dados.qrcodeBase64);
        pararPollWa();
        waPollRef.current = setInterval(async () => {
          try {
            const s  = await api.get('/equipes/whatsapp/status');
            const st = s.data?.dados?.status;
            if (st) setWaStatus(st);
            if (st === 'CONECTADO') { pararPollWa(); setWaQr(null); toast.success('WhatsApp conectado'); }
          } catch { /* silencioso */ }
        }, 4000);
      } else if (dados?.status === 'CONECTADO') {
        setWaQr(null);
        toast.success('WhatsApp conectado');
      }
    } catch (err) {
      const e = err as { response?: { data?: { mensagem?: string } } };
      setErroAcao({ mensagem: e.response?.data?.mensagem ?? 'Falha ao conectar o WhatsApp' });
    } finally { setWaAcao(false); }
  }, [pararPollWa]);

  const handleWaDesconectar = useCallback(async () => {
    setWaAcao(true);
    setErroAcao(null); // idem — não deixa o erro de uma tentativa anterior sobreviver
    try {
      await api.post('/equipes/whatsapp/desconectar');
      pararPollWa(); setWaQr(null); setWaStatus('DESCONECTADO');
      toast.success('WhatsApp desconectado');
    } catch (err) {
      const e = err as { response?: { data?: { mensagem?: string } } };
      setErroAcao({ mensagem: e.response?.data?.mensagem ?? 'Falha ao desconectar' });
    } finally { setWaAcao(false); }
  }, [pararPollWa]);

  /** Botão ÚNICO: conecta se está desconectado, desconecta se está conectado. */
  const handleWaToggle = useCallback(() => {
    if (waStatus === 'CONECTADO') handleWaDesconectar();
    else handleWaConectar(false);
  }, [waStatus, handleWaConectar, handleWaDesconectar]);

  // Expediente de atendimento
  const [diasAtend,  setDiasAtend]  = useState<number[]>([]);
  const [horaInicio, setHoraInicio] = useState('');
  const [horaFim,    setHoraFim]    = useState('');
  const [tempoConsultaPadrao, setTempoConsultaPadrao] = useState('');
  const [validadeOrcamento, setValidadeOrcamento] = useState('');

  const [especies,          setEspecies]          = useState<{ id: number; nome: string }[]>([]);
  const [especiesAtendidas, setEspeciesAtendidas] = useState<number[]>([]);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/equipes/configuracoes');
      if (!res.data) return; // 403 silencioso — ver services/api.ts
      const dados = res.data?.dados;
      if (dados) {
        setLogoPreview(dados.logoUrl ?? null);
        setWhatsapp(maskWhatsapp(dados.whatsapp ?? ''));
        setDiasAtend(dados.diasAtendimento
          ? String(dados.diasAtendimento).split(',').map(Number).filter((n: number) => n >= 0 && n <= 6)
          : []);
        setHoraInicio(dados.horaInicioAtendimento ?? '');
        setHoraFim(dados.horaFimAtendimento ?? '');
        setEspeciesAtendidas(Array.isArray(dados.especiesAtendidas) ? dados.especiesAtendidas : []);
        setTempoConsultaPadrao(dados.tempoConsultaPadraoMin ? String(dados.tempoConsultaPadraoMin) : '');
        setValidadeOrcamento(dados.validadeOrcamentoDias ? String(dados.validadeOrcamentoDias) : '');

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
      setErroAcao({ mensagem: 'Erro ao carregar as configurações operacionais.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  // Catálogo de espécies para os botões de seleção (mesma fonte de EquipeManager.tsx).
  useEffect(() => {
    api.get('/especies')
      .then(res => {
        const lista = res.data?.dados ?? res.data ?? [];
        setEspecies(Array.isArray(lista)
          ? lista.filter((e: { nome: string }) => ESPECIES_PERMITIDAS.includes(normalizarNome(e.nome)))
          : []);
      })
      .catch(() => setEspecies([]));
  }, []);

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => setLogoPreview(reader.result as string);
    reader.readAsDataURL(file);

    const comprimido = await comprimirImagem(file);
    setLogoFile(comprimido);
    setLogoRemovido(false);

    const reader2 = new FileReader();
    reader2.onloadend = () => setLogoPreview(reader2.result as string);
    reader2.readAsDataURL(comprimido);
  };

  const handleRemoverLogo = () => {
    setLogoPreview(null);
    setLogoFile(null);
    setLogoRemovido(true);
  };

  const salvar = useCallback(async (): Promise<boolean> => {
    setErroAcao(null);

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
        setErroAcao({ mensagem: 'O dia útil deve estar entre 1 e 10.', campos: ['diaUtil'] });
        return false;
      }
      tipoFechamento = 'DIA_UTIL';
      diaFechamentoFatura = n;
    } else {
      const n = Number(diaEspecifico);
      if (diaEspecifico.trim() === '' || !Number.isInteger(n) || n < 1 || n > 28) {
        setErroDia('Informe um dia entre 1 e 28.');
        return false;
      }
      tipoFechamento = 'DIA_FIXO';
      diaFechamentoFatura = n;
    }
    setErroDia(null);

    const whatsappDigitos = whatsapp.replace(/\D/g, '');
    if (whatsappDigitos !== '' && whatsappDigitos.length < 10) {
      setErroAcao({ mensagem: 'WhatsApp incompleto — informe DDD + número.', campos: ['whatsapp'] });
      return false;
    }

    if (especiesAtendidas.length === 0) {
      setErroAcao({ mensagem: 'Selecione ao menos uma espécie atendida.', campos: ['especies'] });
      return false;
    }

    if (diasAtend.length === 0) {
      setErroAcao({ mensagem: 'Selecione ao menos um dia de atendimento.', campos: ['dias'] });
      return false;
    }
    if (!horaInicio || !horaFim) {
      setErroAcao({
        mensagem: 'Informe o horário de abertura e de fechamento.',
        campos: [!horaInicio ? 'horaInicio' : '', !horaFim ? 'horaFim' : ''].filter(Boolean),
      });
      return false;
    }
    if (horaInicio >= horaFim) {
      setErroAcao({ mensagem: 'O horário de abertura deve ser menor que o de fechamento.', campos: ['horaInicio', 'horaFim'] });
      return false;
    }

    if (!tempoConsultaPadrao.trim()) {
      setErroAcao({ mensagem: 'Informe o tempo de consulta padrão.', campos: ['tempoConsulta'] });
      return false;
    }

    const validadeTrim = validadeOrcamento.trim();
    if (validadeTrim !== '') {
      const n = Number(validadeTrim);
      if (!Number.isInteger(n) || n < VALIDADE_ORC_MIN || n > VALIDADE_ORC_MAX) {
        setErroAcao({
          mensagem: `A validade do orçamento deve ser de ${VALIDADE_ORC_MIN} a ${VALIDADE_ORC_MAX} dias.`,
          campos: ['validadeOrcamento'],
        });
        return false;
      }
    }

    try {
      const fd = new FormData();
      fd.append('tipoFechamento', tipoFechamento);
      if (diaFechamentoFatura != null) fd.append('diaFechamentoFatura', String(diaFechamentoFatura));
      fd.append('whatsapp', whatsappDigitos);
      fd.append('especiesAtendidas', especiesAtendidas.join(','));
      fd.append('diasAtendimento', diasAtend.join(','));
      fd.append('horaInicioAtendimento', horaInicio);
      fd.append('horaFimAtendimento', horaFim);
      fd.append('tempoConsultaPadraoMin', tempoConsultaPadrao);
      fd.append('validadeOrcamentoDias', validadeTrim);
      if (logoFile) fd.append('logo', logoFile);
      if (logoRemovido) fd.append('removerLogo', 'true');

      const res = await api.put('/equipes/configuracoes', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const dados = res.data?.dados;
      if (dados) setLogoPreview(dados.logoUrl ?? null);
      setLogoFile(null);
      setLogoRemovido(false);
      window.dispatchEvent(new CustomEvent('s2vet:config-atualizada'));
      return true;
    } catch {
      setErroAcao({ mensagem: 'Erro ao salvar as configurações operacionais.' });
      return false;
    }
  }, [tipoSelecao, diaEspecifico, nDiaUtil, whatsapp, especiesAtendidas, diasAtend, horaInicio, horaFim, tempoConsultaPadrao, validadeOrcamento, logoFile, logoRemovido]);

  return {
    loading, erroAcao,

    logoPreview, handleLogoChange, handleRemoverLogo,

    tipoSelecao, setTipoSelecao,
    diaEspecifico, setDiaEspecifico,
    erroDia, setErroDia,
    nDiaUtil, setNDiaUtil,

    whatsapp, setWhatsapp,
    waStatus, waDisponivel, waQr, waAcao,
    handleWaToggle,

    diasAtend, setDiasAtend,
    horaInicio, setHoraInicio,
    horaFim, setHoraFim,
    tempoConsultaPadrao, setTempoConsultaPadrao,
    validadeOrcamento, setValidadeOrcamento,

    especies, especiesAtendidas, setEspeciesAtendidas,

    salvar,
  };
}
