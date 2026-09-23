import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConfigWildfly, InstalacaoWildfly } from '../types.ts';
import { requisitar } from '../lib/api.ts';
import type { Avisar } from '../hooks/useToasts.ts';
import { SeletorPasta } from './sankhya/SeletorPasta.tsx';

const VAZIA: ConfigWildfly = { pasta: '', arquivoLog: '', mostrarConsole: false, pastaExiste: false, logExiste: false };

/**
 * Onde fica o WildFly desta máquina.
 *
 * Estes caminhos eram valor fixo dentro dos scripts PowerShell, então trocar de
 * instalação — ou usar o hub noutro computador — exigia editar arquivo. Quem consome
 * não é o hub e sim os helpers do WildFly, que releem a configuração a cada chamada:
 * mudar aqui vale no próximo clique em Iniciar, sem reiniciar nada.
 */
export function ModalCaminhosWildfly({
  aberto,
  onFechar,
  toast,
}: {
  aberto: boolean;
  onFechar: () => void;
  toast: Avisar;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [config, setConfig] = useState<ConfigWildfly>(VAZIA);
  const [pasta, setPasta] = useState('');
  const [arquivoLog, setArquivoLog] = useState('');
  const [mostrarConsole, setMostrarConsole] = useState(false);
  const [seletor, setSeletor] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [procurando, setProcurando] = useState(false);
  const [achados, setAchados] = useState<InstalacaoWildfly[] | null>(null);

  const carregar = useCallback(async () => {
    const { ok, body } = await requisitar<ConfigWildfly>('/api/infra/wildfly');
    if (!ok) {
      toast('Não consegui ler os caminhos do WildFly.', 'err', body.error);
      return;
    }
    const atual = { ...VAZIA, ...body } as ConfigWildfly;
    setConfig(atual);
    setPasta(atual.pasta);
    setArquivoLog(atual.arquivoLog);
    setMostrarConsole(Boolean(atual.mostrarConsole));
  }, [toast]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (aberto && !dialog.open) dialog.showModal();
    if (!aberto && dialog.open) dialog.close();
  }, [aberto]);

  useEffect(() => {
    if (aberto) void carregar();
  }, [aberto, carregar]);

  const procurar = async () => {
    setProcurando(true);
    const { ok, body } = await requisitar<{ instalacoes: InstalacaoWildfly[] }>(
      '/api/infra/wildfly/detectar',
    );
    setProcurando(false);

    if (!ok) {
      toast('A varredura falhou.', 'err', body.error);
      return;
    }
    const lista = body.instalacoes ?? [];
    setAchados(lista);
    if (!lista.length) toast('Nenhuma instalação do WildFly encontrada no disco.', 'err');
  };

  const salvar = async () => {
    setSalvando(true);
    const { ok, body } = await requisitar<ConfigWildfly>('/api/infra/wildfly', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pasta: pasta.trim(), arquivoLog: arquivoLog.trim(), mostrarConsole }),
    });
    setSalvando(false);

    if (!ok) {
      toast('Não consegui salvar os caminhos.', 'err', body.error);
      return;
    }
    const atual = { ...VAZIA, ...body } as ConfigWildfly;
    setConfig(atual);
    setPasta(atual.pasta);
    setArquivoLog(atual.arquivoLog);
    toast('Caminhos salvos — já valem no próximo Iniciar.');
  };

  return (
    <dialog className="modal modal-largo" ref={dialogRef} onClose={onFechar}>
      <div className="modal-head">
        <div>
          <h2>Caminhos do WildFly</h2>
          <p>Onde está a instalação desta máquina. Os helpers releem a cada chamada.</p>
        </div>
        <button className="btn tiny ghost" type="button" aria-label="Fechar" onClick={onFechar}>
          ✕
        </button>
      </div>

      <div className="modal-body">
        <div className="campo">
          <label className="campo-nome" htmlFor="wf-pasta">
            Pasta da instalação
            {config.pasta &&
              (config.pastaExiste ? (
                <span className="selo ok">encontrada</span>
              ) : (
                <span className="selo falta">não existe</span>
              ))}
          </label>
          <div className="campo-linha">
            <input
              id="wf-pasta"
              value={pasta}
              onChange={(e) => setPasta(e.target.value)}
              placeholder="C:\wildfly_producao"
              autoComplete="off"
              spellCheck={false}
            />
            <button className="btn tiny ghost" type="button" onClick={() => setSeletor(true)}>
              Procurar…
            </button>
            <button className="btn tiny ghost" type="button" disabled={procurando} onClick={() => void procurar()}>
              {procurando ? 'varrendo…' : 'Detectar'}
            </button>
          </div>
          <small className="campo-dica">
            A pasta que contém <code>bin\standalone.bat</code> — a raiz, não o <code>bin</code>.
          </small>
        </div>

        {achados && achados.length > 0 && (
          <div className="campo">
            <span className="campo-nome">Instalações encontradas no disco</span>
            {/*
              Markup próprio em vez de `.linha-pasta`: aquela classe é do seletor de
              pastas e virou uma grade de colunas fixas (ícone, nome, tipo), que corta
              o caminho no meio quando reaproveitada com outro conteúdo.
            */}
            <div className="instalacoes">
              {achados.map((i) => (
                <button
                  key={i.pasta}
                  type="button"
                  className={`instalacao${i.pasta === pasta ? ' escolhida' : ''}`}
                  onClick={() => {
                    setPasta(i.pasta);
                    setArquivoLog(i.arquivoLog);
                  }}
                >
                  <code>{i.pasta}</code>
                  {i.arquivoLog ? (
                    <span className="selo ok">com log</span>
                  ) : (
                    <span className="selo falta">sem log</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="campo">
          <label className="campo-nome" htmlFor="wf-log">
            Arquivo do server.log
            {config.arquivoLog &&
              (config.logExiste ? (
                <span className="selo ok">encontrado</span>
              ) : (
                <span className="selo falta">não existe</span>
              ))}
          </label>
          <input
            id="wf-log"
            value={arquivoLog}
            onChange={(e) => setArquivoLog(e.target.value)}
            placeholder="deixe em branco para usar standalone\log\server.log da pasta acima"
            autoComplete="off"
            spellCheck={false}
          />
          <small className="campo-dica">
            É o que o botão <strong>Log</strong> do WildFly acompanha ao vivo.
          </small>
        </div>

        <div className="campo">
          <label className="campo-check">
            <input type="checkbox" checked={mostrarConsole} onChange={(e) => setMostrarConsole(e.target.checked)} />
            <span>Mostrar o console ao iniciar</span>
          </label>
          <small className="campo-dica">
            Desligado, o WildFly sobe sem janela. Ligue só para acompanhar um boot que falha antes de
            escrever no <code>server.log</code> — com o console aberto, fechar a janela derruba o servidor.
          </small>
        </div>
      </div>

      <div className="modal-foot">
        <p className="modal-nota">
          Vale para as ações de iniciar/parar e para o botão <strong>Log</strong>. O hub em si mede
          o WildFly pela URL, que fica na variável <code>WILDFLY_URL</code>, em{' '}
          <strong>Variáveis</strong>.
        </p>
        <div className="modal-acoes">
          <button className="btn tiny ghost" type="button" onClick={onFechar}>
            Fechar
          </button>
          <button className="btn tiny" type="button" disabled={salvando} onClick={() => void salvar()}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>

      <SeletorPasta
        aberto={seletor}
        inicial={pasta}
        onEscolher={(caminho) => {
          setPasta(caminho);
          // O log quase sempre está no lugar padrão; preencher poupa digitar de novo,
          // e quem tem log noutro lugar ainda pode corrigir o campo.
          if (!arquivoLog) setArquivoLog(`${caminho}\\standalone\\log\\server.log`);
        }}
        onFechar={() => setSeletor(false)}
      />
    </dialog>
  );
}
