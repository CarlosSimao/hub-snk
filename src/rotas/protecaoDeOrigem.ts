import type { FastifyInstance } from 'fastify';
import { configuracao } from '../configuracao.ts';

/*
 * Escutar em 127.0.0.1 não isola o HUB SNK do resto da internet: qualquer página
 * aberta no navegador do usuário alcança o endereço local, e um domínio que
 * resolve para 127.0.0.1 (DNS rebinding) passa por origem legítima. Como não há
 * autenticação, e a API devolve senhas e abre programas da máquina, cada
 * requisição precisa provar que veio da própria janela do HUB SNK.
 *
 * São dois cabeçalhos: `Host` diz por qual endereço o navegador chegou — um nome
 * de domínio ali denuncia o rebinding — e `Origin` diz qual página fez a chamada,
 * fechando o CSRF.
 */

const NOMES_DE_LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const PORTA_HTTP_PADRAO = 80;
const ORIGEM_OPACA = 'null';

interface Autoridade {
  nome: string;
  porta: number;
}

/**
 * O parser de URL do próprio Node resolve os detalhes chatos do formato —
 * colchetes do IPv6, porta ausente, maiúsculas — e recusa lixo que uma quebra
 * manual em `:` aceitaria.
 */
function interpretarAutoridade(valor: string): Autoridade | null {
  let endereco: URL;
  try {
    endereco = new URL(`http://${valor}`);
  } catch {
    return null;
  }

  /* `127.0.0.1:4100/algo` e `usuario@127.0.0.1:4100` não são autoridades puras. */
  if (endereco.pathname !== '/' || endereco.search !== '' || endereco.username !== '') {
    return null;
  }

  return lerNomeEPorta(endereco);
}

function interpretarOrigem(valor: string): Autoridade | null {
  /* Origem opaca (sandbox, `data:`) nunca é a janela do HUB SNK. */
  if (valor === ORIGEM_OPACA) {
    return null;
  }

  let endereco: URL;
  try {
    endereco = new URL(valor);
  } catch {
    return null;
  }

  /* O servidor é HTTP puro; qualquer outro esquema veio de outro lugar. */
  if (endereco.protocol !== 'http:') {
    return null;
  }

  return lerNomeEPorta(endereco);
}

function lerNomeEPorta(endereco: URL): Autoridade {
  return {
    nome: endereco.hostname.toLowerCase(),
    porta: endereco.port === '' ? PORTA_HTTP_PADRAO : Number(endereco.port),
  };
}

function ehEnderecoDoProprioHub(autoridade: Autoridade | null, porta: number): boolean {
  return (
    autoridade !== null && NOMES_DE_LOOPBACK.has(autoridade.nome) && autoridade.porta === porta
  );
}

export interface CabecalhosDeOrigem {
  host: string | undefined;
  origem: string | undefined;
  porta: number;
}

/**
 * Requisição sem `Origin` é aceita: navegação direta, a própria PWA abrindo o
 * shell e chamadas de linha de comando não mandam o cabeçalho, e o `Host` já
 * garantiu que o endereço usado foi o local.
 */
export function requisicaoVeioDaMaquinaLocal({ host, origem, porta }: CabecalhosDeOrigem): boolean {
  if (host === undefined || !ehEnderecoDoProprioHub(interpretarAutoridade(host), porta)) {
    return false;
  }

  return origem === undefined || ehEnderecoDoProprioHub(interpretarOrigem(origem), porta);
}

/**
 * Precisa ser registrado antes das rotas e dos arquivos estáticos: a checagem
 * vale para o cadastro inteiro, não só para as chamadas que gravam — um `GET`
 * de clientes já devolve as senhas em texto puro.
 */
export function registrarProtecaoDeOrigem(servidor: FastifyInstance): void {
  /*
   * Com a rede liberada não há lista de endereços válidos a comparar: o usuário
   * chega pelo IP da máquina, pelo nome dela ou por qualquer apelido de DNS. A
   * checagem seria só teatro, então ela sai e o aviso fica.
   */
  if (configuracao.escutaNaRede) {
    servidor.log.warn(
      `HUB SNK escutando em ${configuracao.host}: sem autenticação e sem proteção de origem. ` +
        'Qualquer máquina que alcance esta porta lê as senhas do cadastro e abre programas daqui.',
    );
    return;
  }

  servidor.addHook('onRequest', async (requisicao, resposta) => {
    const confiavel = requisicaoVeioDaMaquinaLocal({
      host: requisicao.headers.host,
      origem: requisicao.headers.origin,
      porta: configuracao.porta,
    });

    if (confiavel) {
      return;
    }

    requisicao.log.warn(
      `Requisição recusada — host "${requisicao.headers.host ?? ''}", origem "${requisicao.headers.origin ?? ''}".`,
    );
    await resposta.status(403).send({
      mensagem: 'Requisição recusada: o HUB SNK só atende a própria máquina.',
    });
    return resposta;
  });
}
