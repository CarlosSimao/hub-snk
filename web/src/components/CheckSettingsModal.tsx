import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { CheckSnapshot } from '../types.ts';
import { enviar, rotaCheck } from '../lib/api.ts';
import type { Avisar } from '../hooks/useToasts.ts';

interface Props {
  aberto: boolean;
  check: CheckSnapshot | undefined;
  onFechar: () => void;
  toast: Avisar;
}

/** Intervalo, timeout e habilitar/desabilitar de UM check. */
export function CheckSettingsModal({ aberto, check, onFechar, toast }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (aberto && !dialog.open) dialog.showModal();
    if (!aberto && dialog.open) dialog.close();
  }, [aberto]);

  return (
    <dialog className="modal" ref={dialogRef} onClose={onFechar}>
      {check && (
        <Formulario key={`${check.serviceId}:${check.checkId}`} check={check} toast={toast} />
      )}
    </dialog>
  );
}

function Formulario({ check, toast }: { check: CheckSnapshot; toast: Avisar }) {
  // Semeado na abertura e atualizado pela resposta do POST: o rótulo muda na hora, sem
  // esperar o `snapshot` novo chegar pelo SSE.
  const [desabilitado, setDesabilitado] = useState(check.disabled);
  const [alternando, setAlternando] = useState(false);

  const alternar = async () => {
    const enabled = desabilitado; // estava desabilitado -> este clique habilita
    setAlternando(true);
    try {
      const { ok, body } = await enviar<{ check: CheckSnapshot }>(
        rotaCheck(check.serviceId, check.checkId, 'enabled'),
        { enabled },
      );
      if (!ok) {
        toast(body.error ?? 'Não consegui alterar o check', 'err');
        return;
      }
      setDesabilitado(Boolean(body.check?.disabled));
    } catch (err) {
      toast(`Falha ao alterar o check: ${(err as Error).message}`, 'err');
    } finally {
      setAlternando(false);
    }
  };

  const salvar = async (intervalSeconds: number, timeoutSeconds: number) => {
    try {
      const { ok, body } = await enviar(rotaCheck(check.serviceId, check.checkId, 'settings'), {
        intervalSeconds,
        timeoutSeconds,
      });
      if (!ok) {
        toast(body.error ?? 'Não consegui salvar as configurações', 'err');
        return;
      }
      toast('Configurações salvas — o check já roda com os valores novos.', 'ok');
    } catch (err) {
      toast(`Falha ao salvar: ${(err as Error).message}`, 'err');
    }
  };

  const aoSubmeter = (event: FormEvent<HTMLFormElement>) => {
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.value !== 'save') return;

    const dados = new FormData(event.currentTarget);
    void salvar(Number(dados.get('intervalSeconds')), Number(dados.get('timeoutSeconds')));
  };

  return (
    <form method="dialog" onSubmit={aoSubmeter}>
      <header className="modal-head">
        <div>
          <h2>Configurações — {check.name}</h2>
          <p>Intervalo, timeout e monitoramento deste check</p>
        </div>
        <button className="btn tiny ghost" value="cancel" aria-label="Fechar">
          ✕
        </button>
      </header>

      <div className="modal-body">
        <label className="campo">
          <span className="campo-nome">Intervalo entre execuções (segundos)</span>
          <input
            type="number"
            name="intervalSeconds"
            defaultValue={Math.round(check.intervalMs / 1000)}
            min={2}
            step={1}
            required
          />
        </label>
        <label className="campo">
          <span className="campo-nome">Timeout (segundos)</span>
          <input
            type="number"
            name="timeoutSeconds"
            defaultValue={Math.round(check.timeoutMs / 1000)}
            min={1}
            max={120}
            step={1}
            required
          />
        </label>
      </div>

      <footer className="modal-foot">
        <div className="modal-acoes">
          <button
            className="btn tiny ghost"
            type="button"
            disabled={alternando}
            title={
              desabilitado
                ? 'Reativar o monitoramento deste check'
                : 'Pausar o monitoramento deste check — ele para de rodar'
            }
            onClick={() => void alternar()}
          >
            {desabilitado ? '▶ Habilitar' : '⏸ Desabilitar'}
          </button>
          <span className="modal-acoes-spacer" />
          <button className="btn tiny ghost" value="cancel" type="submit">
            Cancelar
          </button>
          <button className="btn tiny" value="save" type="submit">
            Salvar
          </button>
        </div>
      </footer>
    </form>
  );
}
