import { readFileSync } from 'node:fs';

/**
 * Credencial OAuth do HUB SNK no Google Cloud, de um cliente do tipo "App para
 * computador". Nesse tipo o Google não trata o `client_secret` como segredo: ele viaja
 * no instalador e só identifica o aplicativo — quem autoriza o acesso é o usuário, na
 * tela de consentimento, e o que protege a troca do código é o PKCE.
 *
 * Mesmo assim ela não vai para o repositório, que é público: o GitHub bloqueia o push e o
 * histórico do Git não esquece. O empacotamento a grava em `credencial-google.json`, na
 * raiz do backend, a partir dos secrets `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`
 * (`desktop/scripts/preparar-hub.mjs`); em desenvolvimento, o mesmo arquivo na raiz do
 * repositório, que o `.gitignore` ignora. Como criar a credencial: `docs/manutencao.md`.
 */
export interface CredencialDoGoogle {
  clientId: string;
  clientSecret: string;
}

export const NOME_DO_ARQUIVO_DA_CREDENCIAL = 'credencial-google.json';

const VAZIA: CredencialDoGoogle = { clientId: '', clientSecret: '' };

function textoOuVazio(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function lerDoArquivo(caminho: string): CredencialDoGoogle {
  try {
    const dados = JSON.parse(readFileSync(caminho, 'utf8')) as Record<string, unknown>;
    return {
      clientId: textoOuVazio(dados.clientId),
      clientSecret: textoOuVazio(dados.clientSecret),
    };
  } catch {
    // Sem arquivo (ou ilegível), a integração com o Drive fica desligada e a tela diz por quê.
    return VAZIA;
  }
}

/**
 * As variáveis de ambiente vencem o arquivo: servem a quem testa com a própria
 * credencial sem mexer em arquivo nenhum. Cada campo é resolvido sozinho, mas só vale o
 * par completo — `ContaDoGoogle` trata ID ou chave vazios como "não configurado".
 */
export function lerCredencialDoGoogle(
  caminhoDoArquivo: string,
  ambiente: NodeJS.ProcessEnv,
): CredencialDoGoogle {
  const doArquivo = lerDoArquivo(caminhoDoArquivo);
  return {
    clientId: textoOuVazio(ambiente.HUB_GOOGLE_CLIENT_ID) || doArquivo.clientId,
    clientSecret: textoOuVazio(ambiente.HUB_GOOGLE_CLIENT_SECRET) || doArquivo.clientSecret,
  };
}
