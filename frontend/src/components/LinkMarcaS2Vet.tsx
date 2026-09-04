// src/components/LinkMarcaS2Vet.tsx
//
// A marca do produto nas telas PÚBLICAS (site institucional e login), envolvida
// pelo link que SEMPRE volta ao site principal — a rota "/" (pedido de 2026-08-29).
//
// POR QUE UM COMPONENTE, e não um <Link> escrito em cada tela: são três lugares
// (Nav e Footer da Home, cabeçalho do Login) e o comportamento tem uma sutileza —
// estando JÁ em "/", navegar para "/" não move nada (o React Router não recarrega a
// mesma rota), e o clique pareceria morto. Nesse caso o link rola suavemente até o
// topo, que é o "voltar ao início" que a pessoa espera ali.
//
// ⚠️ NÃO usar dentro do app logado: o `AppHeader` já tem o seu próprio
// <Link to="/"> em volta do BrandS2Vet, e ali "/" é o Dashboard interno — envolver
// de novo produziria <a> dentro de <a>, que é HTML inválido.

import { Link, useLocation } from 'react-router-dom';
import BrandS2Vet from './BrandS2Vet';

export default function LinkMarcaS2Vet({
  size = 'md', className = '',
}: {
  size?: 'sm' | 'md';
  className?: string;
}) {
  const { pathname } = useLocation();

  const aoClicar = (e: React.MouseEvent) => {
    // Só intercepta quando o destino é a página em que já se está — em qualquer
    // outra rota pública (login, cadastro, reset) o clique navega de verdade.
    if (pathname !== '/') return;
    e.preventDefault();
    // `#topo` é o hero da Home; sem ele (ou fora dela), o topo da janela.
    const topo = document.getElementById('topo');
    if (topo) topo.scrollIntoView({ behavior: 'smooth' });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <Link
      to="/"
      onClick={aoClicar}
      aria-label="S2Vet — ir para a página inicial"
      title="Ir para a página inicial"
      className={`flex items-center ${className}`.trim()}
    >
      <BrandS2Vet size={size} />
    </Link>
  );
}
