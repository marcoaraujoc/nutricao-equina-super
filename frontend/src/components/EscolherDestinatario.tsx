// frontend/src/components/EscolherDestinatario.tsx
//
// PARA QUEM vai o documento (2026-10-09) — Evolução, Prescrição, Exames e
// Encaminhamento perguntam, antes de enviar por WhatsApp ou e-mail:
//   · Proprietário do paciente
//   · Equipe veterinária (todos os veterinários com contato naquele canal)
//   · Um veterinário da equipe
//   · Um prestador
// Os contatos vêm de `GET /documentos/destinatarios` — do cadastro DESTA empresa
// (backend/src/lib/destinatariosEnvio.js), nunca do `users`.
//
// Uso em fluxo próprio (Prescrição, Exames):
//   const { escolher, modalDestinatario } = useEscolhaDestinatario();
//   const dest = await escolher({ canal, animalId });
//   if (!dest) return;                    // cancelou
//   await enviarPdfWhatsAppComAviso(opts, dest.contatos);
//   ...e renderize {modalDestinatario} na tela.
//
// ⚠️ Pessoa sem contato NAQUELE canal aparece DESABILITADA, com o motivo — sumir com
// ela faria parecer que o cadastro não existe.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Mail, MessageCircle, Send, X } from 'lucide-react';
import api from '../services/api';

export type CanalDestino = 'whatsapp' | 'email';
type TipoDestino = 'PROPRIETARIO' | 'EQUIPE' | 'VETERINARIO' | 'PRESTADOR';

interface Contato { id: number; nome: string; telefone: string | null; email: string | null }
interface Destinatarios {
  proprietario: Contato | null;
  veterinarios: Contato[];
  prestadores:  Contato[];
}

export interface DestinoEscolhido {
  /** Um contato (telefone/e-mail) ou vários (equipe). */
  contatos: string | string[];
  /** Para quem foi — vai no resultado ("Enviado a Dra. Ana"). */
  rotulo:   string;
}

export interface PedidoEscolha {
  canal:        CanalDestino;
  animalId?:    number | null;
  /** Prestador já ligado ao registro (encaminhamento) — nasce selecionado. */
  prestadorId?: number | null;
}

// Cache curto por paciente: abrir o modal duas vezes seguidas não deve buscar de novo,
// mas um cadastro corrigido precisa aparecer sem recarregar a página.
const CACHE_MS = 60_000;
const cache = new Map<string, { em: number; dados: Destinatarios }>();

async function carregarDestinatarios(animalId?: number | null): Promise<Destinatarios> {
  const chave = String(animalId ?? '');
  const c = cache.get(chave);
  if (c && Date.now() - c.em < CACHE_MS) return c.dados;
  const r = await api.get('/documentos/destinatarios', { params: animalId ? { animalId } : {} });
  const dados: Destinatarios = r.data?.dados ?? { proprietario: null, veterinarios: [], prestadores: [] };
  cache.set(chave, { em: Date.now(), dados });
  return dados;
}

const contatoDe = (c: Contato | null | undefined, canal: CanalDestino) =>
  (canal === 'whatsapp' ? c?.telefone : c?.email) ?? null;

function ModalDestinatario({
  pedido, onEscolher, onCancelar,
}: {
  pedido: PedidoEscolha;
  onEscolher: (d: DestinoEscolhido) => void;
  onCancelar: () => void;
}) {
  const { canal } = pedido;
  const [dados, setDados] = useState<Destinatarios | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tipo, setTipo] = useState<TipoDestino>(pedido.prestadorId ? 'PRESTADOR' : 'PROPRIETARIO');
  const [vetId, setVetId] = useState<number | ''>('');
  const [prestadorId, setPrestadorId] = useState<number | ''>(pedido.prestadorId ?? '');

  useEffect(() => {
    let vivo = true;
    carregarDestinatarios(pedido.animalId)
      .then(d => { if (vivo) setDados(d); })
      .catch(() => { if (vivo) setErro('Não foi possível carregar os destinatários.'); });
    return () => { vivo = false; };
  }, [pedido.animalId]);

  const nomeCanal = canal === 'whatsapp' ? 'WhatsApp' : 'e-mail';
  const semContato = canal === 'whatsapp' ? 'sem telefone cadastrado' : 'sem e-mail cadastrado';

  const vetsComContato = (dados?.veterinarios ?? []).filter(v => contatoDe(v, canal));
  const prop = dados?.proprietario ?? null;
  const vetSel = dados?.veterinarios.find(v => v.id === vetId) ?? null;
  const prestSel = dados?.prestadores.find(p => p.id === prestadorId) ?? null;

  const destino = (): DestinoEscolhido | null => {
    if (tipo === 'PROPRIETARIO') {
      const c = contatoDe(prop, canal);
      return c ? { contatos: c, rotulo: prop!.nome } : null;
    }
    if (tipo === 'EQUIPE') {
      const lista = vetsComContato.map(v => contatoDe(v, canal)!);
      return lista.length ? { contatos: lista, rotulo: `equipe veterinária (${lista.length})` } : null;
    }
    if (tipo === 'VETERINARIO') {
      const c = contatoDe(vetSel, canal);
      return c ? { contatos: c, rotulo: vetSel!.nome } : null;
    }
    const c = contatoDe(prestSel, canal);
    return c ? { contatos: c, rotulo: prestSel!.nome } : null;
  };
  const escolhido = dados ? destino() : null;

  const Opcao = ({ valor, titulo, detalhe, desabilitada, children }: {
    valor: TipoDestino; titulo: string; detalhe?: string; desabilitada?: boolean; children?: React.ReactNode;
  }) => (
    <label className={`block rounded-xl border px-3 py-2.5 transition-colors ${
      tipo === valor ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 hover:bg-gray-50'
    } ${desabilitada ? 'opacity-60' : 'cursor-pointer'}`}>
      <div className="flex items-start gap-2.5">
        <input type="radio" name="destino" className="mt-1 accent-emerald-600"
          checked={tipo === valor} disabled={desabilitada}
          onChange={() => setTipo(valor)} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-800">{titulo}</p>
          {detalhe && <p className="text-xs text-gray-500 truncate">{detalhe}</p>}
          {tipo === valor && children}
        </div>
      </div>
    </label>
  );

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 rounded-t-2xl">
          <h3 className="text-base font-bold text-gray-800 flex items-center gap-2">
            {canal === 'whatsapp'
              ? <MessageCircle size={18} className="text-green-600" />
              : <Mail size={18} className="text-blue-600" />}
            Enviar por {nomeCanal} para…
          </h3>
          <button onClick={onCancelar} className="text-gray-400 hover:text-gray-600" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-2 max-h-[65vh] overflow-y-auto">
          {!dados && !erro && (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-6 justify-center">
              <Loader2 size={16} className="animate-spin" /> Carregando destinatários…
            </div>
          )}
          {erro && <p className="text-sm text-red-600">{erro}</p>}
          {dados && (
            <>
              <Opcao valor="PROPRIETARIO" titulo="Proprietário"
                detalhe={prop ? `${prop.nome} · ${contatoDe(prop, canal) ?? semContato}` : 'paciente sem proprietário'}
                desabilitada={!contatoDe(prop, canal)} />
              <Opcao valor="EQUIPE" titulo="Equipe veterinária"
                detalhe={vetsComContato.length
                  ? `${vetsComContato.length} veterinário(s) com ${nomeCanal}`
                  : `nenhum veterinário com ${nomeCanal} cadastrado`}
                desabilitada={vetsComContato.length === 0} />
              <Opcao valor="VETERINARIO" titulo="Veterinário da equipe"
                detalhe={dados.veterinarios.length ? undefined : 'nenhum veterinário na equipe'}
                desabilitada={dados.veterinarios.length === 0}>
                <select value={vetId} onChange={e => setVetId(e.target.value ? Number(e.target.value) : '')}
                  className="mt-2 w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                  <option value="">Selecione…</option>
                  {dados.veterinarios.map(v => (
                    <option key={v.id} value={v.id} disabled={!contatoDe(v, canal)}>
                      {v.nome}{contatoDe(v, canal) ? '' : ` — ${semContato}`}
                    </option>
                  ))}
                </select>
              </Opcao>
              <Opcao valor="PRESTADOR" titulo="Prestador"
                detalhe={dados.prestadores.length ? undefined : 'nenhum prestador cadastrado'}
                desabilitada={dados.prestadores.length === 0}>
                <select value={prestadorId} onChange={e => setPrestadorId(e.target.value ? Number(e.target.value) : '')}
                  className="mt-2 w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                  <option value="">Selecione…</option>
                  {dados.prestadores.map(p => (
                    <option key={p.id} value={p.id} disabled={!contatoDe(p, canal)}>
                      {p.nome}{contatoDe(p, canal) ? '' : ` — ${semContato}`}
                    </option>
                  ))}
                </select>
              </Opcao>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 pb-5 pt-3 border-t border-gray-100">
          <button onClick={onCancelar}
            className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">
            Cancelar
          </button>
          <button onClick={() => escolhido && onEscolher(escolhido)} disabled={!escolhido}
            className={`px-5 py-2 rounded-xl text-sm font-semibold text-white flex items-center gap-1.5 disabled:bg-gray-300 disabled:cursor-not-allowed ${
              canal === 'whatsapp' ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}>
            <Send size={14} /> Enviar
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Pergunta o destinatário e devolve a escolha (ou `null` se a pessoa cancelou).
 * Renderize `modalDestinatario` na tela que usa o hook.
 */
export function useEscolhaDestinatario() {
  const [pedido, setPedido] = useState<PedidoEscolha | null>(null);
  const resolver = useRef<((d: DestinoEscolhido | null) => void) | null>(null);

  const escolher = useCallback((p: PedidoEscolha) => new Promise<DestinoEscolhido | null>(resolve => {
    resolver.current?.(null);          // pedido anterior pendente: cancela
    resolver.current = resolve;
    setPedido(p);
  }), []);

  const fechar = (d: DestinoEscolhido | null) => {
    resolver.current?.(d);
    resolver.current = null;
    setPedido(null);
  };

  const modalDestinatario = pedido
    ? <ModalDestinatario pedido={pedido} onEscolher={d => fechar(d)} onCancelar={() => fechar(null)} />
    : null;

  return { escolher, modalDestinatario };
}
