/**
 * Rotas da suite Sankhya: credenciais (via hub-helper) e cadastro de clientes.
 *
 * Registradas ao lado de `registerRoutes` (routes.ts), que continua com o contrato
 * inalterado — o painel de monitoramento nao sabe que estas existem.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { HelperError, HelperIndisponivelError, lerTokenArquivo, type HubHelper } from './sankhya/helper.ts';
import { ehSistemaValido, type Credenciais } from './sankhya/credenciais.ts';
import type { Clientes } from './sankhya/clientes.ts';
import type { AgendaRecursos } from './sankhya/agenda.ts';
import type { SessaoDesktopStore } from './sankhya/sessaoDesktop.ts';
import {
  SISTEMAS_SANKHYA,
  type Cliente,
  type ClienteEntrada,
  type ConfigWildfly,
  type InstalacaoWildfly,
  type ListagemPastas,
} from './types.ts';
import { Pastas, PastaInacessivelError } from './pastas.ts';
import { ConfigWildflyInvalidaError, type Wildfly } from './wildfly.ts';
import { normalizarLista } from './sankhya/credenciais.ts';

export interface RouteSankhyaDeps {
  /** Navegacao de pastas: nativa no Windows, pelo helper em container. */
  pastas: Pastas;
  /** Caminhos e deteccao de instalacao do WildFly — mesma divisao. */
  wildfly: Wildfly;
  helper: HubHelper;
  credenciais: Credenciais;
  clientes: Clientes;
  agenda: AgendaRecursos;
  /** Presentes só quando `SANKHYA_DESKTOP_BRIDGE_URL` está configurado (src/index.ts). */
  sessaoDesktop?: SessaoDesktopStore;
  desktopBridgeTokenFile?: string;
}

/**
 * Helper fora do ar e situacao NORMAL (o processo Windows pode nao ter subido), nao
 * defeito do hub — vira 503 com a mensagem original, que e o que a tela mostra.
 */
function responderErroHelper(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof HelperIndisponivelError) {
    return reply.code(503).send({ error: err.message, helperIndisponivel: true });
  }
  if (err instanceof HelperError) {
    return reply.code(err.status).send({ error: err.message });
  }
  throw err;
}

/** Numero opcional vindo de formulario: `''`, `null` e ausente viram `null`. */
function numeroOpcional(valor: unknown): number | null | 'invalido' {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  return Number.isInteger(numero) && numero >= 0 ? numero : 'invalido';
}

/** `YYYY-MM-DD` ou vazio. Data mal formada vira vazio em vez de virar filtro quebrado. */
function ehDiaOuVazio(valor: unknown): string {
  const texto = typeof valor === 'string' ? valor.trim() : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto : '';
}

function normalizarCliente(corpo: unknown): ClienteEntrada | string {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
    return 'envie um objeto com os dados do cliente';
  }
  const dados = corpo as Record<string, unknown>;

  const nome = typeof dados['nome'] === 'string' ? dados['nome'].trim() : '';
  if (!nome) return 'o nome do cliente é obrigatório';

  const projetoId = numeroOpcional(dados['experienceProjetoId']);
  if (projetoId === 'invalido') return 'experienceProjetoId precisa ser um número inteiro';

  const personId = numeroOpcional(dados['experiencePersonId']);
  if (personId === 'invalido') return 'experiencePersonId precisa ser um número inteiro';

  const codparc = numeroOpcional(dados['agendaCodparc']);
  if (codparc === 'invalido') return 'agendaCodparc precisa ser um número inteiro';

  const texto = (chave: string) => (typeof dados[chave] === 'string' ? (dados[chave] as string).trim() : '');

  // Guardar um `javascript:` aqui vira clique armado depois, quando a tela abrir o
  // link do cliente. Só http(s) entra.
  const url = texto('sankhyaUrl');
  if (url && !/^https?:\/\//i.test(url)) return 'a URL do Sankhya precisa começar com http:// ou https://';

  return {
    nome,
    experienceProjetoId: projetoId,
    experiencePersonId: personId,
    agendaRecursoUsuario: texto('agendaRecursoUsuario'),
    agendaCodparc: codparc,
    agendaDemandaId: texto('agendaDemandaId'),
    sankhyaUrl: url,
    repositorioLocal: texto('repositorioLocal'),
    repositorioRemoto: texto('repositorioRemoto'),
    anotacoes: typeof dados['anotacoes'] === 'string' ? (dados['anotacoes'] as string) : '',
    anotacoesNotificar: dados['anotacoesNotificar'] === true,
    demandaFim: ehDiaOuVazio(dados['demandaFim']),
    emailFinalizacaoEm: ehDiaOuVazio(dados['emailFinalizacaoEm']),
  };
}

export function registerRoutesSankhya(app: FastifyInstance, deps: RouteSankhyaDeps): void {
  const { helper, credenciais, clientes, agenda, pastas, wildfly, sessaoDesktop, desktopBridgeTokenFile } =
    deps;

  /**
   * So' o proprio shell desktop chama isto (ver desktop/src/backendClient.ts) — nunca o
   * navegador. Autentica com o mesmo token do bridge (Secao "Decisao de transporte" do
   * plano de Fase 2): arquivo local, nunca exposto ao front.
   */
  function autenticarShellDesktop(request: { headers: Record<string, unknown> }, reply: FastifyReply): boolean {
    if (!desktopBridgeTokenFile) {
      reply.code(503).send({ error: 'shell desktop não configurado neste backend' });
      return false;
    }
    let esperado: string;
    try {
      esperado = lerTokenArquivo(desktopBridgeTokenFile, 'token do shell desktop indisponível');
    } catch {
      reply.code(503).send({ error: 'token do shell desktop indisponível' });
      return false;
    }
    if (request.headers['x-hub-token'] !== esperado) {
      reply.code(401).send({ error: 'token inválido' });
      return false;
    }
    return true;
  }

  app.post<{ Params: { sistema: string }; Body: { usuario?: unknown; token?: unknown; expira?: unknown } }>(
    '/api/sankhya/desktop/sessao/:sistema',
    async (request, reply) => {
      if (!autenticarShellDesktop(request, reply)) return reply;
      const { sistema } = request.params;
      // So' a Experience usa sessao empurrada nesta fase — ver sessaoDesktop.ts.
      if (sistema !== 'sankhya-experience') {
        return reply.code(404).send({ error: `sistema "${sistema}" não aceita sessão empurrada` });
      }
      const { usuario, token, expira } = request.body ?? {};
      if (typeof usuario !== 'string' || typeof token !== 'string' || !token) {
        return reply.code(400).send({ error: 'envie { usuario, token, expira? }' });
      }
      sessaoDesktop?.definir({ usuario, token, expira: typeof expira === 'string' ? expira : '' });
      return { ok: true };
    },
  );

  app.delete<{ Params: { sistema: string } }>(
    '/api/sankhya/desktop/sessao/:sistema',
    async (request, reply) => {
      if (!autenticarShellDesktop(request, reply)) return reply;
      if (request.params.sistema !== 'sankhya-experience') {
        return reply.code(404).send({ error: `sistema "${request.params.sistema}" não aceita sessão empurrada` });
      }
      sessaoDesktop?.limpar();
      return { ok: true };
    },
  );

  app.get('/api/sankhya/helper', async () => ({ disponivel: await helper.disponivel() }));

  /**
   * Pastas do disco do Windows, para o cadastro escolher o repositório local sem
   * digitar o caminho na mão. Quem enxerga o disco é o helper — o hub roda em container.
   */
  app.get<{ Querystring: { caminho?: string } }>(
    '/api/sistema/pastas',
    async (request, reply) => {
      try {
        return await pastas.listar(request.query.caminho ?? '');
      } catch (err) {
        if (err instanceof PastaInacessivelError) {
          return reply.code(404).send({ error: err.message });
        }
        return responderErroHelper(reply, err);
      }
    },
  );

  /**
   * Caminhos do WildFly local: onde está a instalação e onde está o server.log.
   *
   * Fica aqui e não no `services.yaml` porque quem consome não é o hub — são os
   * helpers do WildFly, processos Windows. O YAML é versionado e o mesmo em várias
   * máquinas; estes caminhos são desta máquina.
   */
  app.get('/api/infra/wildfly', async (_request, reply) => {
    try {
      return await wildfly.config();
    } catch (err) {
      return responderErroHelper(reply, err);
    }
  });

  app.put<{ Body: { pasta?: unknown; arquivoLog?: unknown; mostrarConsole?: unknown } }>(
    '/api/infra/wildfly',
    async (request, reply) => {
      const texto = (valor: unknown) => (typeof valor === 'string' ? valor.trim() : '');
      try {
        // Ausente = manter o que estava; só booleano de verdade muda a escolha.
        const comConsole = typeof request.body?.mostrarConsole === 'boolean' ? request.body.mostrarConsole : undefined;
        return await wildfly.gravarConfig(texto(request.body?.pasta), texto(request.body?.arquivoLog), comConsole);
      } catch (err) {
        // Pasta que nao e instalacao do WildFly e erro do usuario, nao do helper: a tela
        // mostra a mensagem ao lado do campo em vez de "helper indisponivel".
        if (err instanceof ConfigWildflyInvalidaError) {
          return reply.code(400).send({ error: err.message });
        }
        return responderErroHelper(reply, err);
      }
    },
  );

  /** Procura instalações do WildFly no disco, para não ter que digitar o caminho. */
  app.get('/api/infra/wildfly/detectar', async (_request, reply) => {
    try {
      return { instalacoes: normalizarLista(await wildfly.detectar()) };
    } catch (err) {
      return responderErroHelper(reply, err);
    }
  });

  /**
   * Estado das duas credenciais. Nunca devolve senha — so o nome de usuario e se ha
   * valor guardado, espelhando o `EnvVarStatus` do cofre de infra.
   */
  app.get('/api/sankhya/credenciais', async (_request, reply) => {
    try {
      return { credenciais: await Promise.all(SISTEMAS_SANKHYA.map((s) => credenciais.status(s))) };
    } catch (err) {
      return responderErroHelper(reply, err);
    }
  });

  app.post<{ Params: { sistema: string }; Body: { usuario?: unknown; senha?: unknown } }>(
    '/api/sankhya/credenciais/:sistema',
    async (request, reply) => {
      const { sistema } = request.params;
      if (!ehSistemaValido(sistema)) {
        return reply.code(404).send({ error: `sistema "${sistema}" não existe` });
      }

      const { usuario, senha } = request.body ?? {};
      if (typeof usuario !== 'string' || typeof senha !== 'string' || !usuario.trim() || !senha) {
        return reply.code(400).send({ error: 'envie { usuario, senha }' });
      }

      try {
        return await credenciais.gravar(sistema, usuario.trim(), senha);
      } catch (err) {
        return responderErroHelper(reply, err);
      }
    },
  );

  app.get('/api/sankhya/navegador', async (_request, reply) => {
    try {
      return await credenciais.statusNavegador();
    } catch (err) {
      return responderErroHelper(reply, err);
    }
  });

  /**
   * Abre a janela do hub na tela de login, e depois lê o cookie de sessão dela.
   *
   * Separado em dois passos de propósito: entre um e outro quem age é o usuário,
   * digitando a senha no navegador. O hub nunca vê a senha — só o cookie que sobra.
   */
  for (const acao of ['abrir', 'capturar'] as const) {
    app.post<{ Params: { sistema: string }; Body: { tela?: unknown; navegador?: unknown } }>(
      `/api/sankhya/navegador/${acao}/:sistema`,
      async (request, reply) => {
        const { sistema } = request.params;
        if (!ehSistemaValido(sistema)) {
          return reply.code(404).send({ error: `sistema "${sistema}" não existe` });
        }

        const texto = (valor: unknown) => (typeof valor === 'string' ? valor : '');

        try {
          if (acao === 'abrir') {
            return await credenciais.abrirNavegador(sistema, {
              tela: texto(request.body?.tela),
              navegador: texto(request.body?.navegador),
            });
          }

          const resultado = await credenciais.capturarSessao(sistema);
          if (!resultado.ok) {
            return reply.code(409).send({ error: resultado.erro ?? 'nenhum cookie capturado' });
          }
          return resultado;
        } catch (err) {
          return responderErroHelper(reply, err);
        }
      },
    );
  }

  app.post('/api/sankhya/navegador/fechar', async (_request, reply) => {
    try {
      return await credenciais.fecharNavegador();
    } catch (err) {
      return responderErroHelper(reply, err);
    }
  });

  /**
   * Lista os favoritos de um perfil pessoal, para virarem cadastro de cliente.
   *
   * GET e só leitura: o arquivo do usuário não é tocado. Quem escolhe o que vira
   * cliente é a tela — aqui nada é criado.
   */
  app.get<{ Querystring: { navegador?: string; perfil?: string } }>(
    '/api/sankhya/navegador/favoritos',
    async (request, reply) => {
      const navegador = request.query.navegador?.trim() ?? '';
      const perfil = request.query.perfil?.trim() ?? '';
      if (!navegador || !perfil) {
        return reply.code(400).send({ error: 'informe ?navegador=&perfil=' });
      }

      try {
        return await credenciais.listarFavoritos(navegador, perfil);
      } catch (err) {
        return responderErroHelper(reply, err);
      }
    },
  );

  /** Traz só os favoritos de um perfil pessoal — nada de senha, cookie ou histórico. */
  app.post<{ Body: { navegador?: unknown; perfil?: unknown } }>(
    '/api/sankhya/navegador/favoritos',
    async (request, reply) => {
      const navegador = String(request.body?.navegador ?? '');
      const perfil = String(request.body?.perfil ?? '');
      if (!navegador || !perfil) {
        return reply.code(400).send({ error: 'envie { navegador, perfil }' });
      }

      try {
        return await credenciais.importarFavoritos(navegador, perfil);
      } catch (err) {
        return responderErroHelper(reply, err);
      }
    },
  );

  app.delete<{ Params: { sistema: string } }>(
    '/api/sankhya/credenciais/:sistema',
    async (request, reply) => {
      const { sistema } = request.params;
      if (!ehSistemaValido(sistema)) {
        return reply.code(404).send({ error: `sistema "${sistema}" não existe` });
      }

      try {
        return await credenciais.remover(sistema);
      } catch (err) {
        return responderErroHelper(reply, err);
      }
    },
  );

  /**
   * Qual recurso da Agenda de Recursos é o usuário logado.
   *
   * Poupa digitar o mesmo username em todo cliente — na prática ele nunca muda, porque
   * a lane da agenda é do consultor e é sempre o mesmo consultor usando o painel.
   *
   * A dedução vem do e-mail da credencial (`flaviano.santos@…` -> `FLAVIANO.SANTOS`),
   * mas só é devolvida como `confirmado` quando existe um recurso com esse nome no
   * snapshot. Palpite não confirmado vai junto, marcado como tal: preencher a tela com
   * um username que não existe na agenda devolveria zero eventos sem explicar por quê.
   */
  app.get('/api/sankhya/usuario-agenda', async (_request, reply) => {
    let email = '';
    try {
      for (const sistema of SISTEMAS_SANKHYA) {
        const status = await credenciais.status(sistema);
        if (status.usuario) {
          email = status.usuario;
          break;
        }
      }
    } catch (err) {
      return responderErroHelper(reply, err);
    }

    if (!email) {
      return reply.code(404).send({ error: 'nenhuma credencial do Sankhya guardada ainda' });
    }

    const palpite = (email.split('@')[0] ?? '').toUpperCase();
    const recurso = agenda.recursos().find((r) => r.nomeusu.toUpperCase() === palpite);

    return {
      usuario: recurso?.nomeusu ?? palpite,
      codusu: recurso?.codusu ?? null,
      cargo: recurso?.descrcargo ?? '',
      confirmado: Boolean(recurso),
      origem: email,
    };
  });

  app.get('/api/clientes', async () => ({ clientes: clientes.listar() }));

  /**
   * Sugere o que dá para descobrir sozinho a partir do nome do cliente, ANTES de gravar.
   *
   * Fica separado do POST de propósito: o cadastro grava o que está na tela, e adivinhar
   * dentro do INSERT esconderia do usuário de onde veio o `codparc` que ele nunca digitou.
   */
  app.get<{ Querystring: { nome?: string; usuario?: string } }>(
    '/api/clientes/sugestao',
    async (request, reply) => {
      const nome = (request.query.nome ?? '').trim();
      if (!nome) return reply.code(400).send({ error: 'informe ?nome=<nome do cliente>' });

      const usuario = request.query.usuario ?? '';
      const parceiro = agenda.casarParceiro(nome, usuario);

      return {
        parceiro,
        // Sem parceiro não há dias: devolver a agenda inteira do consultor aqui daria a
        // impressão de que todo dia dele é dia deste cliente.
        atuacao: parceiro?.codparc === undefined || parceiro?.codparc === null
          ? null
          : agenda.atuacao(parceiro.codparc, usuario),
      };
    },
  );

  app.post<{ Body: unknown }>('/api/clientes', async (request, reply) => {
    const entrada = normalizarCliente(request.body);
    if (typeof entrada === 'string') return reply.code(400).send({ error: entrada });
    return reply.code(201).send(clientes.criar(entrada));
  });

  /**
   * Dias de atuação neste cliente, já resolvendo o `codparc` pelo cadastro.
   *
   * Só responde quando o cliente tem o parceiro amarrado — é o que o usuário pediu:
   * a informação cruzada aparece quando o cadastro está completo, e não antes.
   */
  app.get<{ Params: { id: string } }>('/api/clientes/:id/atuacao', async (request, reply) => {
    const cliente = clientes.obter(Number(request.params.id));
    if (!cliente) return reply.code(404).send({ error: 'cliente não encontrado' });

    if (cliente.agendaCodparc === null) {
      return reply.code(400).send({
        error: `"${cliente.nome}" ainda não tem o parceiro da Agenda amarrado no cadastro`,
        cadastroIncompleto: true,
      });
    }

    return agenda.atuacao(cliente.agendaCodparc, cliente.agendaRecursoUsuario);
  });

  app.get<{ Params: { id: string } }>('/api/clientes/:id', async (request, reply) => {
    const cliente = clientes.obter(Number(request.params.id));
    if (!cliente) return reply.code(404).send({ error: 'cliente não encontrado' });
    return cliente;
  });

  app.put<{ Params: { id: string }; Body: unknown }>('/api/clientes/:id', async (request, reply) => {
    const entrada = normalizarCliente(request.body);
    if (typeof entrada === 'string') return reply.code(400).send({ error: entrada });

    const cliente: Cliente | undefined = clientes.atualizar(Number(request.params.id), entrada);
    if (!cliente) return reply.code(404).send({ error: 'cliente não encontrado' });
    return cliente;
  });

  app.delete<{ Params: { id: string } }>('/api/clientes/:id', async (request, reply) => {
    if (!clientes.remover(Number(request.params.id))) {
      return reply.code(404).send({ error: 'cliente não encontrado' });
    }
    return { ok: true };
  });
}
