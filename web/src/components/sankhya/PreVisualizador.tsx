import { useEffect, useRef, useState } from 'react';

/** Um arquivo da Solicitação de Serviços DS que pode ser pré-visualizado. */
export interface ArquivoPrevia {
  nome: string;
  /** URL do backend que devolve o arquivo (`/api/solicitacoes/:codigo/arquivo...`). */
  url: string;
}

type Formato = 'pdf' | 'imagem' | 'texto' | 'docx' | 'nenhum';

/** O formato sai da extensão: o ERP não informa tipo confiável nos anexos do clipe. */
export function formatoDaPrevia(nome: string): Formato {
  const ext = (/\.([a-z0-9]+)$/i.exec(nome)?.[1] ?? '').toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) return 'imagem';
  if (['txt', 'csv', 'log', 'json', 'xml', 'sql', 'md'].includes(ext)) return 'texto';
  if (ext === 'docx') return 'docx';
  return 'nenhum';
}

function comParametro(url: string, parametro: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}${parametro}`;
}

/**
 * Pré-visualização de um anexo da solicitação, sem sair da Agenda Mensal.
 *
 * PDF e imagem o próprio navegador mostra (o backend responde `inline`); texto vira
 * `<pre>`; `.docx` é desenhado aqui com o `docx-preview`, carregado só quando precisa.
 * O resto (planilha, zip, `.doc` antigo) só baixa — melhor dizer isso do que mostrar lixo.
 */
export function PreVisualizador({ arquivo, onFechar }: { arquivo: ArquivoPrevia; onFechar: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const docxRef = useRef<HTMLDivElement>(null);
  const formato = formatoDaPrevia(arquivo.nome);
  const inline = comParametro(arquivo.url, 'inline=1');
  const [texto, setTexto] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(formato === 'texto' || formato === 'docx');
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    if (formato !== 'texto' && formato !== 'docx') return;
    let vivo = true;
    void (async () => {
      try {
        const r = await fetch(inline);
        if (!r.ok) {
          const corpo = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(corpo.error ?? `HTTP ${r.status}`);
        }
        if (formato === 'texto') {
          const conteudo = await r.text();
          if (vivo) setTexto(conteudo);
        } else {
          const blob = await r.blob();
          const { renderAsync } = await import('docx-preview');
          if (vivo && docxRef.current) {
            await renderAsync(blob, docxRef.current, undefined, {
              className: 'previa-docx',
              inWrapper: true,
              ignoreLastRenderedPageBreak: true,
            });
          }
        }
      } catch (e) {
        if (vivo) setErro((e as Error).message);
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [formato, inline]);

  return (
    <dialog className="modal modal-previa" ref={dialogRef} onClose={onFechar}>
      <header className="modal-head">
        <div>
          <h2>{arquivo.nome}</h2>
          <p>Pré-visualização do anexo da Solicitação de Serviços, lido do ERP pela aba logada.</p>
        </div>
        <div className="detail-actions">
          <a className="btn tiny ghost" href={arquivo.url} download={arquivo.nome}>
            Baixar
          </a>
          <button className="btn tiny ghost" type="button" aria-label="Fechar" onClick={onFechar}>
            ✕
          </button>
        </div>
      </header>

      <div className="modal-body previa-corpo">
        {carregando && <p className="detail-empty">Carregando do ERP…</p>}
        {erro && (
          <div className="warning">
            <span>⚠</span>
            <span>Não consegui abrir o arquivo: {erro}</span>
          </div>
        )}
        {formato === 'pdf' && <iframe className="previa-quadro" src={inline} title={arquivo.nome} />}
        {formato === 'imagem' && <img className="previa-imagem" src={inline} alt={arquivo.nome} />}
        {formato === 'texto' && texto !== null && <pre className="previa-texto">{texto}</pre>}
        {formato === 'docx' && <div ref={docxRef} className="previa-docx-alvo" />}
        {formato === 'nenhum' && (
          <p className="detail-empty">
            Esse tipo de arquivo não tem pré-visualização no DS. Use Baixar para abrir no programa
            do computador.
          </p>
        )}
      </div>
    </dialog>
  );
}
