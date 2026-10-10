import toast from 'react-hot-toast';

/**
 * Aviso de sucesso que some sozinho em 3 s OU ao ser clicado.
 * Usado na confirmação de gravação da evolução (salva · alterada · finalizada).
 */
export function toastClicavel(mensagem: string, duracaoMs = 3000) {
  toast.success(t => (
    <span
      role="button"
      tabIndex={0}
      title="Clique para fechar"
      className="cursor-pointer"
      onClick={() => toast.dismiss(t.id)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') toast.dismiss(t.id); }}
    >
      {mensagem}
    </span>
  ), { duration: duracaoMs });
}
