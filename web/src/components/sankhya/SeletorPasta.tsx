import { useCallback, useEffect, useRef, useState } from 'react';
import type { ListagemPastas } from '../../types.ts';
import { requisitar } from '../../lib/api.ts';

const VAZIA: ListagemPastas = { atual: '', pai: '', git: false, pastas: [] };

interface Props {
  aberto: boolean;
  /** Ponto de partida da navegação; vazio começa nas unidades do computador. */
  inicial: string;
  onEscolher: (caminho: string) => void;
  onFechar: () => void;
}

/**
 * Navegador de pastas do Windows para escolher o repositório local sem digitar o
 * caminho na mão.
 *
 * Quem enxerga o disco é o `hub-helper.ps1` — o hub roda em container e não vê o
 * sistema de arquivos do usuário. Só nomes de pasta trafegam, nunca arquivos.
 */
export function SeletorPasta({ aberto, inicial, onEscolher, onFechar }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [nivel, setNivel] = useState<ListagemPastas>(VAZIA);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const navegar = useCallback(async (caminho: string) => {
    setCarregando(true);
    const busca = new URLSearchParams({ caminho });
    const { ok, body } = await requisitar<ListagemPastas>(`/api/sistema/pastas?${busca}`);

    if (ok) {
      setNivel({
        atual: body.atual ?? '',
        pai: body.pai ?? '',
        git: Boolean(body.git),
        // O PowerShell serializa lista de um item só como objeto, não como array.
        pastas: Array.isArray(body.pastas) ? body.pastas : body.pastas ? [body.pastas] : [],
      });
      setErro(null);
    } else {
      setErro(body.error ?? 'não consegui listar as pastas');
    }
    setCarregando(false);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (aberto && !dialog.open) dialog.showModal();
    if (!aberto && dialog.open) dialog.close();
  }, [aberto]);

  useEffect(() => {
    // Abrir já dentro da pasta cadastrada poupa navegar desde o C: toda vez.
    if (aberto) void navegar(inicial);
  }, [aberto, inicial, navegar]);

  return (
    <dialog className="modal modal-largo sem-form" ref={dialogRef} onClose={onFechar}>
      <div className="modal-head">
        <div>
          <h2>Escolher pasta</h2>
          <p>{nivel.atual || 'Unidades do computador'}</p>
        </div>
        <button className="btn tiny ghost" type="button" aria-label="Fechar" onClick={onFechar}>
          ✕
        </button>
      </div>

      <div className="modal-body">
        {erro && (
          <div className="warning">
            <span>⚠</span>
            <span>{erro}</span>
          </div>
        )}

        <div className="actions-panel inline">
          <button
            className="btn tiny ghost"
            type="button"
            disabled={carregando || !nivel.atual}
            onClick={() => void navegar(nivel.pai)}
          >
            ↑ Subir um nível
          </button>
          <button
            className="btn tiny ghost"
            type="button"
            disabled={carregando || !nivel.atual}
            onClick={() => void navegar('')}
          >
            Unidades
          </button>
        </div>

        {carregando && <p className="detail-empty">Carregando…</p>}

        {!carregando && !nivel.pastas.length && (
          <p className="detail-empty">Nenhuma subpasta aqui.</p>
        )}

        {!carregando && nivel.pastas.length > 0 && (
          <div className="lista-pastas">
            {nivel.pastas.map((pasta) => (
              <button
                key={pasta.caminho}
                type="button"
                className="linha-pasta"
                onClick={() => void navegar(pasta.caminho)}
              >
                <span className="linha-titulo">{pasta.nome}</span>
                {pasta.git && <span className="selo ok">git</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="modal-foot">
        <p className="modal-nota">
          Clicar numa pasta entra nela. O botão abaixo escolhe a pasta atual — a que
          aparece no topo do quadro.
        </p>
        <div className="modal-acoes">
          <button className="btn tiny ghost" type="button" onClick={onFechar}>
            Cancelar
          </button>
          <button
            className="btn tiny"
            type="button"
            disabled={!nivel.atual}
            onClick={() => {
              onEscolher(nivel.atual);
              onFechar();
            }}
          >
            Usar esta pasta
          </button>
        </div>
      </div>
    </dialog>
  );
}
