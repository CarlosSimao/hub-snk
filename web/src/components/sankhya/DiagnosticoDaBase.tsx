import { useState, type FormEvent, type ReactNode } from 'react';
import type { BaseCliente, DiagnosticoBase } from '../../types.ts';
import { requisitar } from '../../lib/api.ts';

const TIPOS_BOTAO: Record<string, string> = {
  LC: 'Lançador',
  RJ: 'Rotina Java',
  SC: 'Script (JavaScript)',
  SP: 'Rotina no Banco de Dados',
};

function chaveLocal(url: string): string {
  return `sankhya-hub-diagnostico:${new URL(url).origin}`;
}

function parametrosLembrados(url: string): string {
  try {
    return localStorage.getItem(chaveLocal(url)) ?? '';
  } catch {
    return '';
  }
}

interface ErroDiagnostico {
  mensagem: string;
  orientacao: string;
}

export function DiagnosticoDaBase({ base }: { base: BaseCliente }) {
  const [aberto, setAberto] = useState(false);
  const [parametros, setParametros] = useState(() => parametrosLembrados(base.url));
  const [resultado, setResultado] = useState<DiagnosticoBase | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<ErroDiagnostico | null>(null);

  const ler = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCarregando(true);
    setErro(null);
    localStorage.setItem(chaveLocal(base.url), parametros);
    const busca = new URLSearchParams({ parametros });
    const resposta = await requisitar<DiagnosticoBase & { expirou?: boolean }>(
      `/api/clientes/${base.clienteId}/bases/${base.id}/diagnostico?${busca}`,
    );
    setCarregando(false);

    if (!resposta.ok) {
      setResultado(null);
      const mensagem = resposta.body.error ?? 'Não foi possível ler o diagnóstico da base.';
      const orientacao = resposta.status === 409
        ? resposta.body.expirou
          ? 'Faça login novamente na aba desta base e tente ler de novo.'
          : 'Abra esta base no Sankhya Hub Desktop e tente ler de novo.'
        : '';
      setErro({ mensagem, orientacao });
      return;
    }

    setResultado(resposta.body as DiagnosticoBase);
  };

  const vazio = resultado
    && resultado.modulos.length === 0
    && resultado.botoes.length === 0
    && resultado.parametros.length === 0
    && resultado.parametrosAusentes.length === 0;

  return (
    <div className="diagnostico-base">
      <button className="btn tiny ghost" type="button" onClick={() => setAberto((valor) => !valor)}>
        Diagnóstico
      </button>
      {aberto && (
        <section className="diagnostico-base-painel">
          <form className="diagnostico-base-form" onSubmit={(event) => void ler(event)}>
            <label>
              <span>Parâmetros</span>
              <input
                value={parametros}
                onChange={(event) => setParametros(event.target.value)}
                placeholder="UTILIZAWMS, CODEMPPADRAO"
                aria-label="Chaves dos parâmetros"
              />
            </label>
            <button className="btn tiny" disabled={carregando}>{carregando ? 'Lendo…' : 'Ler'}</button>
          </form>

          {erro && (
            <div className="diagnostico-base-erro" role="alert">
              <strong>{erro.mensagem}</strong>
              {erro.orientacao && <span>{erro.orientacao}</span>}
            </div>
          )}
          {!resultado && !erro && !carregando && (
            <p className="diagnostico-base-vazio">Clique em Ler para consultar a aba autenticada desta base.</p>
          )}
          {vazio && <p className="diagnostico-base-vazio">Nenhum módulo, botão ou parâmetro encontrado.</p>}

          {resultado && !vazio && (
            <div className="diagnostico-base-resultados">
              <SecaoDiagnostico titulo="Módulos" vazio={resultado.modulos.length === 0}>
                <table>
                  <thead><tr><th>Código</th><th>Resource ID</th><th>Descrição</th></tr></thead>
                  <tbody>{resultado.modulos.map((modulo) => (
                    <tr key={`${modulo.cod}:${modulo.resourceId}`}>
                      <td>{modulo.cod}</td><td><code>{modulo.resourceId}</code></td><td>{modulo.descricao}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </SecaoDiagnostico>

              <SecaoDiagnostico titulo="Botões de ação" vazio={resultado.botoes.length === 0}>
                <table>
                  <thead><tr><th>ID</th><th>Descrição</th><th>Tipo</th><th>Instância</th><th>Módulo</th><th>Classe</th></tr></thead>
                  <tbody>{resultado.botoes.map((botao) => (
                    <tr key={botao.id}>
                      <td>{botao.id}</td><td>{botao.descricao}</td>
                      <td>{TIPOS_BOTAO[botao.tipo] ?? botao.tipo}</td>
                      <td><code>{botao.instancia}</code></td><td>{botao.codModulo}</td>
                      <td><code>{botao.classe || '—'}</code></td>
                    </tr>
                  ))}</tbody>
                </table>
              </SecaoDiagnostico>

              <SecaoDiagnostico titulo="Parâmetros" vazio={resultado.parametros.length === 0}>
                <table>
                  <thead><tr><th>Chave</th><th>Descrição</th><th>Tipo</th><th>Valor</th></tr></thead>
                  <tbody>{resultado.parametros.map((parametro) => (
                    <tr key={parametro.chave}>
                      <td><code>{parametro.chave}</code></td><td>{parametro.descricao}</td>
                      <td>{parametro.tipo}</td>
                      <td>
                        <code>{parametro.valor}</code>
                        {parametro.mascarado && <small>Valor ocultado por parecer segredo.</small>}
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </SecaoDiagnostico>

              {resultado.parametrosAusentes.length > 0 && (
                <section className="diagnostico-base-secao">
                  <h4>Chaves não encontradas</h4>
                  <div className="diagnostico-base-ausentes">
                    {resultado.parametrosAusentes.map((chave) => <code key={chave}>{chave}</code>)}
                  </div>
                </section>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function SecaoDiagnostico({ titulo, vazio, children }: {
  titulo: string;
  vazio: boolean;
  children: ReactNode;
}) {
  return (
    <section className="diagnostico-base-secao">
      <h4>{titulo}</h4>
      {vazio ? <p>Nenhum item encontrado.</p> : <div className="diagnostico-base-tabela">{children}</div>}
    </section>
  );
}
