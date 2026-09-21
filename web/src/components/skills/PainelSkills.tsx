/**
 * Aba Skills: executa uma skill do Claude Code numa pasta de repositório e conversa com
 * ela aqui dentro.
 *
 * A skill não vive no hub — quem a executa é o `claude` instalado na máquina, e por isso
 * a lista mostra de qual plugin e de qual versão cada uma veio. Atualizar o plugin
 * atualiza a skill, sem nada a sincronizar deste lado.
 *
 * O que a skill executa (arquivo escrito, comando rodado) aparece na conversa como uma
 * linha própria. É a contrapartida da política escolhida: nada pede confirmação, então
 * tudo fica registrado à vista.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RepoCadastrado } from '../../types.ts';
import { requisitar } from '../../lib/api.ts';
import type { Avisar } from '../../hooks/useToasts.ts';
import { modeloSalvo, useSkills, type ItemConversa } from '../../hooks/useSkills.ts';

const MODELOS = [
  { valor: '', rotulo: 'padrão do Claude Code' },
  { valor: 'opus', rotulo: 'Opus (mais capaz)' },
  { valor: 'sonnet', rotulo: 'Sonnet (equilíbrio)' },
  { valor: 'haiku', rotulo: 'Haiku (mais barato)' },
];

export interface AberturaSkill {
  skill: string;
  pasta: string;
}

export function PainelSkills({ toast, abertura }: { toast: Avisar; abertura?: AberturaSkill | undefined }) {
  const { skills, sessao, conversa, ocupado, rodando, iniciar, responder, encerrar } = useSkills(toast);
  const [skill, setSkill] = useState('');
  const [pasta, setPasta] = useState('');
  const [modelo, setModelo] = useState(modeloSalvo);
  const [mensagem, setMensagem] = useState('');
  const [repos, setRepos] = useState<RepoCadastrado[]>([]);
  const fim = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void requisitar<{ repos: RepoCadastrado[] }>('/api/repos-cadastrados').then(({ ok, body }) => {
      if (ok) setRepos(body.repos ?? []);
    });
  }, []);

  // Atalho vindo do cartão do cliente: chega com a skill e a pasta já escolhidas.
  useEffect(() => {
    if (!abertura) return;
    setSkill(abertura.skill);
    setPasta(abertura.pasta);
  }, [abertura]);

  useEffect(() => {
    fim.current?.scrollIntoView({ block: 'end' });
  }, [conversa.length]);

  const escolhida = useMemo(() => skills.find((item) => item.id === skill), [skills, skill]);

  const podeIniciar = Boolean(skill && pasta) && !ocupado && !sessao?.viva;

  function começar(): void {
    void iniciar({
      skill,
      pasta,
      modelo,
      // A skill é invocada como comando: é assim que a CLI a resolve pelo nome.
      mensagem: mensagem.trim() || `/${skill}`,
    });
    setMensagem('');
  }

  function enviarResposta(): void {
    const texto = mensagem.trim();
    if (!texto) return;
    void responder(texto);
    setMensagem('');
  }

  return (
    <section className="painel-skills">
      <div className="skills-config card">
        <label className="campo">
          <span className="campo-nome">Skill</span>
          <select value={skill} disabled={Boolean(sessao?.viva)} onChange={(e) => setSkill(e.target.value)}>
            <option value="">Escolha uma skill…</option>
            {skills.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id}
                {item.versao ? ` — ${item.plugin} ${item.versao}` : ' — sua'}
              </option>
            ))}
          </select>
        </label>

        <label className="campo">
          <span className="campo-nome">Pasta de trabalho</span>
          <input
            list="skills-repos"
            value={pasta}
            disabled={Boolean(sessao?.viva)}
            placeholder="caminho do repositório"
            onChange={(e) => setPasta(e.target.value)}
          />
          <datalist id="skills-repos">
            {repos.map((repo) => (
              <option key={repo.id} value={repo.caminhoLocal}>
                {repo.clienteNome} — {repo.nome || repo.caminhoLocal}
              </option>
            ))}
          </datalist>
        </label>

        <label className="campo">
          <span className="campo-nome">Modelo</span>
          <select value={modelo} disabled={Boolean(sessao?.viva)} onChange={(e) => setModelo(e.target.value)}>
            {MODELOS.map((item) => (
              <option key={item.valor} value={item.valor}>
                {item.rotulo}
              </option>
            ))}
          </select>
        </label>

        <div className="skills-acoes">
          <button className="btn" disabled={!podeIniciar} onClick={começar}>
            {ocupado && !sessao ? 'Iniciando…' : 'Executar skill'}
          </button>
          {sessao?.viva && (
            <button className="btn tiny ghost danger" onClick={() => void encerrar()}>
              Encerrar sessão
            </button>
          )}
        </div>
      </div>

      {escolhida && !sessao && <p className="painel-nota">{escolhida.descricao}</p>}

      {sessao && (
        <div className="skills-sessao">
          <div className="skills-sessao-topo">
            <span>
              <strong>{sessao.skill}</strong> em <code>{sessao.pasta}</code>
            </span>
            <span className="skills-custo">
              {sessao.modelo || 'modelo padrão'} · US$ {sessao.custoUsd.toFixed(4)}
              {sessao.viva ? '' : ' · encerrada'}
            </span>
          </div>

          <div className="skills-conversa">
            {conversa.map((item) => (
              <Linha key={`${item.seq}-${item.tipo}-${indice(item)}`} item={item} />
            ))}
            {rodando && <p className="skills-rodando">A skill está trabalhando…</p>}
            <div ref={fim} />
          </div>
        </div>
      )}

      {sessao?.viva && (
        <div className="skills-entrada card">
          <textarea
            rows={3}
            value={mensagem}
            placeholder="Responda à skill — Ctrl+Enter envia"
            onChange={(e) => setMensagem(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) enviarResposta();
            }}
          />
          <button className="btn" disabled={ocupado || !mensagem.trim()} onClick={enviarResposta}>
            Enviar
          </button>
        </div>
      )}

      {!sessao && (
        <p className="painel-nota">
          A skill roda pelo <code>claude</code> instalado nesta máquina, com a pasta escolhida como
          diretório de trabalho. Ela escreve arquivos e executa comandos sem pedir confirmação — tudo
          o que fizer aparece aqui na conversa.
        </p>
      )}
    </section>
  );
}

/** Duas partes do mesmo evento podem compartilhar `seq`; isto separa as chaves. */
function indice(item: ItemConversa): string {
  if (item.tipo === 'ferramenta') return item.nome;
  if (item.tipo === 'fim') return 'fim';
  return item.texto.slice(0, 12);
}

function Linha({ item }: { item: ItemConversa }) {
  if (item.tipo === 'ferramenta') {
    return (
      <p className="skills-ferramenta">
        <span className="skills-ferramenta-nome">{item.nome}</span>
        <code>{item.detalhe}</code>
      </p>
    );
  }

  if (item.tipo === 'fim') {
    return (
      <p className={`skills-fim ${item.erro ? 'erro' : ''}`}>
        {item.erro ? 'Turno terminou com erro' : 'Turno concluído'} · {item.turnos} passo(s) · US${' '}
        {item.custoUsd.toFixed(4)}
      </p>
    );
  }

  return <div className={`skills-balao ${item.tipo}`}>{item.texto}</div>;
}
