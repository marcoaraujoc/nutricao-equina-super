// frontend/src/components/SeletorPrestadorExecutante.tsx
//
// 🔴 "QUEM EXECUTOU" — o campo que liga um serviço ao PAGAMENTO AO PRESTADOR.
//
// É ele que decide se a clínica passa a dever a um terceiro: escolhido o prestador,
// a conclusão do serviço grava o ledger do recibo E abre/alimenta a conta a pagar do
// mês dele (tela de Pagamentos). Em branco, o serviço é da própria equipe e nada é
// devido a ninguém — por isso "Não informar" é a opção padrão e NUNCA é obrigatório.
//
// Nasceu dentro do modal de Execução de Prescrição (procedimento) e foi extraído
// quando o EXAME passou a gerar pagamento do mesmo jeito (2026-09-22). Duas cópias
// divergiriam na primeira correção — e a metade que mais importa aqui é o AVISO de
// prestador sem forma de pagamento, que é o que evita o recibo sair zerado sem
// ninguém entender por quê.
//
// ⚠️ `prestadores` é OPCIONAL de propósito: a tela de execução já busca a lista UMA
// vez para a prescrição inteira e a passa pronta a cada item — sem isso seriam N
// requisições iguais, uma por linha do plantão. Quem tem um campo só omite e deixa o
// componente buscar.

import { useEffect, useState } from 'react';
import api from '../services/api';

/** Prestador oferecido no seletor (GET /procedimentos/cadastro/prestadores). */
export interface PrestadorExecutante {
  id:             number;
  nome:           string;
  tipoServico:    string | null;
  tipoPagamento:  string | null;
  formaPagamento: string | null;
  valorPagamento: number | null;
}

export default function SeletorPrestadorExecutante({
  valor, onChange, prestadores, rotulo = 'Prestador que executou',
  desabilitado = false, className = '',
}: {
  valor:        number | '';
  onChange:     (v: number | '') => void;
  /** Lista já carregada pelo chamador; omitida, o componente busca a sua. */
  prestadores?: PrestadorExecutante[];
  rotulo?:      string;
  desabilitado?: boolean;
  className?:   string;
}) {
  const [proprios, setProprios] = useState<PrestadorExecutante[]>([]);
  const externa = prestadores !== undefined;

  useEffect(() => {
    if (externa) return;
    api.get('/procedimentos/cadastro/prestadores')
      // GET 403 resolve com `data: null` (interceptor): sem o guard, estoura
      // TypeError em quem não tem acesso ao cadastro.
      .then(res => setProprios(res.data?.dados ?? []))
      .catch(() => { /* sem lista, o campo fica só com "Não informar" */ });
  }, [externa]);

  const lista = prestadores ?? proprios;
  const escolhido = lista.find(p => p.id === Number(valor));

  return (
    <div className={className}>
      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
        {rotulo}
      </label>
      <select
        value={valor}
        disabled={desabilitado}
        onChange={e => onChange(e.target.value ? Number(e.target.value) : '')}
        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white text-gray-700 focus:outline-none focus:border-emerald-500 disabled:bg-gray-50 disabled:text-gray-400">
        <option value="">Não informar</option>
        {lista.map(pr => (
          <option key={pr.id} value={pr.id}>
            {pr.nome}{pr.tipoServico ? ` · ${pr.tipoServico}` : ''}
          </option>
        ))}
      </select>
      {/* Sem forma de pagamento cadastrada não há comissão a apurar. Dizer isso AQUI
          é o que evita a dívida aparecer zerada em Pagamentos sem explicação — ela
          NASCE do mesmo jeito (decisão de 2026-09-18: pendência visível vence
          silêncio), e é justamente por nascer que o aviso precisa existir. */}
      {!!valor && escolhido && !escolhido.tipoPagamento && (
        <p className="text-[10px] text-amber-600 mt-1">
          Este prestador não tem forma de pagamento cadastrada — o serviço é registrado
          e entra em Pagamentos, mas sem valor até alguém informá-lo.
        </p>
      )}
    </div>
  );
}
