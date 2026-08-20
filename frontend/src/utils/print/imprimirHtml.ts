// frontend/src/utils/print/imprimirHtml.ts
// Dispara a impressão nativa do navegador para um HTML completo (<!DOCTYPE
// html>…</html>), via iframe oculto. Usado por TODOS os utilitários de
// impressão da aplicação — não duplicar o gatilho de impressão num novo
// utilitário.

export function imprimirHtml(html: string): void {
  const iframe = document.createElement('iframe');
  Object.assign(iframe.style, {
    position: 'fixed', top: '-9999px', left: '-9999px',
    width: '794px', height: '0px', border: 'none', visibility: 'hidden',
  });
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open(); doc.write(html); doc.close();

  // O cabeçalho/rodapé padrão de impressão do navegador usa a URL da ABA
  // (não a da iframe impressa) — oculta a rota (ex.: #/dieta/91) da barra de
  // endereço só durante a impressão. replaceState não dispara hashchange,
  // então o HashRouter não navega nem re-renderiza.
  const urlOriginal = window.location.href;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);

  setTimeout(() => {
    iframe.contentWindow!.focus();
    iframe.contentWindow!.print();
    setTimeout(() => {
      window.history.replaceState(null, '', urlOriginal);
      document.body.removeChild(iframe);
    }, 1000);
  }, 500);
}
