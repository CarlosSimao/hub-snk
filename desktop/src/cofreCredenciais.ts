/**
 * Cofre das credenciais do Sankhya ERP e da Experience — Fase 3 da migração "sem Docker".
 *
 * Substitui as rotas `/credentials` e `/secret` do `scripts/hub-helper.ps1`. O helper
 * usava `ProtectedData` (DPAPI) porque o container Linux não tem essa API; o
 * `safeStorage` do Electron É DPAPI no Windows, então a proteção é a mesma e some um
 * processo PowerShell inteiro do caminho.
 *
 * Ganho de superfície: o helper escuta HTTP em TODAS as interfaces da máquina (porta
 * 4102, protegida por token justamente porque `/reveal` devolve senha em texto claro).
 * Aqui o valor decriptado nasce e morre dentro do processo do shell, e só sai pelo
 * bridge em `127.0.0.1`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app, safeStorage } from 'electron';
import { logEvento } from './log';

export const SISTEMAS = ['sankhya-erp', 'sankhya-experience'] as const;
export type Sistema = (typeof SISTEMAS)[number];

export function ehSistemaValido(valor: string): valor is Sistema {
  return (SISTEMAS as readonly string[]).includes(valor);
}

/** O que a UI pode ver: quem é o usuário e se há o que usar. Nunca o segredo. */
export interface StatusCredencial {
  usuario: string;
  definido: boolean;
  sessaoCapturada: boolean;
  sessaoExpiraEm: string;
}

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
interface EntradaGravada {
  usuario: string;
  senha: string;
  sessao: string;
  token: string;
  expira: string;
}

type CofreGravado = Partial<Record<Sistema, EntradaGravada>>;

const ARQUIVO = join(app.getPath('userData'), 'credenciais.json');

function cifrar(valor: string): string {
  if (!valor) return '';
  return safeStorage.encryptString(valor).toString('base64');
}

function decifrar(valor: string): string {
  if (!valor) return '';
  return safeStorage.decryptString(Buffer.from(valor, 'base64'));
}

function ler(): CofreGravado {
  if (!existsSync(ARQUIVO)) return {};
  try {
    return JSON.parse(readFileSync(ARQUIVO, 'utf8')) as CofreGravado;
  } catch {
    // Arquivo truncado por desligamento no meio da escrita. Perder a credencial é ruim,
    // mas travar o shell por causa dela é pior — o usuário regrava pela tela.
    logEvento('cofre-ilegivel');
    return {};
  }
}

function gravarArquivo(cofre: CofreGravado): void {
  mkdirSync(dirname(ARQUIVO), { recursive: true });
  writeFileSync(ARQUIVO, JSON.stringify(cofre, null, 2), 'utf8');
}

function statusDe(entrada: EntradaGravada | undefined): StatusCredencial {
  return {
    usuario: entrada?.usuario ?? '',
    definido: Boolean(entrada?.senha),
    // Para a Experience o que vale é o token; para o ERP legado, o cookie.
    sessaoCapturada: Boolean(entrada?.token || entrada?.sessao),
    sessaoExpiraEm: entrada?.expira ?? '',
  };
}

export function status(sistema: Sistema): StatusCredencial {
  return statusDe(ler()[sistema]);
}

export function gravar(sistema: Sistema, usuario: string, senha: string): StatusCredencial {
  const cofre = ler();
  const anterior = cofre[sistema];
  cofre[sistema] = {
    // Espaço em volta é quase sempre acidente de copiar e colar, e uma senha com espaço
    // invisível no fim falha a autenticação sem dar pista nenhuma.
    usuario: usuario.trim(),
    senha: cifrar(senha),
    // A sessão já capturada sobrevive a uma troca de senha: são credenciais
    // independentes, e invalidá-la aqui desconectaria o hub sem motivo.
    sessao: anterior?.sessao ?? '',
    token: anterior?.token ?? '',
    expira: anterior?.expira ?? '',
  };
  gravarArquivo(cofre);
  return statusDe(cofre[sistema]);
}

/** Guarda a sessão capturada (cookies do ERP ou JWT da Experience), sem tocar na senha. */
export function gravarSessao(
  sistema: Sistema,
  dados: { usuario?: string; sessao?: string; token?: string; expira?: string },
): StatusCredencial {
  const cofre = ler();
  const anterior = cofre[sistema];
  cofre[sistema] = {
    usuario: dados.usuario?.trim() || (anterior?.usuario ?? ''),
    senha: anterior?.senha ?? '',
    sessao: dados.sessao !== undefined ? cifrar(dados.sessao) : (anterior?.sessao ?? ''),
    token: dados.token !== undefined ? cifrar(dados.token) : (anterior?.token ?? ''),
    expira: dados.expira ?? anterior?.expira ?? '',
  };
  gravarArquivo(cofre);
  return statusDe(cofre[sistema]);
}

export function remover(sistema: Sistema): StatusCredencial {
  const cofre = ler();
  delete cofre[sistema];
  gravarArquivo(cofre);
  return statusDe(undefined);
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
  const entrada = ler()[sistema];
  const base = statusDe(entrada);
  if (!entrada) return { ...base, senha: '', sessao: '', token: '', expira: '' };

  try {
    return {
      ...base,
      senha: decifrar(entrada.senha),
      sessao: decifrar(entrada.sessao),
      token: decifrar(entrada.token),
      expira: entrada.expira,
    };
  } catch {
    logEvento('cofre-decriptacao-falhou', { sistema });
    return { ...base, senha: '', sessao: '', token: '', expira: entrada.expira };
  }
}

/**
 * Marca do envelope do `safeStorage`, para o backend saber quem cifrou.
 *
 * O blob do `hub-helper.ps1` (DPAPI cru) e o daqui não se abrem mutuamente, e uma falha
 * de decifragem é indistinguível de "senha gravada noutro usuário do Windows" — que é
 * um problema real e de outra natureza. Ver `src/sankhya/cifra.ts`.
 */
export const PREFIXO_SEGREDO = 'sb1:';

/** Segredo avulso: senha de base de cliente, senha do app do Gmail. */
export function cifrarSegredo(valor: string): string {
  return PREFIXO_SEGREDO + cifrar(valor);
}

export function decifrarSegredo(cifrada: string): string {
  if (!cifrada.startsWith(PREFIXO_SEGREDO)) {
    // Blob do helper PowerShell: o `safeStorage` não abre, e tentar devolveria um erro
    // genérico de criptografia. Melhor dizer o que de fato está acontecendo.
    throw new Error('este valor foi cifrado pelo hub-helper.ps1 e precisa dele para ser aberto');
  }
  return decifrar(cifrada.slice(PREFIXO_SEGREDO.length));
}

export function vazio(): boolean {
  const cofre = ler();
  return SISTEMAS.every((sistema) => !cofre[sistema]);
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
