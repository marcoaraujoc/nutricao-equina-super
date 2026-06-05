// frontend/src/utils/gerarPdf.ts
// Converte um HTML completo (<!DOCTYPE html>…</html>) em um Blob PDF A4.
// Renderiza via iframe oculto para garantir que todos os estilos sejam aplicados
// corretamente, depois captura com html2canvas e gera o PDF com jsPDF.

const A4_WIDTH_PX  = 794;   // px equivalente a 210 mm a 96 dpi
const A4_HEIGHT_PX = 1123;  // px equivalente a 297 mm a 96 dpi
const A4_WIDTH_MM  = 210;
const A4_HEIGHT_MM = 297;

export async function htmlParaPdfBlob(html: string): Promise<Blob> {
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
    import('jspdf'),
    import('html2canvas'),
  ]);

  return new Promise<Blob>((resolve, reject) => {
    const iframe = document.createElement('iframe');
    Object.assign(iframe.style, {
      position:   'fixed',
      top:        '-99999px',
      left:       '-99999px',
      width:      `${A4_WIDTH_PX}px`,
      height:     `${A4_HEIGHT_PX}px`,
      border:     'none',
      visibility: 'hidden',
    });
    document.body.appendChild(iframe);

    const iDoc = iframe.contentDocument ?? iframe.contentWindow?.document;
    if (!iDoc) {
      document.body.removeChild(iframe);
      reject(new Error('Não foi possível acessar o documento do iframe'));
      return;
    }

    iDoc.open();
    iDoc.write(html);
    iDoc.close();

    // Aguarda renderização completa antes de capturar
    setTimeout(async () => {
      try {
        const body = iframe.contentDocument?.body;
        if (!body) throw new Error('Body não encontrado no iframe');

        const canvas = await html2canvas(body, {
          scale:       2,
          useCORS:     true,
          logging:     false,
          width:       A4_WIDTH_PX,
          windowWidth: A4_WIDTH_PX,
          backgroundColor: '#ffffff',
        });

        const imgData  = canvas.toDataURL('image/jpeg', 0.92);
        const pdf      = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const imgH_mm  = (canvas.height / canvas.width) * A4_WIDTH_MM;

        let yMm = 0;
        while (yMm < imgH_mm) {
          if (yMm > 0) pdf.addPage();
          pdf.addImage(imgData, 'JPEG', 0, -yMm, A4_WIDTH_MM, imgH_mm);
          yMm += A4_HEIGHT_MM;
        }

        resolve(pdf.output('blob'));
      } catch (err) {
        reject(err);
      } finally {
        if (document.body.contains(iframe)) document.body.removeChild(iframe);
      }
    }, 400);
  });
}
