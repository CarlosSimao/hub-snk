import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORTA_PADRAO = 4100;
const HOST_PADRAO = '127.0.0.1';
const HOSTS_DE_LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
const VALOR_QUE_LIBERA_A_REDE = '1';
const VALOR_QUE_IMPEDE_A_JANELA = '0';
const NAVEGADOR_PADRAO_DA_JANELA = 'auto';

const raizDoProjeto = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function lerPorta(): number {
  const bruto = process.env.HUB_PORTA;
  if (!bruto) {
    return PORTA_PADRAO;
  }

  const porta = Number(bruto);
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
    throw new Error(`HUB_PORTA inválida: "${bruto}". Informe um inteiro entre 1 e 65535.`);
  }

  return porta;
}

/**
 * O HUB SNK não tem autenticação: quem alcança a porta lê o cadastro inteiro,
 * senhas incluídas, e dispara a abertura de executáveis da máquina. Escutar fora
 * do loopback transforma isso em execução de comando remota, então a exposição
 * na rede precisa ser pedida de propósito, nunca acontecer por descuido.
 */
function lerHost(): string {
  const bruto = process.env.HUB_HOST;
  if (!bruto) {
    return HOST_PADRAO;
  }

  if (HOSTS_DE_LOOPBACK.has(bruto)) {
    return bruto;
  }

  if (process.env.HUB_PERMITIR_REDE !== VALOR_QUE_LIBERA_A_REDE) {
    throw new Error(
      `HUB_HOST="${bruto}" expõe o HUB SNK para outras máquinas da rede. ` +
        'O servidor não tem autenticação, devolve as senhas do cadastro pela API e ' +
        'abre programas do sistema operacional. Se é isso mesmo que você quer, ' +
        `defina HUB_PERMITIR_REDE=${VALOR_QUE_LIBERA_A_REDE}.`,
    );
  }

  return bruto;
}

/**
 * O diretório de dados é configurável para permitir apontá-lo para uma pasta
 * sincronizada com a nuvem sem alterar código.
 *
 * O nome padrão carrega o do projeto porque a pasta costuma acabar dentro do
 * Drive ou do OneDrive do usuário, ao lado de outras: `dados` sozinho não diria
 * de quem é.
 */
function lerDiretorioDeDados(): string {
  const bruto = process.env.HUB_DADOS_DIR;
  return bruto ? resolve(bruto) : join(raizDoProjeto, 'dados-hub-snk');
}

const host = lerHost();

export const configuracao = {
  porta: lerPorta(),
  host,
  /* Ligado só quando o usuário confirmou a exposição pela HUB_PERMITIR_REDE. */
  escutaNaRede: !HOSTS_DE_LOOPBACK.has(host),
  diretorioPublico: join(raizDoProjeto, 'public'),
  diretorioDeDados: lerDiretorioDeDados(),
  /*
   * Abrir a janela é o padrão porque quem roda o `node` direto do pacote não
   * tem outro caminho até a tela. O launcher, que abre a janela por conta
   * própria, desliga isso com HUB_ABRIR_JANELA=0 para não abrir duas.
   *
   * O `--watch` do desenvolvimento fica de fora sem precisar de variável: ali o
   * processo reinicia a cada arquivo salvo, e uma janela por salvamento
   * inviabilizaria o modo.
   */
  abrirJanela:
    process.env.HUB_ABRIR_JANELA !== VALOR_QUE_IMPEDE_A_JANELA &&
    !process.execArgv.includes('--watch'),
  navegador: process.env.HUB_NAVEGADOR?.trim().toLowerCase() || NAVEGADOR_PADRAO_DA_JANELA,
} as const;
