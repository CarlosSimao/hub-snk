/**
 * Executa skills do Claude Code de dentro do hub.
 *
 * A skill NAO e' copiada para ca'. Quem a executa e' o `claude` instalado na maquina, e
 * por isso `/plugin update` continua sendo o unico jeito de atualiza-la — que era o
 * requisito. O hub so' descobre o que existe, abre o processo e intermedia a conversa.
 *
 * ## O protocolo, medido antes de escrever esta classe
 *
 * `claude -p --input-format stream-json --output-format stream-json --verbose` se
 * comporta assim:
 *
 *  - cada mensagem enviada pelo stdin abre um turno, e o turno termina com um evento
 *    `result` (que traz `session_id`, numero de turnos e `total_cost_usd`);
 *  - o processo continua vivo depois do `result`: mandar outra mensagem retoma A MESMA
 *    sessao, com o contexto inteiro (medido: `session_id` identico em quatro turnos);
 *  - `AskUserQuestion` NAO aparece neste modo. Quando a skill precisa perguntar, o
 *    modelo pergunta em TEXTO e encerra o turno. Por isso a tela e' um chat comum, sem
 *    renderizacao de pergunta estruturada;
 *  - `Write`, `Edit` e execucao de shell rodam sem pedir confirmacao. A politica
 *    escolhida para o hub e' "liberado, com registro": tudo que a skill executa fica no
 *    historico da sessao, visivel na tela.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir as homedirDoUsuario, tmpdir } from 'node:os';

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { MODELOS_SKILL, type EstadoSessaoSkill, type ModeloSkill, type SkillDisponivel } from './types.ts';

export type { EstadoSessaoSkill, ModeloSkill, SkillDisponivel };

export function ehModelo(valor: string): valor is ModeloSkill {
  return (MODELOS_SKILL as readonly string[]).includes(valor);
}

/** Erro de uso: skill desconhecida, pasta invalida, sessao que nao existe. */
export class PedidoSkillError extends Error {}

const PASTA_CLAUDE = join(homedirDoUsuario(), '.claude');
const PLUGINS_INSTALADOS = join(PASTA_CLAUDE, 'plugins', 'installed_plugins.json');
const SKILLS_DO_USUARIO = join(PASTA_CLAUDE, 'skills');

/** `name:` e `description:` do frontmatter YAML, sem trazer um parser de YAML para isto. */
export function lerFrontmatter(arquivo: string): { name: string; description: string } | null {
  let texto: string;
  try {
    texto = readFileSync(arquivo, 'utf8');
  } catch {
    return null;
  }
  if (!texto.startsWith('---')) return null;

  const fim = texto.indexOf('\n---', 3);
  if (fim < 0) return null;
  const bloco = texto.slice(3, fim);

  const nome = /^name:\s*(.+)$/m.exec(bloco)?.[1]?.trim() ?? '';
  if (!nome) return null;

  // `description: >` continua nas linhas indentadas seguintes — e e' o formato que as
  // skills do plugin Sankhya usam.
  //
  // A marca de bloco e' verificada DEPOIS da captura, e nao por lookahead: com
  // `[ \t]*(?![>|])` o motor cede o espaco para satisfazer o lookahead, casa assim
  // mesmo, e toda descricao em bloco vira a string ">".
  const primeiraLinha = /^description:[ \t]*(.*)$/m.exec(bloco)?.[1]?.trim() ?? '';
  const ehBloco = /^[>|][-+]?\d*$/.test(primeiraLinha);

  let descricao = ehBloco ? '' : primeiraLinha;
  if (!descricao) {
    const dobrado = /^description:\s*[>|][-+]?\s*\n((?:[ \t]+.*\n?)+)/m.exec(bloco)?.[1] ?? '';
    descricao = dobrado
      .split('\n')
      .map((linha) => linha.trim())
      .filter(Boolean)
      .join(' ');
  }

  return { name: nome, description: descricao };
}

function skillsDaPasta(raiz: string, prefixo: string, origem: 'plugin' | 'usuario', plugin: string, versao: string): SkillDisponivel[] {
  if (!existsSync(raiz)) return [];
  let filhas: string[];
  try {
    filhas = readdirSync(raiz, { withFileTypes: true })
      .filter((entrada) => entrada.isDirectory())
      .map((entrada) => entrada.name);
  } catch {
    return [];
  }

  const achadas: SkillDisponivel[] = [];
  for (const filha of filhas) {
    const frontmatter = lerFrontmatter(join(raiz, filha, 'SKILL.md'));
    if (!frontmatter) continue;
    achadas.push({
      id: prefixo ? `${prefixo}:${frontmatter.name}` : frontmatter.name,
      nome: frontmatter.name,
      descricao: frontmatter.description,
      origem,
      plugin,
      versao,
    });
  }
  return achadas;
}

/**
 * Skills que o `claude` desta maquina enxerga.
 *
 * Lidas do `installed_plugins.json` e nao do cache inteiro: o cache guarda TODAS as
 * versoes ja' baixadas, e listar a 1.18.1 ao lado da 1.21.1 ofereceria executar uma
 * skill que a CLI nem carrega mais.
 */
export function listarSkills(): SkillDisponivel[] {
  const achadas: SkillDisponivel[] = [];

  try {
    const bruto = JSON.parse(readFileSync(PLUGINS_INSTALADOS, 'utf8')) as {
      plugins?: Record<string, { installPath?: string; version?: string }[]>;
    };
    for (const [chave, instalacoes] of Object.entries(bruto.plugins ?? {})) {
      const instalacao = instalacoes[0];
      if (!instalacao?.installPath) continue;
      // `sankhya@sankhya` — o prefixo de invocacao e' so' o nome do plugin.
      const nomePlugin = chave.split('@')[0] ?? chave;
      achadas.push(
        ...skillsDaPasta(
          join(instalacao.installPath, 'skills'),
          nomePlugin,
          'plugin',
          nomePlugin,
          instalacao.version ?? '',
        ),
      );
    }
  } catch {
    // Sem plugins instalados, ou arquivo ilegivel: sobram as skills do usuario.
  }

  achadas.push(...skillsDaPasta(SKILLS_DO_USUARIO, '', 'usuario', '', ''));

  return achadas.sort((a, b) => a.id.localeCompare(b.id));
}


/**
 * Dito a skill quando o navegador do hub esta' disponivel.
 *
 * As skills que capturam tela procuram as tools da extensao `claude-in-chrome`; este
 * texto apresenta as do hub como equivalentes, sem precisar tocar na skill — que e' o
 * que mantem ela atualizavel pelo plugin.
 */
const AVISO_NAVEGADOR = [
  'O Sankhya Hub expoe um navegador proprio por MCP, no servidor sankhya-hub-navegador.',
  'As abas dele JA ESTAO AUTENTICADAS no Sankhya ERP e na Experience: nao peca login e nao abra outro navegador.',
  'Para qualquer captura de tela ou navegacao, use mcp__sankhya-hub-navegador__* (abrir, navegar, capturar, clicar, digitar, tecla, texto_da_pagina).',
  'Elas cumprem o papel das ferramentas mcp__claude-in-chrome__*: quando uma instrucao pedir a extensao do navegador, use estas.',
  'A ferramenta capturar grava PNG no caminho absoluto que voce informar e devolve o caminho gravado.',
  'A janela dessa navegacao fica OCULTA de proposito, e a captura funciona assim mesmo.',
  'Se a pagina pedir login, chame mostrar (a janela aparece), peca ao usuario que faca o login nela, e depois chame ocultar.',
  'Nunca digite usuario ou senha voce mesmo, e nunca peca as credenciais no chat.',
].join(' ');

/** Um evento do stream, guardado como veio — a tela decide o que mostrar. */
export interface EventoSkill {
  seq: number;
  em: string;
  bruto: unknown;
}

interface Sessao extends EstadoSessaoSkill {
  processo: ChildProcess;
  eventos: EventoSkill[];
  ouvintes: Set<(evento: EventoSkill) => void>;
  parcial: string;
}

/** Quantos eventos ficam em memoria por sessao — o suficiente para a tela reconstruir. */
const LIMITE_EVENTOS = 2000;

export class Skills {
  readonly #sessoes = new Map<string, Sessao>();
  /** Escrito uma vez por processo; o caminho entra na linha de comando de cada sessao. */
  #arquivoMcp = '';

/**
   * Arquivo de configuracao do MCP do navegador, ou `null` quando nao ha shell desktop.
   *
   * A presenca do shell e' medida pelo arquivo de token do bridge: e' ele que o shell
   * escreve no boot, e sem ele o servidor MCP nao teria como se autenticar de qualquer
   * forma. O arquivo de configuracao vive numa pasta temporaria propria, criada uma vez
   * por processo do hub.
   */
  #configMcp(): { arquivo: string } | null {
    const tokenBridge = process.env['DESKTOP_BRIDGE_TOKEN_FILE'] ?? '';
    if (!tokenBridge || !existsSync(tokenBridge)) return null;

    const servidor = join(dirname(fileURLToPath(import.meta.url)), 'mcpNavegador.js');
    if (!existsSync(servidor)) return null;

    if (this.#arquivoMcp) return { arquivo: this.#arquivoMcp };

    const pasta = mkdtempSync(join(tmpdir(), 'sankhya-hub-mcp-'));
    const arquivo = join(pasta, 'navegador.json');
    writeFileSync(
      arquivo,
      JSON.stringify({
        mcpServers: {
          'sankhya-hub-navegador': {
            command: process.execPath,
            args: [servidor],
            env: {
              SANKHYA_DESKTOP_BRIDGE_URL: process.env['SANKHYA_DESKTOP_BRIDGE_URL'] ?? 'http://127.0.0.1:4103',
              DESKTOP_BRIDGE_TOKEN_FILE: tokenBridge,
            },
          },
        },
      }),
      'utf8',
    );
    this.#arquivoMcp = arquivo;
    return { arquivo };
  }

  listar(): SkillDisponivel[] {
    return listarSkills();
  }

  /**
   * Abre uma sessao e manda a primeira mensagem.
   *
   * A skill entra no texto do prompt como `/plugin:skill`, que e' como a CLI a resolve.
   * O `cwd` e' a pasta do repositorio: e' dele que a skill le os fontes e e' nele que ela
   * grava o documento.
   */
  iniciar(entrada: { skill: string; pasta: string; modelo: string; mensagem: string }): EstadoSessaoSkill {
    const skill = entrada.skill.trim();
    if (!skill) throw new PedidoSkillError('informe a skill');
    if (!this.listar().some((disponivel) => disponivel.id === skill)) {
      throw new PedidoSkillError(`skill não encontrada nesta máquina: ${skill}`);
    }

    const pasta = entrada.pasta.trim();
    let ehPasta = false;
    try {
      ehPasta = statSync(pasta).isDirectory();
    } catch {
      ehPasta = false;
    }
    if (!ehPasta) throw new PedidoSkillError(`pasta não encontrada: ${pasta || '(vazia)'}`);

    const modelo = entrada.modelo.trim();
    if (!ehModelo(modelo)) throw new PedidoSkillError(`modelo desconhecido: ${modelo}`);

    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      // Sem `--verbose` a CLI recusa stream-json na saida quando esta' em `-p`.
      '--verbose',
    ];
    if (modelo) args.push('--model', modelo);

    // Navegador do hub, quando o shell desktop esta' no ar: as abas dele ja' estao
    // autenticadas no Sankhya, e e' o que permite uma skill tirar evidencia de tela sem
    // segundo navegador e sem novo login. Sem shell, a skill segue o caminho dela
    // (Playwright ou modo manual) — por isso isto e' acrescimo, nunca exigencia.
    const mcp = this.#configMcp();
    if (mcp) {
      args.push('--mcp-config', mcp.arquivo);
      // A skill de documento de entrega procura literalmente as tools da extensao
      // `claude-in-chrome`. Em vez de batizar o servidor com o nome dela — o que
      // colidiria com a extensao de verdade em quem a tem —, o system prompt diz que as
      // ferramentas do hub cumprem esse papel. Assim a skill fica intocada e continua
      // sendo atualizada pelo plugin.
      args.push('--append-system-prompt', AVISO_NAVEGADOR);
    }

    const processo = spawn('claude', args, {
      cwd: pasta,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      // `claude` no Windows e' um `.exe` de verdade (instalador nativo) ou um shim `.cmd`
      // do npm. O shim exige shell; como nenhum argumento aqui vem do usuario (a skill e'
      // validada contra a lista, a pasta contra o disco e o modelo contra a allowlist),
      // isso nao abre caminho para injecao.
      shell: process.platform === 'win32',
    });

    const sessao: Sessao = {
      id: randomUUID(),
      skill,
      pasta,
      modelo,
      sessaoClaude: '',
      viva: true,
      custoUsd: 0,
      iniciadaEm: new Date().toISOString(),
      processo,
      eventos: [],
      ouvintes: new Set(),
      parcial: '',
    };
    this.#sessoes.set(sessao.id, sessao);

    processo.stdout?.on('data', (pedaco: Buffer) => this.#consumir(sessao, pedaco.toString('utf8')));
    processo.stderr?.on('data', (pedaco: Buffer) => {
      const texto = pedaco.toString('utf8').trim();
      if (texto) this.#registrar(sessao, { type: 'stderr', texto });
    });
    processo.on('error', (err) => {
      this.#registrar(sessao, { type: 'erro', texto: `não consegui executar o claude: ${err.message}` });
      sessao.viva = false;
    });
    processo.on('close', (codigo) => {
      sessao.viva = false;
      this.#registrar(sessao, { type: 'encerrado', codigo });
    });

    this.enviar(sessao.id, entrada.mensagem);
    return this.estado(sessao.id);
  }

  /** Nova mensagem do usuario na sessao — retoma o mesmo contexto. */
  enviar(id: string, mensagem: string): EstadoSessaoSkill {
    const sessao = this.#sessao(id);
    if (!sessao.viva) throw new PedidoSkillError('esta sessão já foi encerrada');

    const texto = mensagem.trim();
    if (!texto) throw new PedidoSkillError('mensagem vazia');

    this.#registrar(sessao, {
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: texto }] },
      origem: 'hub',
    });
    sessao.processo.stdin?.write(
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: texto }] } }) + '\n',
    );
    return this.estado(id);
  }

  encerrar(id: string): EstadoSessaoSkill {
    const sessao = this.#sessao(id);
    if (sessao.viva) sessao.processo.kill();
    sessao.viva = false;
    return this.estado(id);
  }

  estado(id: string): EstadoSessaoSkill {
    const { processo, eventos, ouvintes, parcial, ...publico } = this.#sessao(id);
    void processo;
    void eventos;
    void ouvintes;
    void parcial;
    return publico;
  }

  sessoes(): EstadoSessaoSkill[] {
    return [...this.#sessoes.keys()].map((id) => this.estado(id));
  }

  /** Eventos já recebidos, para a tela reconstruir a conversa ao (re)abrir. */
  historico(id: string, desde = 0): EventoSkill[] {
    return this.#sessao(id).eventos.filter((evento) => evento.seq > desde);
  }

  /** Assina os eventos seguintes; devolve o cancelamento. */
  acompanhar(id: string, ouvinte: (evento: EventoSkill) => void): () => void {
    const sessao = this.#sessao(id);
    sessao.ouvintes.add(ouvinte);
    return () => sessao.ouvintes.delete(ouvinte);
  }

  #sessao(id: string): Sessao {
    const sessao = this.#sessoes.get(id);
    if (!sessao) throw new PedidoSkillError(`sessão não encontrada: ${id}`);
    return sessao;
  }

  /** O stdout chega em pedaços arbitrários; o que separa eventos é a quebra de linha. */
  #consumir(sessao: Sessao, pedaco: string): void {
    sessao.parcial += pedaco;
    const linhas = sessao.parcial.split('\n');
    sessao.parcial = linhas.pop() ?? '';

    for (const linha of linhas) {
      if (!linha.trim()) continue;
      let evento: unknown;
      try {
        evento = JSON.parse(linha);
      } catch {
        evento = { type: 'nao-json', texto: linha };
      }
      this.#registrar(sessao, evento);
    }
  }

  #registrar(sessao: Sessao, bruto: unknown): void {
    const dados = bruto as { type?: string; session_id?: string; total_cost_usd?: number };
    if (dados.session_id) sessao.sessaoClaude = dados.session_id;
    // O `total_cost_usd` do `result` e' ACUMULADO na sessao, não por turno: guardar o
    // maior evita somar duas vezes o que a CLI já somou.
    if (dados.type === 'result' && typeof dados.total_cost_usd === 'number') {
      sessao.custoUsd = Math.max(sessao.custoUsd, dados.total_cost_usd);
    }

    const evento: EventoSkill = { seq: sessao.eventos.length + 1, em: new Date().toISOString(), bruto };
    sessao.eventos.push(evento);
    if (sessao.eventos.length > LIMITE_EVENTOS) sessao.eventos.shift();

    for (const ouvinte of sessao.ouvintes) ouvinte(evento);
  }
}
