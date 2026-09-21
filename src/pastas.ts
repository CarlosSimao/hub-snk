/**
 * Navegacao pelas pastas do disco — Fase 3 da migracao "sem Docker".
 *
 * Substitui a rota `/pastas` do `hub-helper.ps1`. Serve o cadastro de cliente a
 * escolher o repositorio local sem digitar caminho na mao.
 *
 * Rodando nativo e' `fs.readdir` e nada mais. Em container o disco visivel e' o do
 * container, nao o do Windows, entao a rota continua indo ao helper — listar `/app` para
 * quem procura `C:\projetos` seria pior que recusar.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, parse } from 'node:path';
import type { HubHelper } from './sankhya/helper.ts';
import type { ListagemPastas, PastaDoDisco } from './types.ts';

export class PastaInacessivelError extends Error {}

const EH_WINDOWS = process.platform === 'win32';

/**
 * Nativo = lista o disco desta maquina. Em container o disco visivel e' o do container,
 * e a rota continua indo ao helper. `/.dockerenv` distingue os dois no Linux, onde
 * `platform` sozinho ja' nao diz mais se e' container ou maquina do usuario.
 */
const NATIVO = EH_WINDOWS || !existsSync('/.dockerenv');

/**
 * Por onde a navegacao comeca.
 *
 * No Windows sao as unidades: nao ha API em Node para lista-las, entao testa-se cada
 * letra — 26 chamadas de `existsSync`, que custam menos que abrir um processo para
 * perguntar. No Linux nao existem unidades, e comecar na raiz obrigaria a descer
 * `/home/<usuario>` a cada uso; entao a pasta do usuario vem primeiro, e a raiz fica
 * como segunda opcao para quem guarda repositorio em `/srv` ou `/opt`.
 */
function pontosDePartida(): PastaDoDisco[] {
  if (!EH_WINDOWS) {
    const casa = homedir();
    const partida: PastaDoDisco[] = [];
    if (existsSync(casa)) partida.push({ nome: casa, caminho: casa, git: existsSync(join(casa, '.git')) });
    partida.push({ nome: '/', caminho: '/', git: false });
    return partida;
  }
  return unidadesDoWindows();
}

function unidadesDoWindows(): PastaDoDisco[] {
  const achadas: PastaDoDisco[] = [];
  for (let codigo = 'A'.charCodeAt(0); codigo <= 'Z'.charCodeAt(0); codigo += 1) {
    const letra = String.fromCharCode(codigo);
    const raiz = `${letra}:\\`;
    try {
      if (existsSync(raiz)) achadas.push({ nome: `${letra}:`, caminho: raiz, git: false });
    } catch {
      // Unidade de rede caida responde erro em vez de `false`.
    }
  }
  return achadas;
}

function ehRaizDeUnidade(caminho: string): boolean {
  const { root } = parse(caminho);
  return root.toLowerCase() === caminho.toLowerCase();
}

export class Pastas {
  readonly #helper: HubHelper;
  readonly #nativo: boolean;

  constructor(helper: HubHelper) {
    this.#helper = helper;
    this.#nativo = NATIVO;
  }

  async listar(caminho: string): Promise<ListagemPastas> {
    if (!this.#nativo) {
      const busca = new URLSearchParams({ caminho });
      return this.#helper.requisitar<ListagemPastas>(`/pastas?${busca}`);
    }

    // Sem caminho, as unidades: e' por onde a navegacao comeca.
    if (!caminho) return { atual: '', pai: '', git: false, pastas: pontosDePartida() };

    let ehPasta = false;
    try {
      ehPasta = statSync(caminho).isDirectory();
    } catch {
      ehPasta = false;
    }
    if (!ehPasta) throw new PastaInacessivelError(`pasta não encontrada: ${caminho}`);

    let filhas: PastaDoDisco[];
    try {
      filhas = readdirSync(caminho, { withFileTypes: true })
        // Pasta oculta entra de proposito: um repositorio dentro de uma delas ficaria
        // invisivel e o usuario acharia que sumiu.
        .filter((entrada) => entrada.isDirectory())
        .map((entrada) => {
          const completo = join(caminho, entrada.name);
          return {
            nome: entrada.name,
            caminho: completo,
            // Marcar o que e' repositorio poupa o usuario de entrar para descobrir.
            git: existsSync(join(completo, '.git')),
          };
        });
    } catch (err) {
      throw new PastaInacessivelError(`não consegui ler a pasta: ${(err as Error).message}`);
    }

    return {
      atual: caminho,
      // Vazio no topo de uma unidade: dali o "voltar" leva para a lista de unidades.
      pai: ehRaizDeUnidade(caminho) ? '' : dirname(caminho),
      git: existsSync(join(caminho, '.git')),
      pastas: filhas,
    };
  }
}
