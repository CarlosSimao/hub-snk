/**
 * Cofre do Sankhya ID (um usuário e uma senha, que valem para o SankhyaOm e para a
 * Experience) e das sessões capturadas de cada um dos dois, cifrado com o `safeStorage`
 * do Electron (DPAPI no Windows).
 *
 * O valor decriptado nasce e morre dentro do processo do shell, e só sai pela ponte em
 * `127.0.0.1`, protegida por token.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app, safeStorage } from 'electron';
import { logEvento } from '../log';
import { identificacaoDoCofreAntigo, type IdentificacaoGravada } from './migracaoDoCofre';

export const SISTEMAS = ['sankhya-erp', 'sankhya-experience'] as const;
export type Sistema = (typeof SISTEMAS)[number];

export function ehSistemaValido(valor: string): valor is Sistema {
  return (SISTEMAS as readonly string[]).includes(valor);
}

/** O que a UI pode ver: quem é o usuário e se há o que usar. Nunca o segredo. */
export interface StatusCredencial {
  usuario: string;
  definido: boolean;
  /** Recado da migração do cofre antigo; vazio na imensa maioria dos casos. */
  aviso: string;
  sessaoCapturada: boolean;
  sessaoExpiraEm: string;
}

/** O Sankhya ID sozinho, sem a sessão de nenhum sistema. */
export type StatusDoSankhyaId = Pick<StatusCredencial, 'usuario' | 'definido' | 'aviso'>;

/** O que o backend recebe para autenticar. Nunca chega ao navegador. */
export interface SegredoCredencial extends StatusCredencial {
  senha: string;
  /** Cookies serializados como cabeçalho `Cookie` — o ERP legado autentica por eles. */
  sessao: string;
  /** JWT do `localStorage` — é o que a API da Experience aceita. */
  token: string;
  expira: string;
}

/** Em disco: campos sensíveis cifrados, base64. Campo vazio fica vazio, não cifrado. */
interface SessaoGravada {
  sessao: string;
  token: string;
  expira: string;
}

/**
 * O login único fica em `id`; cada sistema guarda só a sessão dele. As entradas de antes
 * do Sankhya ID ainda trazem `usuario` e `senha`, que `ler()` migra e descarta.
 */
type CofreGravado = { id?: IdentificacaoGravada } & Partial<
  Record<Sistema, SessaoGravada & { usuario?: string; senha?: string }>
>;

const ARQUIVO = join(app.getPath('userData'), 'credenciais.json');

/*
 * Com a senha trocada fora do HUB SNK, as janelas ocultas e o login automático das guias
 * repetiriam a senha antiga para sempre — a cada consulta da Agenda, a cada renovação do
 * token da Experience — até o Sankhya bloquear a conta. Depois deste tanto de recusas
 * seguidas, o login automático para até a senha ser regravada. Em memória de propósito:
 * reabrir o aplicativo dá uma nova chance.
 */
const LIMITE_DE_LOGINS_RECUSADOS = 2;
let loginsRecusadosSeguidos = 0;

export const MENSAGEM_DE_LOGIN_SUSPENSO =
  'login automático suspenso: o Sankhya recusou a senha salva mais de uma vez seguida — ' +
  'confira usuário e senha no Sankhya ID e salve de novo';

/**
 * Um contador só, porque a senha é uma só: recusa em qualquer dos dois sistemas já é a
 * senha errada, e insistir no outro bloquearia a conta do mesmo jeito.
 */
export function loginAutomaticoSuspenso(): boolean {
  return loginsRecusadosSeguidos >= LIMITE_DE_LOGINS_RECUSADOS;
}

/** Chamado por quem submeteu a senha, com o veredito do próprio critério de sucesso. */
export function registrarLoginAutomatico(sistema: Sistema, aceito: boolean): void {
  if (aceito) {
    loginsRecusadosSeguidos = 0;
    return;
  }
  loginsRecusadosSeguidos += 1;
  logEvento('login-automatico-recusado', {
    sistema,
    recusados: loginsRecusadosSeguidos,
    suspenso: loginAutomaticoSuspenso(),
  });
}

function cifrar(valor: string): string {
  if (!valor) return '';
  return safeStorage.encryptString(valor).toString('base64');
}

function decifrar(valor: string): string {
  if (!valor) return '';
  return safeStorage.decryptString(Buffer.from(valor, 'base64'));
}

/**
 * Cofre de antes do Sankhya ID: o login do SankhyaOm (ou, sem ele, o da Experience) vira o
 * Sankhya ID, e as entradas ficam só com a sessão capturada. Grava na hora, para a
 * migração acontecer uma vez só.
 */
function migrarCofreAntigo(cofre: CofreGravado): CofreGravado {
  if (cofre.id) return cofre;
  const id = identificacaoDoCofreAntigo(cofre['sankhya-erp'], cofre['sankhya-experience']);
  if (!id) return cofre;

  const migrado: CofreGravado = { id };
  for (const sistema of SISTEMAS) {
    const antiga = cofre[sistema];
    if (!antiga) continue;
    migrado[sistema] = { sessao: antiga.sessao, token: antiga.token, expira: antiga.expira };
  }
  gravarArquivo(migrado);
  logEvento('cofre-migrado-para-sankhya-id', { comAviso: Boolean(id.aviso) });
  return migrado;
}

function ler(): CofreGravado {
  if (!existsSync(ARQUIVO)) return {};
  try {
    return migrarCofreAntigo(JSON.parse(readFileSync(ARQUIVO, 'utf8')) as CofreGravado);
  } catch {
    // Travar o shell por causa do cofre seria pior que perder a credencial — o usuário a
    // regrava pela tela. Mas o arquivo sai do caminho em vez de ficar para ser sobrescrito
    // pela próxima gravação automática de sessão: quem precisar ainda o tem.
    const guardado = `${ARQUIVO}.ilegivel-${Date.now()}`;
    try {
      renameSync(ARQUIVO, guardado);
      logEvento('cofre-ilegivel', { guardadoEm: guardado });
    } catch (erro) {
      logEvento('cofre-ilegivel-nao-guardado', { erro: String(erro) });
    }
    return {};
  }
}

/**
 * Grava ao lado e renomeia por cima: uma queda no meio da escrita deixa o cofre
 * anterior intacto, em vez de um arquivo pela metade que apagaria as duas credenciais.
 */
function gravarArquivo(cofre: CofreGravado): void {
  mkdirSync(dirname(ARQUIVO), { recursive: true });
  const temporario = `${ARQUIVO}.tmp`;
  writeFileSync(temporario, JSON.stringify(cofre, null, 2), 'utf8');
  renameSync(temporario, ARQUIVO);
}

function statusDoId(id: IdentificacaoGravada | undefined): StatusDoSankhyaId {
  return {
    usuario: id?.usuario ?? '',
    definido: Boolean(id?.senha),
    aviso: id?.aviso ?? '',
  };
}

function statusDe(cofre: CofreGravado, sistema: Sistema): StatusCredencial {
  const entrada = cofre[sistema];
  return {
    ...statusDoId(cofre.id),
    // Para a Experience o que vale é o token; para o ERP legado, o cookie.
    sessaoCapturada: Boolean(entrada?.token || entrada?.sessao),
    sessaoExpiraEm: entrada?.expira ?? '',
  };
}

export function status(sistema: Sistema): StatusCredencial {
  return statusDe(ler(), sistema);
}

export function statusDoSankhyaId(): StatusDoSankhyaId {
  return statusDoId(ler().id);
}

export function gravar(usuario: string, senha: string): StatusDoSankhyaId {
  const cofre = ler();
  cofre.id = {
    // Espaço em volta é quase sempre acidente de copiar e colar, e uma senha com espaço
    // invisível no fim falha a autenticação sem dar pista nenhuma.
    usuario: usuario.trim(),
    senha: cifrar(senha),
    aviso: '',
  };
  // A sessão já capturada de cada sistema sobrevive a uma troca de senha: invalidá-la aqui
  // desconectaria o hub sem motivo.
  gravarArquivo(cofre);
  loginsRecusadosSeguidos = 0;
  return statusDoId(cofre.id);
}

/** Guarda a sessão capturada (cookies do ERP ou JWT da Experience), sem tocar na senha. */
export function gravarSessao(
  sistema: Sistema,
  dados: { sessao?: string; token?: string; expira?: string },
): StatusCredencial {
  const cofre = ler();
  const anterior = cofre[sistema];
  cofre[sistema] = {
    sessao: dados.sessao !== undefined ? cifrar(dados.sessao) : (anterior?.sessao ?? ''),
    token: dados.token !== undefined ? cifrar(dados.token) : (anterior?.token ?? ''),
    expira: dados.expira ?? anterior?.expira ?? '',
  };
  gravarArquivo(cofre);
  return statusDe(cofre, sistema);
}

/** Tira o Sankhya ID e as duas sessões: sem a senha, nada delas se renovaria mesmo. */
export function remover(): StatusDoSankhyaId {
  gravarArquivo({});
  loginsRecusadosSeguidos = 0;
  return statusDoId(undefined);
}

/**
 * Tudo em claro. Só o backend consome, no momento do login automatizado.
 *
 * Um blob de outro usuário do Windows (perfil recriado, cofre copiado de outra máquina)
 * não volta atrás: o DPAPI é por usuário. Nesse caso é melhor devolver o status sem
 * segredo do que estourar — a tela mostra "definido" e o login falha com mensagem, em
 * vez de o shell derrubar a rota inteira.
 */
export function revelar(sistema: Sistema): SegredoCredencial {
  const cofre = ler();
  const entrada = cofre[sistema];
  const base = statusDe(cofre, sistema);
  const vazio = { senha: '', sessao: '', token: '', expira: entrada?.expira ?? '' };

  try {
    return {
      ...base,
      senha: decifrar(cofre.id?.senha ?? ''),
      sessao: decifrar(entrada?.sessao ?? ''),
      token: decifrar(entrada?.token ?? ''),
      expira: entrada?.expira ?? '',
    };
  } catch {
    logEvento('cofre-decriptacao-falhou', { sistema });
    return { ...base, ...vazio };
  }
}

/** Só a senha do Sankhya ID, para a tela mostrá-la. Vazia se não decifrar, como `revelar`. */
export function revelarSenha(): string {
  try {
    return decifrar(ler().id?.senha ?? '');
  } catch {
    logEvento('cofre-decriptacao-falhou', { sistema: 'sankhya-id' });
    return '';
  }
}

/**
 * Há criptografia REAL do sistema para gravar segredo aqui?
 *
 * No Windows a resposta do Electron basta: `isEncryptionAvailable()` só é verdadeira com
 * DPAPI de pé. No Linux ela também é verdadeira quando o Electron caiu no backend
 * `basic_text`, que cifra com uma chave FIXA e pública ("peanuts") — o arquivo fica, na
 * prática, em texto claro para quem tiver acesso ao disco. Isso é indistinguível de
 * proteção real pela API, e guardar senha de ERP assim seria pior do que recusar: quem
 * recusa avisa; quem grava não.
 *
 * O backend real vem de libsecret (gnome-keyring) ou kwallet, declarados como dependência
 * do pacote `.deb`. Sem eles, a tela mostra a recusa e diz o que instalar.
 */
export function disponivel(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  if (process.platform !== 'linux') return true;

  const backend = safeStorage.getSelectedStorageBackend();
  const real = backend !== 'basic_text' && backend !== 'unknown';
  if (!real) logEvento('cofre-sem-protecao-real', { backend });
  return real;
}

/** O que a tela mostra quando `disponivel()` é falso — muda por sistema operacional. */
export function motivoIndisponivel(): string {
  if (process.platform !== 'linux') {
    return 'criptografia do sistema indisponível neste perfil do Windows';
  }
  return (
    'sem chaveiro do sistema (libsecret/gnome-keyring ou kwallet), o Electron cifraria ' +
    'com chave fixa e pública — instale o gnome-keyring e abra o hub de novo'
  );
}
