import { useState } from 'react';
import type { AbaNavegador, SistemaSankhya, StatusNavegador } from '../../types.ts';

const NOME_TELA: Record<string, string> = {
  'agenda-recursos': 'Agenda de Recursos',
};

const NOME_SISTEMA: Record<string, string> = {
  'sankhya-erp': 'Sankhya ERP',
  'sankhya-experience': 'Sankhya Experience',
};

interface Props {
  navegador: StatusNavegador;
  onAbrir: (sistema: SistemaSankhya, opcoes?: { tela?: string; navegador?: string }) => Promise<void>;
  onAtualizar: () => Promise<void>;
}

/**
 * A janela do Sankhya que o hub dirige.
 *
 * Existe porque abrir uma sessão do Sankhya em qualquer outro lugar MATA a anterior: com
 * o hub e o usuário em janelas diferentes, um sempre derruba o outro. Trabalhando nesta
 * janela, a sessão é uma só — a que você usa é a que o hub usa.
 *
 * O hub só OLHA as guias, nunca fecha nem mexe nas outras: o navegador continua seu, com
 * quantas guias você quiser.
 */
export function JanelaSankhya({ navegador, onAbrir, onAtualizar }: Props) {
  const [ocupado, setOcupado] = useState(false);
  const [marca, setMarca] = useState('');

  const comOcupado = async (fn: () => Promise<void>) => {
    setOcupado(true);
    try {
      await fn();
    } finally {
      setOcupado(false);
    }
  };

  const doSankhya = navegador.abas.filter((a) => a.sistema);
  const outras = navegador.abas.length - doSankhya.length;

  return (
    <article className="card">
      <div className="detail-head">
        <div className="card-title">
          <h2>
            Janela do Sankhya
            {navegador.aberto ? (
              <span className="selo ok">aberta</span>
            ) : (
              <span className="selo falta">fechada</span>
            )}
          </h2>
          <p>
            Trabalhe o Sankhya por aqui. Abrir sessão em outro navegador derruba esta — e a
            do hub junto.
          </p>
        </div>
        <div className="detail-actions">
          <button
            className="btn tiny ghost"
            disabled={ocupado}
            onClick={() => void comOcupado(onAtualizar)}
          >
            Atualizar
          </button>
        </div>
      </div>

      <div className="form-campos">
        {navegador.disponiveis.length > 1 && (
          <label className="campo">
            <span className="campo-nome">Navegador</span>
            <select value={marca} onChange={(e) => setMarca(e.target.value)}>
              <option value="">o primeiro que existir</option>
              {navegador.disponiveis.map((m) => (
                <option key={m} value={m}>
                  {m === 'chrome' ? 'Google Chrome' : m === 'edge' ? 'Microsoft Edge' : m}
                </option>
              ))}
            </select>
            <small className="campo-dica">
              Vale só na próxima abertura — uma janela já aberta continua onde está.
            </small>
          </label>
        )}

        <div className="actions-panel">
          {(['sankhya-erp', 'sankhya-experience'] as SistemaSankhya[]).map((sistema) => (
            <button
              key={sistema}
              className="btn tiny"
              disabled={ocupado || !navegador.navegador}
              onClick={() => void comOcupado(() => onAbrir(sistema, marca ? { navegador: marca } : {}))}
            >
              Abrir {NOME_SISTEMA[sistema]}
            </button>
          ))}

          {navegador.telas.map((tela) => (
            <button
              key={tela}
              className="btn tiny ghost"
              disabled={ocupado || !navegador.navegador}
              title="Abre direto nesta tela, sem navegar pelo menu"
              onClick={() =>
                void comOcupado(() =>
                  onAbrir('sankhya-erp', { tela, ...(marca ? { navegador: marca } : {}) }),
                )
              }
            >
              {NOME_TELA[tela] ?? tela} ↗
            </button>
          ))}
        </div>

        {navegador.aberto && (
          <div className="abas">
            <span className="campo-nome">
              Guias do Sankhya sendo observadas
              {outras > 0 && ` · ${outras} outra(s) guia(s), que o hub não toca`}
            </span>
            {doSankhya.length === 0 && (
              <p className="detail-empty">Nenhuma guia do Sankhya aberta nesta janela.</p>
            )}
            {doSankhya.map((aba) => (
              <Aba key={aba.id} aba={aba} />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function Aba({ aba }: { aba: AbaNavegador }) {
  return (
    <div className="linha-agenda">
      <span className={`selo ${aba.logado ? 'ok' : 'falta'}`}>
        {aba.logado ? 'sessão viva' : 'na tela de login'}
      </span>
      <span className="linha-titulo" title={aba.url}>
        {aba.titulo || aba.url}
      </span>
      <span className="linha-meta">{NOME_SISTEMA[aba.sistema] ?? aba.sistema}</span>
    </div>
  );
}
