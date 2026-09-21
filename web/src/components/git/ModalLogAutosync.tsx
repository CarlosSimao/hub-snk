import { useEffect, useRef } from 'react';

/**
 * O `autosync.log` (`~/.git-autosync/autosync.log`) inteiro, texto simples, uma linha por
 * evento de cada rodada agendada — não é o `git log` de nenhum repositório.
 */
export function ModalLogAutosync({
  aberto,
  linhas,
  carregando,
  onCarregar,
  onFechar,
}: {
  aberto: boolean;
  linhas: string[] | null;
  carregando: boolean;
  onCarregar: (limite?: number) => Promise<void>;
  onFechar: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (aberto && !dialog.open) dialog.showModal();
    if (!aberto && dialog.open) dialog.close();
  }, [aberto]);

  useEffect(() => {
    if (aberto) void onCarregar();
  }, [aberto, onCarregar]);

  return (
    <dialog className="modal modal-largo" ref={dialogRef} onClose={onFechar}>
      <div className="modal-head">
        <div>
          <h2>Log do git-autosync</h2>
          <p>
            Últimas linhas de <code>~/.git-autosync/autosync.log</code>.
          </p>
        </div>
        <button className="btn tiny ghost" type="button" aria-label="Fechar" onClick={onFechar}>
          ✕
        </button>
      </div>

      <div className="modal-body">
        {carregando ? (
          <p className="detail-empty">Carregando…</p>
        ) : !linhas || linhas.length === 0 ? (
          <p className="detail-empty">Sem linhas registradas ainda.</p>
        ) : (
          <pre className="git-log-autosync">{linhas.join('\n')}</pre>
        )}
      </div>

      <div className="modal-foot">
        <div className="modal-acoes">
          <button className="btn tiny ghost" type="button" disabled={carregando} onClick={() => void onCarregar()}>
            Atualizar
          </button>
          <button className="btn tiny ghost" type="button" onClick={onFechar}>
            Fechar
          </button>
        </div>
      </div>
    </dialog>
  );
}
