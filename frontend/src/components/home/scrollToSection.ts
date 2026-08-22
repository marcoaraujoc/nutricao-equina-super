// components/home/scrollToSection.ts
//
// A aplicação usa HashRouter (rotas em "/#/caminho"), então uma âncora comum
// (`href="#recursos"`) tentaria navegar para a rota "/recursos" em vez de
// rolar até a seção com esse id na própria página. Este helper substitui o
// comportamento padrão do link por uma rolagem suave até o elemento.
export function scrollToSection(id: string) {
  return (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };
}
