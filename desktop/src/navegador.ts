/**
 * O que era o "navegador do hub" — Fase 3 da migracao "sem Docker", ultima rota do
 * `hub-helper.ps1` a sair.
 *
 * Antes: o helper abria uma SEGUNDA janela do Chrome, com perfil proprio em
 * `%APPDATA%\sankhya-hub\navegador`, subia o DevTools na porta 9222 e lia a sessao por
 * CDP. Tudo isso existia porque o hub rodava num container e nao tinha navegador nenhum.
 *
 * Agora o shell JA E' o navegador. As abas ERP e Experience estao abertas aqui, e ler a
 * sessao e' `session.cookies` — sem CDP, sem porta 9222, sem Chrome paralelo. Some junto
 * a restricao do Chrome 136 (que recusa DevTools no perfil padrao), que era a razao de
 * existir todo o mecanismo de copiar favoritos para um perfil separado.
 */
import { session } from 'electron';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DOMINIOS_ERP, ERP_URL, EXPERIENCE_URL, PARTICAO } from './config';
import { capturarTokenExperience } from './sessions';
import { gravarSessao, type Sistema } from './cofreCredenciais';
import { logEvento } from './log';
import type { TabManager } from './tabs';

/** Telas que o hub sabe abrir direto, pelo apelido. */
const TELAS: Record<string, { sistema: Sistema; resource: string }> = {
  'agenda-recursos': { sistema: 'sankhya-erp', resource: 'br.com.sankhya.os.mov.agenda.recursos' },
};

const URL_LOGIN: Record<Sistema, string> = {
  'sankhya-erp': ERP_URL,
  'sankhya-experience': EXPERIENCE_URL,
};

/**
 * Onde mora o que REALMENTE autentica cada sistema.
 *
 * Medido: a API da Experience responde 403 com o cookie e 200 com
 * `Authorization: Bearer <localStorage.token>`. O cookie de sessao nao serve para ela, e
 * considerar a captura bem-sucedida sem o JWT daria uma sessao que nao funciona.
 */
const USA_TOKEN: Record<Sistema, boolean> = {
  'sankhya-erp': false,
  'sankhya-experience': true,
};

export interface FavoritoNavegador {
  titulo: string;
  url: string;
  pasta: string;
}

export interface PerfilNavegador {
  navegador: string;
  pasta: string;
  nome: string;
}

/** Pastas de perfil do Chrome e do Edge — de onde os favoritos pessoais sao lidos. */
const RAIZES_PERFIL: { navegador: string; caminho: string }[] = [
  { navegador: 'chrome', caminho: join(homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data') },
  { navegador: 'edge', caminho: join(homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data') },
];

interface NoFavorito {
  type?: string;
  name?: string;
  url?: string;
  children?: NoFavorito[];
}

function achatar(no: NoFavorito, prefixo: string, saida: FavoritoNavegador[]): void {
  for (const filho of no.children ?? []) {
    if (filho.type === 'url' && filho.url) {
      saida.push({ titulo: filho.name ?? filho.url, url: filho.url, pasta: prefixo });
      continue;
    }
    if (filho.type === 'folder') {
      const nome = filho.name ?? '';
      achatar(filho, prefixo ? `${prefixo}/${nome}` : nome, saida);
    }
  }
}

/** Perfis que TEM arquivo de favoritos — oferecer um perfil vazio só gera clique à toa. */
export function perfis(): PerfilNavegador[] {
  const achados: PerfilNavegador[] = [];

  for (const { navegador, caminho } of RAIZES_PERFIL) {
    if (!existsSync(caminho)) continue;

    let pastas: string[];
    try {
      pastas = readdirSync(caminho, { withFileTypes: true })
        .filter((e) => e.isDirectory() && (e.name === 'Default' || e.name.startsWith('Profile ')))
        .map((e) => e.name);
    } catch {
      continue;
    }

    for (const pasta of pastas) {
      if (!existsSync(join(caminho, pasta, 'Bookmarks'))) continue;

      // O nome que o usuário vê fica no `Preferences`, não no nome da pasta.
      let nome = pasta;
      try {
        const prefs = JSON.parse(readFileSync(join(caminho, pasta, 'Preferences'), 'utf8')) as {
          profile?: { name?: string };
        };
        if (prefs.profile?.name) nome = prefs.profile.name;
      } catch {
        // Preferences ilegível: o nome da pasta serve.
      }
      achados.push({ navegador, pasta, nome });
    }
  }

  return achados;
}

/** Só leitura: o arquivo de favoritos do usuário nunca é alterado. */
export function favoritos(navegador: string, perfil: string): FavoritoNavegador[] {
  const raiz = RAIZES_PERFIL.find((r) => r.navegador === navegador);
  if (!raiz) return [];

  const arquivo = join(raiz.caminho, perfil, 'Bookmarks');
  if (!existsSync(arquivo)) return [];

  try {
    const dados = JSON.parse(readFileSync(arquivo, 'utf8')) as { roots?: Record<string, NoFavorito> };
    const saida: FavoritoNavegador[] = [];
    for (const no of Object.values(dados.roots ?? {})) {
      if (no && typeof no === 'object') achatar(no, '', saida);
    }
    return saida;
  } catch {
    return [];
  }
}

export function resolverUrl(sistema: Sistema, tela: string): string {
  if (!tela) return URL_LOGIN[sistema];

  const info = TELAS[tela];
  if (!info) return '';
  const base64 = Buffer.from(info.resource, 'utf8').toString('base64');
  return `https://skw.sankhya.com.br/mge/system.jsp#app/${base64}`;
}

export function telasConhecidas(): string[] {
  return Object.keys(TELAS);
}

/**
 * Abre a tela na aba do sistema, dentro do proprio shell.
 *
 * Antes isto disparava um processo do Chrome; aqui e' navegar a aba que ja' existe e
 * traze-la para a frente.
 */
export function abrir(tabs: TabManager | null, sistema: Sistema, tela: string): string {
  const url = resolverUrl(sistema, tela);
  if (!url) throw new Error(`tela desconhecida: ${tela}`);

  const id = sistema === 'sankhya-erp' ? 'erp' : 'experience';
  const view = tabs?.aba(id);
  if (!view) throw new Error('as abas do Sankhya ainda não abriram');

  void view.webContents.loadURL(url);
  tabs?.mostrar(id);
  logEvento('navegador-abrir', { sistema, tela });
  return url;
}

export interface ResultadoCaptura {
  ok: boolean;
  cookies: number;
  token?: boolean;
  expira?: string;
  erro?: string;
}

/**
 * Le a sessao da aba e guarda no cofre do shell.
 *
 * Duas regras herdadas do helper, e as duas evitam "capturei" mentiroso:
 *
 *  - para a Experience, a ausencia do TOKEN e' o unico teste honesto de "esta logado" —
 *    cookie anonimo existe antes do login e daria falso positivo;
 *  - para o ERP, sem cookie nenhum do dominio nao ha o que capturar.
 */
export async function capturar(tabs: TabManager | null, sistema: Sistema): Promise<ResultadoCaptura> {
  const particao = session.fromPartition(PARTICAO);

  const cookies = (
    await Promise.all(DOMINIOS_ERP.map((dominio) => particao.cookies.get({ domain: dominio })))
  ).flat();

  let token = '';
  let expira = '';
  if (USA_TOKEN[sistema]) {
    const sessao = await capturarTokenExperience(tabs?.aba('experience'));
    token = sessao.token;
    expira = sessao.expIso;

    if (!token) {
      return {
        ok: false,
        cookies: cookies.length,
        erro: 'a aba não está logada nesse sistema — faça o login nela e capture de novo',
      };
    }
  } else if (!cookies.length) {
    return {
      ok: false,
      cookies: 0,
      erro: 'nenhum cookie desse domínio — faça o login na aba do Sankhya antes de capturar',
    };
  }

  const cabecalho = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  gravarSessao(sistema, {
    ...(cookies.length ? { sessao: cabecalho } : {}),
    ...(token ? { token } : {}),
    ...(expira ? { expira } : {}),
  });

  logEvento('navegador-sessao-capturada', { sistema, cookies: cookies.length, token: Boolean(token) });
  return { ok: true, cookies: cookies.length, token: Boolean(token), expira };
}

export interface StatusNavegador {
  navegador: boolean;
  disponiveis: string[];
  aberto: boolean;
  abas: { id: string; url: string; titulo: string; sistema: string; logado: boolean }[];
  telas: string[];
  perfis: PerfilNavegador[];
}

export function status(tabs: TabManager | null): StatusNavegador {
  const abas: StatusNavegador['abas'] = [];

  for (const [id, sistema] of [
    ['erp', 'sankhya-erp'],
    ['experience', 'sankhya-experience'],
  ] as const) {
    const view = tabs?.aba(id);
    if (!view) continue;
    const url = view.webContents.getURL();
    abas.push({
      id,
      url,
      titulo: view.webContents.getTitle(),
      sistema,
      // Heurística igual à do helper: URL de login significa sessão ainda não feita.
      logado: Boolean(url) && !/login|signin/i.test(url),
    });
  }

  return {
    // O shell É o navegador: não há o que procurar na máquina nem janela para abrir.
    navegador: true,
    disponiveis: ['sankhya-hub-desktop'],
    aberto: Boolean(tabs),
    abas,
    telas: telasConhecidas(),
    perfis: perfis(),
  };
}
