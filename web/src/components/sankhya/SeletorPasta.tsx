import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ListagemPastas, PastaDoDisco } from '../../types.ts';
import { requisitar } from '../../lib/api.ts';

const VAZIA: ListagemPastas = { atual: '', pai: '', git: false, pastas: [] };

interface Props {
  aberto: boolean;
  /** Ponto de partida da navegação; vazio começa nas unidades do computador. */
  inicial: string;
  onEscolher: (caminho: string) => void;
  onFechar: () => void;
}

/** Navegador de pastas do Windows. O disco só é lido pelo helper nativo. */
export function SeletorPasta({ aberto, inicial, onEscolher, onFechar }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [nivel, setNivel] = useState<ListagemPastas>(VAZIA);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [selecionada, setSelecionada] = useState<PastaDoDisco | null>(null);
  const homeRef = useRef(extrairHome(inicial));

  const navegar = useCallback(async (caminho: string) => {
    setCarregando(true);
    setSelecionada(null);
    const busca = new URLSearchParams({ caminho });
    const { ok, body } = await requisitar<ListagemPastas>(`/api/sistema/pastas?${busca}`);

    if (ok) {
      homeRef.current = extrairHome(body.atual ?? '') || homeRef.current;
      setNivel({
        atual: body.atual ?? '',
        pai: body.pai ?? '',
        git: Boolean(body.git),
        // PowerShell serializa lista unitária como objeto.
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
    if (aberto) {
      homeRef.current = extrairHome(inicial) || homeRef.current;
      void navegar(inicial);
    }
  }, [aberto, inicial, navegar]);

  const caminhoEscolhido = selecionada?.caminho ?? nivel.atual;
  const atalhos = montarAtalhos(homeRef.current);

  const navegarLista = (event: KeyboardEvent<HTMLDivElement>) => {
    const alvo = event.target as HTMLElement;
    const linhas = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.linha-pasta')];
    const indice = linhas.indexOf(alvo.closest('.linha-pasta') as HTMLButtonElement);

    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && linhas.length) {
      event.preventDefault();
      const passo = event.key === 'ArrowDown' ? 1 : -1;
      linhas[(Math.max(indice, 0) + passo + linhas.length) % linhas.length]?.focus();
    }
    if (event.key === 'Backspace' && nivel.atual) {
      event.preventDefault();
      void navegar(nivel.pai);
    }
  };

  return (
    <dialog className="modal modal-largo sem-form seletor-pasta" ref={dialogRef} onClose={onFechar}>
      <div className="modal-head">
        <div>
          <h2>Escolher pasta</h2>
          <p>Selecione uma pasta ou navegue pelo computador.</p>
        </div>
        <button className="btn tiny ghost" type="button" aria-label="Fechar" onClick={onFechar}>✕</button>
      </div>

      <div className="modal-body">
        {erro && <div className="warning"><span>⚠</span><span>{erro}</span></div>}

        <nav className="pasta-breadcrumb" aria-label="Caminho atual">
          <button type="button" title="Unidades do computador" onClick={() => void navegar('')}>Computador</button>
          {montarBreadcrumb(nivel.atual).map((parte) => (
            <span key={parte.caminho}>
              <i aria-hidden="true">›</i>
              <button type="button" onClick={() => void navegar(parte.caminho)}>{parte.rotulo}</button>
            </span>
          ))}
        </nav>

        <div className="seletor-pasta-corpo">
          <aside className="atalhos-pasta" aria-label="Locais comuns">
            {atalhos.map((atalho) => (
              <button
                type="button"
                key={atalho.caminho || 'unidades'}
                className={mesmoDiretorio(atalho.caminho, nivel.atual) ? 'active' : ''}
                onClick={() => void navegar(atalho.caminho)}
              >
                <span aria-hidden="true">{atalho.icone}</span>{atalho.rotulo}
              </button>
            ))}
          </aside>

          <section className="navegador-pastas">
            <div className="navegador-pastas-head"><span>Nome</span><span>Tipo</span></div>
            {carregando && <p className="detail-empty">Carregando…</p>}
            {!carregando && !nivel.pastas.length && <p className="detail-empty">Nenhuma subpasta aqui.</p>}
            {!carregando && nivel.pastas.length > 0 && (
              <div className="lista-pastas" role="listbox" onKeyDown={navegarLista}>
                {nivel.pastas.map((pasta) => (
                  <button
                    key={pasta.caminho}
                    type="button"
                    role="option"
                    aria-selected={selecionada?.caminho === pasta.caminho}
                    className="linha-pasta"
                    onClick={() => setSelecionada(pasta)}
                    onDoubleClick={() => void navegar(pasta.caminho)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void navegar(pasta.caminho);
                      }
                    }}
                  >
                    <span className="pasta-icone" aria-hidden="true">▰</span>
                    <span className="linha-titulo">{pasta.nome}</span>
                    <span className="pasta-tipo">{pasta.git ? 'Repositório Git' : 'Pasta'}</span>
                    {pasta.git && <span className="selo ok">git</span>}
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <div className="modal-foot">
        <p className="modal-nota seletor-pasta-escolha">
          <strong>{caminhoEscolhido || 'Nenhuma pasta selecionada'}</strong>
          <span>Duplo clique ou Enter abre uma pasta. Backspace volta ao nível anterior.</span>
        </p>
        <div className="modal-acoes">
          <button className="btn tiny ghost" type="button" onClick={onFechar}>Cancelar</button>
          <button
            className="btn tiny"
            type="button"
            disabled={!caminhoEscolhido}
            onClick={() => {
              onEscolher(caminhoEscolhido);
              onFechar();
            }}
          >
            Selecionar pasta
          </button>
        </div>
      </div>
    </dialog>
  );
}

function mesmoDiretorio(a: string, b: string): boolean {
  const normalizar = (valor: string) => valor.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  return normalizar(a) === normalizar(b);
}

function montarBreadcrumb(caminho: string): { rotulo: string; caminho: string }[] {
  const normalizado = caminho.replace(/\//g, '\\').replace(/\\+$/, '');
  const partes = normalizado.split('\\').filter(Boolean);
  if (!partes.length) return [];

  let acumulado = partes[0]?.endsWith(':') ? `${partes[0]}\\` : partes[0] ?? '';
  return partes.map((rotulo, indice) => {
    if (indice > 0) acumulado = `${acumulado.replace(/\\+$/, '')}\\${rotulo}`;
    return { rotulo, caminho: acumulado };
  });
}

function extrairHome(caminho: string): string {
  return caminho.replace(/\//g, '\\').match(/^([A-Za-z]:\\Users\\[^\\]+)/i)?.[1] ?? '';
}

function montarAtalhos(home: string): { rotulo: string; caminho: string; icone: string }[] {
  const unidades = { rotulo: 'Este computador', caminho: '', icone: '▣' };
  if (!home) return [unidades];
  return [
    unidades,
    { rotulo: 'Pasta pessoal', caminho: home, icone: '●' },
    { rotulo: 'Documentos', caminho: `${home}\\Documents`, icone: '▤' },
    { rotulo: 'Projetos', caminho: `${home}\\Documents\\Projetos`, icone: '◆' },
    { rotulo: 'Demandas', caminho: `${home}\\Documents\\Demandas`, icone: '◇' },
  ];
}
