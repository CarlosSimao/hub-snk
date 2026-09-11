import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { EnvVarStatus, ServiceSnapshot } from '../types.ts';
import { enviar, requisitar, rotaServico } from '../lib/api.ts';
import type { Avisar } from '../hooks/useToasts.ts';

interface Props {
  serviceId: string | null;
  service: ServiceSnapshot | undefined;
  onFechar: () => void;
  toast: Avisar;
}

/**
 * Formulário de variáveis do projeto.
 *
 * Os campos vêm pré-preenchidos com o valor atual, buscado num GET dedicado
 * (`/api/services/:id/env`) só disparado ao abrir o modal — o snapshot geral
 * (`/api/state`, SSE) nunca carrega valor, só nome e se está definida.
 */
export function ConfigModal({ serviceId, service, onFechar, toast }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (serviceId && !dialog.open) dialog.showModal();
    if (!serviceId && dialog.open) dialog.close();
  }, [serviceId]);

  useEffect(() => {
    if (!serviceId) return;

    let cancelado = false;
    setValores({});
    setCarregando(true);

    void (async () => {
      try {
        const { ok, body } = await requisitar<{ valores: Record<string, string> }>(
          rotaServico(serviceId, 'env'),
        );
        if (!ok) throw new Error(body.error || 'falha ao carregar valores');
        if (!cancelado) setValores(body.valores ?? {});
      } catch (err) {
        toast(`Não consegui carregar os valores atuais: ${(err as Error).message}`, 'err');
      } finally {
        if (!cancelado) setCarregando(false);
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [serviceId, toast]);

  const salvar = async (entradas: Record<string, string>) => {
    if (!serviceId) return;

    if (!Object.keys(entradas).length) {
      toast('Nenhum campo preenchido — nada foi alterado.', 'ok');
      return;
    }

    try {
      const { ok, body } = await enviar<{ envVars: EnvVarStatus[] }>(
        rotaServico(serviceId, 'env'),
        entradas,
      );
      if (!ok) {
        toast(body.error ?? 'Não consegui salvar as variáveis', 'err');
        return;
      }

      const restantes = (body.envVars ?? []).filter((v) => !v.fromVault).length;
      toast(
        restantes
          ? `Salvo. Ainda faltam ${restantes} variável(is).`
          : 'Salvo. Os checks já estão medindo com os valores novos.',
        'ok',
      );
      // O engine recarregou no servidor e o SSE manda um `snapshot` novo — a tela se
      // atualiza sozinha, sem precisar recarregar a página.
    } catch (err) {
      toast(`Falha ao salvar: ${(err as Error).message}`, 'err');
    }
  };

  const aoSubmeter = (event: FormEvent<HTMLFormElement>) => {
    // `method="dialog"` fecha o modal sozinho; só o botão "save" tem trabalho a fazer.
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.value !== 'save') return;

    // Campo vazio não vai no corpo: mandar "" APAGARIA o valor guardado, e branco aqui
    // significa "não mexi neste".
    const entradas: Record<string, string> = {};
    for (const [nome, valor] of new FormData(event.currentTarget).entries()) {
      if (typeof valor === 'string' && valor !== '') entradas[nome] = valor;
    }
    void salvar(entradas);
  };

  const envVars = service?.envVars ?? [];
  const faltando = envVars.filter((v) => !v.fromVault).length;
  const subtitulo = carregando
    ? 'Carregando valores atuais…'
    : faltando
      ? `${faltando} de ${envVars.length} variáveis ainda sem valor`
      : `${envVars.length} variáveis, todas preenchidas`;

  return (
    // <dialog> nativo: foco preso, Esc fecha e fundo inerte sem uma linha de JS.
    <dialog className="modal" ref={dialogRef} onClose={onFechar}>
      <form method="dialog" onSubmit={aoSubmeter}>
        <header className="modal-head">
          <div>
            <h2>Configurar {service?.name ?? ''}</h2>
            <p>{subtitulo}</p>
          </div>
          <button className="btn tiny ghost" value="cancel" aria-label="Fechar">
            ✕
          </button>
        </header>

        <div className="modal-body">
          {!carregando &&
            envVars.map((v) => (
              <label className="campo" key={v.name}>
                <span className="campo-nome">
                  <code>{v.name}</code>
                  {/*
                    Só o cofre conta como preenchida: um default do YAML ou uma variável
                    do ambiente do container não passaram pelo formulário, então seguem
                    "faltando" aqui mesmo com valor atual.
                  */}
                  {v.fromVault ? (
                    <span className="selo ok">preenchida</span>
                  ) : (
                    <span className="selo falta">faltando</span>
                  )}
                </span>
                <input
                  type="text"
                  name={v.name}
                  defaultValue={valores[v.name] ?? ''}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={v.fromVault ? '' : 'informe o valor'}
                />
              </label>
            ))}
        </div>

        <footer className="modal-foot">
          <p className="modal-nota">
            Os valores ficam no volume de dados do hub e valem assim que você salvar. Campos em
            branco não alteram o que já está guardado.
          </p>
          <div className="modal-acoes">
            <button className="btn tiny ghost" value="cancel" type="submit">
              Cancelar
            </button>
            <button className="btn tiny" value="save" type="submit">
              Salvar
            </button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}
