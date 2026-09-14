import { useEffect, useState } from 'react';
import { plural } from '../../lib/format.ts';
import { useGitAutosync } from '../../hooks/useGitAutosync.ts';
import type { TarefaAutosync } from '../../types.ts';
import type { Avisar } from '../../hooks/useToasts.ts';
import { DetalheRepo, nomeCurto } from './DetalheRepo.tsx';

const ESTADO_ROTULO: Record<string, string> = {
  synced: 'sincronizado',
  pending_push: 'commit sem push',
  failed: 'falhou',
};

export function PainelGit({ toast }: { toast: Avisar }) {
  const {
    visao,
    erro,
    carregando,
    ocupado,
    acao,
    definirAtivo,
    definirHorarios,
    definirInstalacao,
    definirIa,
    historico,
    recarregar,
  } = useGitAutosync(toast);
  const [modo, setModo] = useState<'repos' | 'historico'>('repos');
  const [dias, setDias] = useState<number | undefined>(7);

  if (erro) return <AvisoHelperFora erro={erro} />;

  return (
    <div className="git-page">
      <header className="git-page-head">
        <div>
          <h1>Repositórios</h1>
          <p>Revise execuções, controle o agendamento e mantenha cada remoto atualizado.</p>
        </div>
        <button className="btn ghost" disabled={carregando || ocupado} onClick={() => void recarregar()}>
          Atualizar
        </button>
      </header>

      <section className="git-overview" aria-label="Resumo do Git AutoSync">
        <Resumo valor={visao.repos.length} rotulo={plural(visao.repos.length, 'repositório', 'repositórios')} />
        <Resumo valor={visao.repos.filter((repo) => repo.ativo).length} rotulo="no autosync" />
        <Resumo
          valor={visao.repos.filter((repo) => repo.estado?.state === 'pending_push').length}
          rotulo="com push pendente"
          alerta
        />
        <div className="git-agenda">
          <span>Agendamento</span>
          <strong>{visao.horarios.length ? visao.horarios.join(', ') : 'não configurado'}</strong>
          <small>{visao.ultimaExecucao ? `última rodada ${visao.ultimaExecucao}` : 'sem execução registrada'}</small>
        </div>
      </section>

      <Agendamento
        horarios={visao.horarios}
        tarefas={visao.tarefas}
        ocupado={ocupado}
        onSalvar={definirHorarios}
        onInstalacao={definirInstalacao}
      />

      <MensagemDoCommit ia={visao.ia} onDefinir={definirIa} ocupado={ocupado} />

      <div className="git-toolbar">
        <div className="git-view-switch" role="tablist" aria-label="Visão do Git">
          <button role="tab" aria-selected={modo === 'repos'} onClick={() => setModo('repos')}>
            Repositórios
          </button>
          <button role="tab" aria-selected={modo === 'historico'} onClick={() => setModo('historico')}>
            Histórico
          </button>
        </div>
        {modo === 'historico' && (
          <select value={dias ?? 0} onChange={(e) => setDias(Number(e.target.value) || undefined)}>
            <option value={2}>Hoje e ontem</option>
            <option value={7}>Últimos 7 dias</option>
            <option value={0}>Últimos 100 commits</option>
          </select>
        )}
      </div>

      {carregando ? (
        <p className="detail-empty">Carregando repositórios…</p>
      ) : visao.repos.length === 0 ? (
        <p className="detail-empty">Nenhum repositório configurado.</p>
      ) : (
        <section className={`git-repo-grid ${modo}`}>
          {visao.repos.map((repo) => (
            <article className="card git-repo-card" key={repo.path} data-git-state={estadoVisual(repo)}>
              <div className="git-repo-head">
                <div className="card-title">
                  <h2>{nomeCurto(repo.path)}</h2>
                  <p title={repo.path}>{repo.path}</p>
                  {!repo.alvoProprio && repo.alvo && <small>via pasta {repo.alvo}</small>}
                </div>
                <label className="git-autosync-toggle" title="Incluir no agendamento automático">
                  <input
                    type="checkbox"
                    checked={repo.ativo}
                    disabled={ocupado}
                    onChange={(e) => void definirAtivo(repo, e.target.checked)}
                  />
                  <span>{repo.ativo ? 'no autosync' : 'fora do autosync'}</span>
                </label>
              </div>
              <EstadoRepo repo={repo} />
            <DetalheRepo
              key={modo}
              repo={repo}
              ocupado={ocupado}
              onAcao={acao}
              carregarHistorico={historico}
              semCabecalho
              somenteHistorico={modo === 'historico'}
              ocultarHistorico={modo === 'repos'}
              historicoRecolhivel={modo === 'historico'}
              diasHistorico={modo === 'historico' ? dias : undefined}
              limiteHistorico={modo === 'historico' ? 100 : 5}
            />
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

function Resumo({ valor, rotulo, alerta = false }: { valor: number; rotulo: string; alerta?: boolean }) {
  return <div className={`git-summary${alerta && valor ? ' alert' : ''}`}><strong>{valor}</strong><span>{rotulo}</span></div>;
}

function EstadoRepo({ repo }: { repo: import('../../types.ts').RepoAutosync }) {
  const estado = repo.estado;
  const visual = estadoVisual(repo);
  return (
    <div className="git-state-row">
      <span className={`git-state ${visual}`}>
        {visual === 'unknown' ? 'nunca sincronizado' : (ESTADO_ROTULO[visual] ?? visual)}
      </span>
      <span>{!estado ? 'sem execução registrada' : estado.hadChanges ? 'alterações processadas' : 'sem alterações na última rodada'}</span>
      <span>{estado?.lastPush ? `último push ${estado.lastPush}` : 'sem push registrado'}</span>
      {estado?.message && <p title={estado.message}>{estado.message.split('\n')[0]}</p>}
    </div>
  );
}

const AGENTES = [
  { valor: 'auto', rotulo: 'o primeiro que estiver instalado' },
  { valor: 'claude', rotulo: 'Claude' },
  { valor: 'codex', rotulo: 'Codex' },
  { valor: 'opencode', rotulo: 'OpenCode' },
];

/**
 * Quem escreve a mensagem do commit automático.
 *
 * Com a geração desligada o git-autosync nem tenta: comita com o texto fixo
 * `chore: auto-commit <data hora>`. É o que enche o histórico deles.
 *
 * Ligar manda o diff das alterações para o agente escolhido, que roda nesta máquina —
 * por isso a tela diz isso em vez de apresentar a opção como um detalhe de formatação.
 */
/**
 * O agendamento do git-autosync: os horarios e a tarefa do Agendador do Windows.
 *
 * Os dois aparecem juntos porque sao coisas diferentes: os horarios vivem no
 * `config.json` e a tarefa e o que o Windows dispara. Salvar horarios ja reescreve o
 * gatilho da tarefa existente (verificado: `set-schedule` reinstala), entao o botao de
 * instalar serve para o caso de nao haver tarefa nenhuma — e para recriar uma que foi
 * removida ou desabilitada por fora.
 *
 * A lista e editada localmente e so vai para o backend no Salvar: com gravacao a cada
 * tecla, um horario meio digitado (`1`, `17`, `17:`) seria recusado a cada caractere.
 */
function Agendamento({ horarios, tarefas, ocupado, onSalvar, onInstalacao }: {
  horarios: string[];
  tarefas: TarefaAutosync[];
  ocupado: boolean;
  onSalvar: (horarios: string[]) => Promise<boolean>;
  onInstalacao: (instalar: boolean) => Promise<boolean>;
}) {
  const [rascunho, setRascunho] = useState<string[]>(horarios);
  const [aberto, setAberto] = useState(false);

  // O recarregar da visao traz os horarios gravados; sem isto o rascunho ficaria
  // mostrando o que o usuario digitou mesmo depois de o backend normalizar a lista.
  useEffect(() => setRascunho(horarios), [horarios]);

  const instalada = tarefas.length > 0;
  const valido = rascunho.every((horario) => /^([01]\d|2[0-3]):[0-5]\d$/.test(horario));
  const mudou = rascunho.join(',') !== horarios.join(',');

  const alterar = (indice: number, valor: string) =>
    setRascunho((atuais) => atuais.map((item, i) => (i === indice ? valor : item)));
  const remover = (indice: number) =>
    setRascunho((atuais) => atuais.filter((_, i) => i !== indice));

  return (
    <section className="git-agendamento">
      <header>
        <div>
          <h2>Agendamento</h2>
          <p>
            {instalada
              ? `Tarefa no Agendador do Windows: ${tarefas.map((t) => t.nome).join(', ')}.`
              : 'Nenhuma tarefa no Agendador do Windows — nada roda sozinho.'}
          </p>
        </div>
        <button className="btn tiny ghost" type="button" onClick={() => setAberto((valor) => !valor)}>
          {aberto ? 'Fechar' : 'Configurar'}
        </button>
      </header>

      {instalada && (
        <ul className="git-tarefas">
          {tarefas.map((tarefa) => (
            <li key={tarefa.nome}>
              <strong>{tarefa.nome}</strong>
              <span className={`selo-tarefa ${tarefa.estado.toLowerCase()}`}>{tarefa.estado}</span>
              <small>
                {tarefa.proximaExecucao ? `próxima ${tarefa.proximaExecucao}` : 'sem próxima execução'}
                {tarefa.ultimaExecucao ? ` · última ${tarefa.ultimaExecucao}` : ''}
                {codigoDaTarefa(tarefa.ultimoResultado)}
              </small>
            </li>
          ))}
        </ul>
      )}

      {aberto && (
        <div className="git-agendamento-editor">
          <div className="git-horarios">
            {rascunho.length === 0 && <p className="detail-empty">Sem horário. Adicione um, ou remova a tarefa para parar o automático.</p>}
            {rascunho.map((horario, indice) => (
              // A chave e o indice de proposito: sao campos de texto posicionais e dois
              // horarios iguais sao um estado valido enquanto se digita.
              <div className="git-horario" key={indice}>
                <input
                  type="time"
                  value={horario}
                  aria-label={`Horário ${indice + 1}`}
                  onChange={(event) => alterar(indice, event.target.value)}
                />
                <button className="btn tiny ghost danger" type="button" aria-label={`Remover horário ${horario}`} onClick={() => remover(indice)}>
                  Remover
                </button>
              </div>
            ))}
            <button className="btn tiny ghost" type="button" onClick={() => setRascunho((atuais) => [...atuais, '17:40'])}>
              Adicionar horário
            </button>
          </div>

          <div className="git-agendamento-acoes">
            <button
              className="btn tiny"
              type="button"
              disabled={ocupado || !mudou || !valido || rascunho.length === 0}
              onClick={() => void onSalvar(rascunho)}
            >
              Salvar horários
            </button>
            <button className="btn tiny ghost" type="button" disabled={ocupado} onClick={() => void onInstalacao(true)}>
              {instalada ? 'Reinstalar tarefa' : 'Instalar tarefa'}
            </button>
            <button
              className="btn tiny ghost danger"
              type="button"
              disabled={ocupado || !instalada}
              onClick={() => {
                if (window.confirm('Remover a tarefa do Agendador e o autostart da bandeja? O autosync para de rodar sozinho — os repositórios e horários ficam como estão.')) {
                  void onInstalacao(false);
                }
              }}
            >
              Remover tarefa
            </button>
          </div>

          {!valido && <p className="git-agendamento-aviso">Horário incompleto: use HH:MM.</p>}
          {/* O CLI nao aceita `set-schedule ""`; parar o automatico e desinstalar. */}
          {rascunho.length === 0 && (
            <p className="git-agendamento-aviso">
              O agendamento precisa de pelo menos um horário. Para parar o automático, use Remover tarefa.
            </p>
          )}
          {!instalada && rascunho.length > 0 && (
            <p className="git-agendamento-aviso">
              Os horários estão na configuração, mas sem tarefa instalada nada dispara sozinho.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * O codigo da ultima execucao, quando vale mostrar.
 *
 * Fica de fora o que nao e problema: 0 e sucesso e 267011 (0x41303) e o "a tarefa nunca
 * rodou" do Agendador. O resto sai em hexadecimal, que e como a Microsoft documenta os
 * HRESULT e como se acha o significado numa busca.
 */
function codigoDaTarefa(codigo: number | null): string {
  if (codigo === null || codigo === 0 || codigo === 267011) return '';
  const hex = (codigo >>> 0).toString(16).toUpperCase().padStart(8, '0');
  return ` · último código 0x${hex}`;
}

function MensagemDoCommit({
  ia,
  onDefinir,
  ocupado,
}: {
  ia: { ligada: boolean; agente: string };
  onDefinir: (ligada: boolean, agente: string) => Promise<void>;
  ocupado: boolean;
}) {
  return (
    <section className="git-ia">
      <div className="git-ia-texto">
        <strong>Mensagem do commit automático</strong>
        <small>
          {ia.ligada
            ? 'Gerada a partir do diff, no padrão Conventional Commits com emoji.'
            : 'Desligada — os commits saem como “chore: auto-commit” com data e hora.'}
        </small>
      </div>

      <div className="git-ia-controles">
        <label className="campo-inline">
          <input
            type="checkbox"
            checked={ia.ligada}
            disabled={ocupado}
            onChange={(e) => void onDefinir(e.target.checked, ia.agente)}
          />
          Gerar pelo diff
        </label>
        <select
          value={ia.agente}
          disabled={ocupado || !ia.ligada}
          onChange={(e) => void onDefinir(ia.ligada, e.target.value)}
        >
          {AGENTES.map((a) => (
            <option key={a.valor} value={a.valor}>
              {a.rotulo}
            </option>
          ))}
        </select>
      </div>

      {ia.ligada && (
        <p className="git-ia-nota">
          O diff das alterações é enviado ao agente escolhido, que roda nesta máquina.
        </p>
      )}
    </section>
  );
}

function estadoVisual(repo: import('../../types.ts').RepoAutosync): string {
  return repo.estado?.state ?? (repo.estado?.success === false ? 'failed' : 'unknown');
}

export function AvisoHelperFora({ erro }: { erro: string }) {
  return (
    <div className="warning">
      <span>⚠</span>
      <span>
        {erro}
        <br />O git-autosync é executado pelo <code>hub-helper.ps1</code>; suba o helper e
        recarregue a página.
      </span>
    </div>
  );
}
