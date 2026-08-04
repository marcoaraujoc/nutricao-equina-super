// frontend/src/components/FotoAnimal.tsx
//
// Foto do paciente — PONTO ÚNICO do que aparece quando NÃO há foto cadastrada:
// o ícone do cavalo (🐴), o mesmo que titula "Detalhamento do Animal".
//
// POR QUE EXISTE: cada tela resolvia o vazio à sua maneira — 🐴 numa, 🐾 noutra, a
// LETRA INICIAL no Faturamento e na Execução de Prescrição, e (pior) uma foto de banco
// de imagens (`picsum.photos`) no card do animal, no Dashboard e no exame nutricional:
// o sistema exibia o cavalo de outra pessoa como se fosse o do cliente.
//
// USO: o componente rende só o MIOLO da caixa — a moldura (tamanho, `rounded`, `bg`,
// `overflow-hidden`) continua sendo de quem chama, então trocar o avatar de uma tela
// não mexe no layout dela.

/** Ícone exibido quando o paciente não tem foto. */
export const ICONE_SEM_FOTO = '🐴';

export default function FotoAnimal({
  url, nome, className = 'w-full h-full', iconSize = 20, imgClassName = '',
}: {
  url?: string | null;
  nome?: string | null;
  /** Classes da caixa — o padrão preenche a moldura de quem chama. */
  className?: string;
  /** Tamanho do ícone em px (vira `font-size`). */
  iconSize?: number;
  /** Extra só para a <img> (ex.: `grayscale` de paciente pendente). */
  imgClassName?: string;
}) {
  if (url) {
    return (
      <img src={url} alt={nome ?? 'Foto do paciente'}
        className={`${className} object-cover ${imgClassName}`.trim()} />
    );
  }
  return (
    <div className={`${className} flex items-center justify-center bg-gray-100 select-none`}
      title={nome ? `${nome} — sem foto cadastrada` : 'Sem foto cadastrada'}>
      <span style={{ fontSize: iconSize, lineHeight: 1 }}>{ICONE_SEM_FOTO}</span>
    </div>
  );
}
