// src/modules/documentos/CamposForm.tsx
// O CAMPO a preencher de um documento — um input só, e as regras de como ele nasce.
//
// FONTE ÚNICA do desenho do campo, usada pela tela de emissão da Central
// (`pages/Documentos.tsx`) e pelo `ModalPreencher` do editor de modelos. Antes o
// input existia só dentro do modal; com a tela nova seriam duas cópias do mesmo
// controle, e a primeira correção de tipo (`date` × `time`) valeria para uma só.

import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import DateInput from '../../components/DateInput';
import { brParaISO, isoParaBR } from '../../utils/dateUtils';
import { buscarEnderecoPorCep, digitosDoCep, mascaraCep } from '../../utils/viaCep';
import type { EnderecoCep } from '../../utils/viaCep';
import type { CampoDocumento, Preenchimento } from './campos';
import { linhaVazia } from './listas';

/** Busca sem acento e sem caixa — "influenza" acha "Influenza equina". */
const normalizarTexto = (v: string): string =>
  String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
import type { ListaDocumento, OpcaoLista } from './listas';

/** Rótulos que pedem data — o campo vira `DateInput` (DD/MM/AAAA + calendário). */
const PISTA_DATA = /\bdata\b|nascimento|validade|fabrica[çc][ãa]o|vencimento/i;
/** Rótulos que pedem hora. */
const PISTA_HORA = /\bhora\b|hor[áa]rio/i;

/** Rótulo que pede CEP — é ele que dispara a busca do endereço. */
const PISTA_CEP = /\bcep\b/i;
export const ehCampoCep = (rotulo: string): boolean => PISTA_CEP.test(rotulo);

/**
 * O que o CEP preenche, por RÓTULO do campo — e SÓ nos campos que o documento pede.
 *
 * Um modelo pode ter "Endereço" e não ter "Bairro"; outro pode chamar de "Município /
 * UF" o que aqui é cidade. Por isso a decisão é por PISTA no rótulo, e não por uma
 * lista fixa de nomes: o mesmo CEP serve a modelos escritos por gente diferente.
 *
 * ⚠️ Devolve a chave já normalizada (`chaveDaLacuna`), que é como o formulário guarda
 * os valores — a mesma de `coletarCampos` no backend.
 */
export function preenchimentoPorCep(campos: CampoDocumento[], dados: EnderecoCep): Preenchimento {
  const mapa: Preenchimento = {};
  for (const campo of campos) {
    const r = campo.rotulo;
    if (ehCampoCep(r)) continue;                       // o próprio CEP já está digitado
    if (/endere|logradouro/i.test(r))      mapa[campo.chave] = dados.logradouro;
    else if (/complement/i.test(r))        mapa[campo.chave] = dados.complemento;
    else if (/bairro/i.test(r))            mapa[campo.chave] = dados.bairro;
    // "Município / UF" quer os dois numa linha; "Cidade", só a cidade.
    else if (/munic[ií]pio/i.test(r))      mapa[campo.chave] = [dados.cidade, dados.estado].filter(Boolean).join(' / ');
    else if (/cidade|localidade/i.test(r)) mapa[campo.chave] = dados.cidade;
    else if (/\bestado\b|\buf\b/i.test(r)) mapa[campo.chave] = dados.estado;
  }
  // Campo que o CEP não soube preencher não entra no mapa — apagar o que a pessoa
  // digitou porque o ViaCEP devolveu vazio seria pior do que não preencher nada.
  for (const k of Object.keys(mapa)) if (!String(mapa[k] ?? '').trim()) delete mapa[k];
  return mapa;
}

/** A COLUNA de uma lista pede data? Mesma pista dos campos soltos. */
export const ehColunaDeData = (coluna: string): boolean =>
  PISTA_DATA.test(coluna) && !coluna.includes('/');

export function tipoDoCampo(campo: CampoDocumento): 'text' | 'date' | 'time' {
  if (campo.multilinha) return 'text';
  if (PISTA_HORA.test(campo.rotulo)) return 'time';
  // Rótulo com barra pode ser DUAS datas num campo só ("Data de fabricação / Data de
  // validade", como o Anexo XI trazia até 2026-09-03) — ali um `date` mentiria sobre
  // o que cabe. Só vira `date` quando o rótulo fala de UMA data.
  if (PISTA_DATA.test(campo.rotulo) && !campo.rotulo.includes('/')) return 'date';
  return 'text';
}

/**
 * Teto do campo de texto livre (observações), pedido em 2026-09-03.
 *
 * Não é limite de banco — `blocos` é JSONB e aguentaria muito mais. É limite de
 * PAPEL: o bloco `observacoes` tem altura fixa na folha, e um texto de dez mil
 * caracteres sairia cortado na impressão sem nada avisar.
 */
export const MAX_MULTILINHA = 800;

export const AJUDA_ORIGEM: Record<CampoDocumento['origem'], string> = {
  LACUNA:     'Campo do formulário oficial',
  CADASTRO:   'Não consta no cadastro do paciente',
  OBSERVACAO: 'Texto livre — opcional',
};

/**
 * Um campo do documento.
 *
 * ⚠️ Campo em branco NUNCA bloqueia a emissão: o papel sempre teve linha para
 * preencher à mão, e travar porque falta o nº do brinco pararia o atendimento por um
 * dado que o vet talvez anote na hora. Quem avisa quantos sairão em branco é o
 * rodapé da tela; decidir é de quem assina.
 */
export default function CampoInput({
  campo, valor, ativo = false, onChange, onFocus, inputRef, onEnderecoDoCep,
}: {
  campo:     CampoDocumento;
  valor:     string;
  ativo?:    boolean;
  onChange:  (v: string) => void;
  onFocus?:  () => void;
  /** Usado pela tela de emissão para rolar até o campo destacado na folha. */
  inputRef?: (el: HTMLElement | null) => void;
  /**
   * CEP encontrado — a tela usa `preenchimentoPorCep` para espalhar nos campos de
   * endereço que o documento pede. É a mesma conveniência da tela de Proprietário:
   * digitou o CEP, o resto vem junto.
   */
  onEnderecoDoCep?: (dados: EnderecoCep) => void;
}) {
  const [buscandoCep, setBuscandoCep] = useState(false);
  const borda = ativo
    ? 'border-emerald-500 ring-2 ring-emerald-100'
    : 'border-gray-200 focus:border-emerald-500';

  return (
    <div>
      <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 mb-1">
        {campo.rotulo}
        {/* O selo diz POR QUE o campo está sendo pedido: "fora do cadastro" é um dado
            que o sistema teria, mas o cadastro daquele paciente não tem — preencher
            aqui resolve o papel de hoje, e o cadastro segue incompleto. */}
        {campo.origem === 'CADASTRO' && (
          <span title={AJUDA_ORIGEM.CADASTRO}
            className="text-[9px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full">
            fora do cadastro
          </span>
        )}
      </label>
      {campo.multilinha ? (
        <>
          <textarea
            ref={el => inputRef?.(el)}
            value={valor} rows={3}
            onChange={e => onChange(e.target.value.slice(0, MAX_MULTILINHA))}
            onFocus={onFocus}
            placeholder={AJUDA_ORIGEM[campo.origem]}
            // `maxLength` já barra a digitação; o `slice` acima cobre o COLAR, que em
            // alguns navegadores passa por cima do atributo.
            maxLength={MAX_MULTILINHA}
            className={`w-full border rounded-xl px-3 py-2 text-sm resize-none transition-colors focus:outline-none ${borda}`}
          />
          {/* O contador só aparece perto do teto: antes disso ele é ruído, e o que
              importa é avisar ANTES de a pessoa perder o que ainda ia escrever. */}
          {valor.length > MAX_MULTILINHA * 0.75 && (
            <span className={`text-[10px] ${valor.length >= MAX_MULTILINHA ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>
              {valor.length}/{MAX_MULTILINHA} caracteres
            </span>
          )}
        </>
      ) : ehCampoCep(campo.rotulo) ? (
        /* CEP: máscara e AUTOPREENCHIMENTO do endereço, como na tela de Proprietário.
           ⚠️ Busca ao completar os 8 dígitos, não no `blur`: quem digita o CEP e vai
           direto para o campo seguinte encontraria o endereço já preenchido por baixo
           do que estava escrevendo. */
        <div className="relative">
          <input
            ref={el => inputRef?.(el)}
            value={valor}
            inputMode="numeric"
            onChange={async e => {
              const v = mascaraCep(e.target.value);
              onChange(v);
              if (!onEnderecoDoCep || digitosDoCep(v).length !== 8) return;
              setBuscandoCep(true);
              const dados = await buscarEnderecoPorCep(v);
              setBuscandoCep(false);
              // Falha do serviço é SILENCIOSA: o CEP é conveniência, e os campos de
              // endereço continuam ali para digitar à mão.
              if (dados) onEnderecoDoCep(dados);
            }}
            onFocus={onFocus}
            placeholder="00000-000"
            maxLength={9}
            className={`w-full border rounded-xl px-3 py-2 text-sm transition-colors focus:outline-none ${borda}`}
          />
          {buscandoCep && (
            <span className="absolute right-3 top-2.5 text-[10px] text-gray-400">buscando…</span>
          )}
        </div>
      ) : tipoDoCampo(campo) === 'date' ? (
        /* 🔴 `DateInput`, NUNCA `<input type="date">` (§6): o nativo segue o locale do
           NAVEGADOR e o Chrome ignora o `lang` da página — em máquina em inglês o campo
           pedia MM/DD/AAAA, e "03/09" virava 9 de março num atestado.
           ⚠️ O valor GRAVADO é o texto brasileiro, porque ele vai direto para o papel:
           com o ISO do input nativo, a folha saía com "2027-08-16". A conversão fica na
           borda — o componente fala ISO, o documento fala DD/MM/AAAA. */
        <DateInput
          value={brParaISO(valor)}
          onChange={iso => onChange(isoParaBR(iso))}
          onFocus={onFocus}
          inputRef={inputRef}
          aria-label={campo.rotulo}
          className={`w-full border rounded-xl px-3 py-2 text-sm transition-colors ${borda}`}
        />
      ) : (
        <input
          ref={el => inputRef?.(el)}
          type={tipoDoCampo(campo)}
          value={valor}
          onChange={e => onChange(e.target.value)}
          onFocus={onFocus}
          placeholder={campo.origem === 'LACUNA' ? 'Deixe em branco para preencher à mão' : ''}
          className={`w-full border rounded-xl px-3 py-2 text-sm transition-colors focus:outline-none ${borda}`}
        />
      )}
    </div>
  );
}

// ─── Grupo repetível ─────────────────────────────────────────────────────────

/**
 * Uma LISTA do documento: um grupo de campos que se repete — medicamento, vacina,
 * exame, procedimento (ver ./listas.ts).
 *
 * 🔴 POR QUE ISTO NÃO É UM CAMPO COMUM: uma receita pode ter um medicamento ou
 * quatro, e isso não é propriedade do MODELO, é de cada emissão. Com lacunas, o
 * modelo teria de trazer escrito o número máximo de itens — e o quinto medicamento
 * não teria onde entrar. Aqui a pessoa acrescenta uma linha quando precisa.
 *
 * ⚠️ AS LINHAS JÁ CHEGAM PREENCHIDAS quando o grupo tem origem clínica: são os itens
 * que o paciente REALMENTE tem no S2Vet (a última prescrição, as vacinas aplicadas,
 * os exames pedidos), sugeridos pelo backend. O vet confere, corrige e acrescenta —
 * não redigita o que o sistema já sabe. Sem dado registrado, abre uma linha em
 * branco: nunca um exemplo plausível.
 */
export function ListaCamposInput({
  lista, linhas, onChange, onCriarOpcao,
}: {
  lista:    ListaDocumento;
  linhas:   string[][];
  onChange: (linhas: string[][]) => void;
  /**
   * Cadastra no catálogo da empresa o item que a pessoa digitou e não existe — o
   * MESMO gesto da tela de Vacina ("Cadastrar X como nova vacina"), que cria de
   * verdade (`POST /medicamentos/garantir`) e passa a valer para todo o sistema.
   *
   * Ausente = a coluna aceita texto livre mas não cadastra nada; é o caso do editor,
   * onde não há paciente e o backend não teria a espécie para vincular.
   */
  onCriarOpcao?: (nome: string) => Promise<OpcaoLista | null>;
}) {
  // Sempre ao menos uma linha na tela: um grupo sem nenhuma some da vista e a pessoa
  // fica sem onde clicar para começar.
  const visiveis = linhas.length > 0 ? linhas : [linhaVazia(lista.colunas)];
  const opcoes = lista.opcoes ?? [];

  // COMBOBOX da primeira coluna, por LINHA: `aberto` é o índice da linha cujo
  // dropdown está na tela (uma de cada vez), e `busca` é o texto digitado nela.
  const [aberto, setAberto] = useState<number | null>(null);
  const [busca, setBusca] = useState('');
  const [criando, setCriando] = useState(false);

  // 🔴 O DROPDOWN VAI PARA UM PORTAL, fora da tabela (corrigido em 2026-09-04).
  // Ele era `absolute` dentro da célula e a lista abria RECORTADA "dentro do card":
  // os dois contêineres acima da tabela criam contexto de recorte
  // (`overflow-hidden` na moldura e `overflow-x-auto` no rolamento horizontal das
  // sete colunas), e recorte de overflow vence z-index — não existe `z-*` que
  // resolva. Sair para `document.body` com `position: fixed` é o mesmo remédio já
  // usado no seletor da tela de Faturamento.
  // ⚠️ Preço do portal: a lista deixa de acompanhar o campo sozinha. Daí as duas
  // coisas abaixo — remedir a cada scroll/resize e fechar no clique fora (ela não é
  // mais descendente do input, então nenhum `blur` a alcança).
  const [caixa, setCaixa] = useState<{ topo: number; esquerda: number; largura: number; altura: number } | null>(null);
  const inputsRef = useRef<Record<number, HTMLInputElement | null>>({});
  const listaRef  = useRef<HTMLDivElement>(null);

  const medir = (i: number) => {
    const el = inputsRef.current[i];
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Abre para CIMA quando não sobra espaço embaixo — na última linha da tabela a
    // lista nasceria fora da janela e a pessoa não veria opção nenhuma.
    const abaixo = window.innerHeight - r.bottom - 8;
    const acima  = r.top - 8;
    const paraCima = abaixo < 180 && acima > abaixo;
    const altura = Math.max(120, Math.min(224, paraCima ? acima : abaixo));
    setCaixa({
      topo:     paraCima ? r.top - 4 - altura : r.bottom + 4,
      esquerda: r.left,
      largura:  r.width,
      altura,
    });
  };

  const abrirEm = (i: number) => { setAberto(i); medir(i); };

  // `true` no listener de scroll: a tabela e o modal do documento rolam por dentro,
  // e esse scroll não borbulha até `window` sem a fase de captura — sem isso a
  // lista ficaria parada no lugar enquanto o campo desce.
  useEffect(() => {
    if (aberto === null) return;
    const remedir = () => medir(aberto);
    remedir();
    window.addEventListener('scroll', remedir, true);
    window.addEventListener('resize', remedir);
    return () => {
      window.removeEventListener('scroll', remedir, true);
      window.removeEventListener('resize', remedir);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  // Clique fora fecha — checa os DOIS nós (campo + lista), porque no portal a lista
  // não é mais descendente do input no DOM.
  useEffect(() => {
    if (aberto === null) return;
    const onClickFora = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (inputsRef.current[aberto]?.contains(alvo) || listaRef.current?.contains(alvo)) return;
      setAberto(null);
    };
    document.addEventListener('mousedown', onClickFora);
    return () => document.removeEventListener('mousedown', onClickFora);
  }, [aberto]);
  // Opções cadastradas AGORA — entram na lista sem esperar a tela recarregar, que é
  // o que faz a vacina recém-criada aparecer já selecionada.
  const [novas, setNovas] = useState<OpcaoLista[]>([]);
  const catalogo = [...novas, ...opcoes];

  const alterar = (i: number, j: number, v: string) => {
    const copia = visiveis.map(l => [...l]);
    copia[i][j] = v;
    onChange(copia);
  };

  /**
   * Escolher no catálogo preenche a LINHA INTEIRA com o que a clínica já sabe do item
   * (fabricante, partida, validade) — o resto continua editável.
   *
   * ⚠️ Só escreve na coluna que a opção conhece E que está VAZIA: quem já digitou a
   * partida do frasco que tem na mão não pode ver o valor trocado pelo do lote FEFO
   * ao escolher o nome da vacina.
   * ⚠️ Casa pelo NOME da coluna, nunca pelo índice — o modelo pode reordenar as
   * colunas, e por índice a validade cairia na coluna do fabricante.
   */
  const escolherOpcao = (i: number, valor: string, extras: OpcaoLista[] = []) => {
    const opcao = [...extras, ...catalogo].find(o => o.rotulo === valor);
    const copia = visiveis.map(l => [...l]);
    copia[i][0] = valor;
    if (opcao) {
      lista.colunas.forEach((col, j) => {
        if (j === 0) return;
        const doCatalogo = opcao.valores[col];
        if (doCatalogo && !String(copia[i][j] ?? '').trim()) copia[i][j] = doCatalogo;
      });
    }
    onChange(copia);
  };

  /**
   * Cadastra o que foi digitado e já o escolhe na linha.
   *
   * ⚠️ O "Cadastrar" só aparece SEM correspondência exata — o mesmo critério da tela
   * de Vacina, e é ele que evita convidar a criar a duplicata de uma vacina que já
   * está na lista, só porque o texto ainda não bate por inteiro.
   */
  const criarEEscolher = async (i: number, nome: string) => {
    if (!onCriarOpcao) return;
    setCriando(true);
    const nova = await onCriarOpcao(nome.trim());
    setCriando(false);
    if (!nova) return;                       // falhou: o texto digitado continua lá
    setNovas(prev => [nova, ...prev.filter(o => o.rotulo !== nova.rotulo)]);
    escolherOpcao(i, nova.rotulo, [nova]);
    setAberto(null);
    setBusca('');
  };

  /** Filtro do dropdown — sem acento e sem caixa, como o resto do sistema. */
  const filtradas = (termo: string): OpcaoLista[] => {
    const t = normalizarTexto(termo);
    if (!t) return catalogo;
    return catalogo.filter(o => normalizarTexto(o.rotulo).includes(t));
  };

  /** "Cadastrar" só sem correspondência EXATA — ver `criarEEscolher`. */
  const podeCriar = (termo: string): boolean => {
    const t = termo.trim();
    return t !== '' && !catalogo.some(o => o.rotulo.toLowerCase() === t.toLowerCase());
  };

  const remover = (i: number) => {
    const restante = visiveis.filter((_, k) => k !== i);
    onChange(restante.length > 0 ? restante : [linhaVazia(lista.colunas)]);
  };

  return (
    <div className="sm:col-span-2 lg:col-span-3">
      <div className="flex items-center gap-2 mb-1.5">
        <label className="text-xs font-medium text-gray-600">{lista.rotulo}</label>
        {/* Diz de ONDE veio o que já está preenchido. Sem isso, a linha que apareceu
            sozinha parece um dado inventado pelo sistema. */}
        {lista.fonteDados && lista.sugestao.length > 0 && (
          <span className="text-[9px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full">
            do cadastro do paciente
          </span>
        )}
      </div>

      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                {lista.colunas.map(col => (
                  <th key={col} className="text-left text-[11px] font-semibold text-gray-500 px-2 py-1.5 whitespace-nowrap">
                    {col}
                  </th>
                ))}
                <th className="w-9" />
              </tr>
            </thead>
            <tbody>
              {visiveis.map((linha, i) => (
                <tr key={i} className="border-t border-gray-100">
                  {lista.colunas.map((col, j) => (
                    <td key={col} className="p-1">
                      {/* PRIMEIRA coluna com catálogo = seletor. As demais seguem
                          texto livre, inclusive as que o catálogo preencheu — o
                          frasco na mão pode ter outra partida que a do estoque. */}
                      {j === 0 && (opcoes.length > 0 || onCriarOpcao) ? (
                        /* COMBOBOX do catálogo: digita para filtrar e, não existindo,
                           CADASTRA — o mesmo gesto da tela de Vacina. Um `<select>`
                           puro deixava a vacina que a empresa ainda não tem fora do
                           alcance de quem está emitindo o atestado dela. */
                        <div className="min-w-[14rem]">
                          <input
                            ref={el => { inputsRef.current[i] = el; }}
                            value={aberto === i ? busca : (linha[0] ?? '')}
                            onChange={e => { setBusca(e.target.value); abrirEm(i); alterar(i, 0, e.target.value); }}
                            onFocus={e => { abrirEm(i); setBusca(linha[0] ?? ''); e.target.select(); }}
                            // `focus` não dispara de novo num campo já focado, e a
                            // opção é escolhida em `mousedown` — sem o `onClick` a
                            // lista não reabriria depois da primeira escolha
                            // (armadilha do combo da Agenda, §12).
                            onClick={() => abrirEm(i)}
                            placeholder={`Selecione ou digite`}
                            className="w-full border border-transparent hover:border-gray-200 focus:border-emerald-500 rounded-lg px-2 py-1.5 text-sm transition-colors focus:outline-none"
                          />
                        </div>
                      ) : ehColunaDeData(col) ? (
                        /* Mesma regra do campo solto (§6): DD/MM/AAAA sempre, e o
                           valor gravado é o texto que sai no papel.
                           ⚠️ `compacto`: a mensagem de erro abaixo do campo empurraria
                           a linha inteira da tabela e desalinharia as outras seis
                           colunas — aqui ela vai no `title`, com o campo em vermelho. */
                        <DateInput
                          value={brParaISO(linha[j] ?? '')}
                          onChange={iso => alterar(i, j, isoParaBR(iso))}
                          compacto
                          aria-label={`${col} ${i + 1}`}
                          className="w-full min-w-[8rem] border border-transparent hover:border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                        />
                      ) : (
                        <input
                          value={linha[j] ?? ''}
                          onChange={e => alterar(i, j, e.target.value.slice(0, MAX_MULTILINHA))}
                          // MESMO teto do campo de observação: desde 2026-09-03 a
                          // observação da vacina é uma célula desta tabela, e o backend
                          // corta em 800 — passar disso sumiria no silêncio.
                          maxLength={MAX_MULTILINHA}
                          className="w-full min-w-[7rem] border border-transparent hover:border-gray-200 focus:border-emerald-500 rounded-lg px-2 py-1.5 text-sm transition-colors focus:outline-none"
                        />
                      )}
                    </td>
                  ))}
                  <td className="p-1 align-middle">
                    {/* Vermelho e sempre visível: remover linha é ação do registro, e
                        cinza é reservado ao indisponível (§6). */}
                    <button
                      type="button"
                      onClick={() => remover(i)}
                      title="Remover esta linha"
                      aria-label={`Remover ${lista.rotulo} ${i + 1}`}
                      className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button
          type="button"
          onClick={() => onChange([...visiveis, linhaVazia(lista.colunas)])}
          className="w-full flex items-center justify-center gap-1.5 py-2 border-t border-gray-100 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors"
        >
          <Plus size={13} /> Adicionar {lista.rotulo.toLowerCase()}
        </button>
      </div>

      {/* Lista do combobox — UMA só, fora da tabela, ancorada por `caixa` na linha
          aberta (`aberto` é o índice, e só uma abre por vez). No portal ela escapa
          do recorte dos contêineres de overflow e passa por cima do modal do
          documento — daí o `z-[80]`, acima do `z-[70]` de `ModalPreencher`. */}
      {aberto !== null && caixa && createPortal(
        <div
          ref={listaRef}
          style={{
            position:  'fixed',
            top:       caixa.topo,
            left:      caixa.esquerda,
            width:     caixa.largura,
            maxHeight: caixa.altura,
          }}
          className="z-[80] overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-lg"
        >
          {filtradas(busca).slice(0, 60).map(o => (
            <button
              key={o.rotulo}
              type="button"
              // `mousedown` + `preventDefault`: o foco nunca sai do campo, então
              // escolher no catálogo não fecha a lista por blur antes do clique
              // registrar (mesmo motivo do combo da Agenda).
              onMouseDown={e => { e.preventDefault(); escolherOpcao(aberto, o.rotulo); setAberto(null); setBusca(''); }}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-emerald-50"
            >
              {o.rotulo}
            </button>
          ))}
          {onCriarOpcao && podeCriar(busca) && (
            <button
              type="button"
              disabled={criando}
              onMouseDown={e => { e.preventDefault(); void criarEEscolher(aberto, busca); }}
              className="w-full flex items-center gap-1.5 px-3 py-2 text-left text-sm font-semibold text-emerald-700 border-t border-gray-100 hover:bg-emerald-50 disabled:opacity-50"
            >
              <Plus size={13} />
              {criando ? 'Cadastrando…' : `Cadastrar “${busca.trim()}”`}
            </button>
          )}
          {filtradas(busca).length === 0 && !(onCriarOpcao && podeCriar(busca)) && (
            <p className="px-3 py-2 text-xs text-gray-400">Nenhum item encontrado.</p>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
