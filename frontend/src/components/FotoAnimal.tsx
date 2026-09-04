// frontend/src/components/FotoAnimal.tsx
//
// Foto do paciente — PONTO ÚNICO de duas coisas:
//
// 1. O que aparece quando NÃO há foto cadastrada: o ícone do cavalo (🐴), o mesmo
//    que titula "Detalhamento do Animal".
// 2. PARA ONDE a foto leva: com `animalId`, ela vira um link para
//    `/animal/:id` — a tela de Detalhamento do Animal (pedido de 2026-08-29:
//    "sempre que clicar na foto do paciente deverá levar para o Detalhamento").
//
// POR QUE EXISTE: cada tela resolvia o vazio à sua maneira — 🐴 numa, 🐾 noutra, a
// LETRA INICIAL no Faturamento e na Execução de Prescrição, e (pior) uma foto de banco
// de imagens (`picsum.photos`) no card do animal, no Dashboard e no exame nutricional:
// o sistema exibia o cavalo de outra pessoa como se fosse o do cliente.
//
// USO: o componente rende só o MIOLO da caixa — a moldura (tamanho, `rounded`, `bg`,
// `overflow-hidden`) continua sendo de quem chama, então trocar o avatar de uma tela
// não mexe no layout dela.

import { Link } from 'react-router-dom';

/** Ícone exibido quando o paciente não tem foto. */
export const ICONE_SEM_FOTO = '🐴';

export default function FotoAnimal({
  url, nome, className = 'w-full h-full', iconSize = 20, imgClassName = '', animalId,
}: {
  url?: string | null;
  nome?: string | null;
  /** Classes da caixa — o padrão preenche a moldura de quem chama. */
  className?: string;
  /** Tamanho do ícone em px (vira `font-size`). */
  iconSize?: number;
  /** Extra só para a <img> (ex.: `grayscale` de paciente pendente). */
  imgClassName?: string;
  /**
   * Id do paciente. Presente = a foto vira link para `/animal/:id`.
   * Ausente = imagem inerte — é o caso de quem JÁ está no Detalhamento (link para a
   * própria tela), de quem escolhe o paciente num seletor (ali o clique SELECIONA)
   * e do cabeçalho de modal em execução (sair dali abandona a aplicação em curso).
   */
  animalId?: number | string | null;
}) {
  const semFotoTitle = nome ? `${nome} — sem foto cadastrada` : 'Sem foto cadastrada';

  // Sem link: a caixa É a própria <img>/<div>, e recebe o `className` de quem chama.
  if (animalId == null) {
    if (url) {
      return (
        <img src={url} alt={nome ?? 'Foto do paciente'}
          className={`${className} object-cover ${imgClassName}`.trim()} />
      );
    }
    return (
      <div className={`${className} flex items-center justify-center bg-gray-100 select-none`}
        title={semFotoTitle}>
        <span style={{ fontSize: iconSize, lineHeight: 1 }}>{ICONE_SEM_FOTO}</span>
      </div>
    );
  }

  // Com link: o `className` (tamanho/raio/flex) passa para o <a> e o miolo preenche
  // 100% dele — senão a foto sairia da moldura em quem dimensiona pelo `className`
  // (Faturamento, Execução de Prescrição, Painel Principal). `overflow-hidden` fica
  // aqui porque agora é ESTE elemento que tem o raio.
  const miolo = url
    ? <img src={url} alt={nome ?? 'Foto do paciente'}
        className={`w-full h-full object-cover ${imgClassName}`.trim()} />
    : <div className="w-full h-full flex items-center justify-center bg-gray-100 select-none">
        <span style={{ fontSize: iconSize, lineHeight: 1 }}>{ICONE_SEM_FOTO}</span>
      </div>;

  const rotulo = nome ? `Ver detalhamento de ${nome}` : 'Ver detalhamento do animal';

  return (
    // ⚠️ `stopPropagation`: a foto quase sempre mora dentro de uma linha/card que já
    // tem `onClick` próprio (abrir modal, selecionar item, ir para outro módulo).
    // Sem isto, um clique dispararia as DUAS ações e o destino viraria loteria.
    <Link
      to={`/animal/${animalId}`}
      onClick={(e) => e.stopPropagation()}
      title={url ? rotulo : `${rotulo} (${semFotoTitle})`}
      aria-label={rotulo}
      className={`${className} block overflow-hidden hover:opacity-90 transition-opacity
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500`}
    >
      {miolo}
    </Link>
  );
}
