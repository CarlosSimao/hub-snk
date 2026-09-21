/**
 * Agenda de um cliente, vinda do Sankhya Experience.
 *
 * O painel manda o id do cliente e o mês; quem traduz isso para `experienceProjetoId` e
 * `experiencePersonId` é o backend — o navegador não precisa saber esses números, e
 * mandá-los pela URL deixaria a tela livre para consultar projeto de qualquer um.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { limitesDoMes } from './calendario.ts';
import { HelperError, HelperIndisponivelError } from './sankhya/helper.ts';
import { SessaoExpiradaError, type Experience } from './sankhya/experience.ts';
import type { Clientes } from './sankhya/clientes.ts';
import type { AgendaRecursos } from './sankhya/agenda.ts';

export interface RouteExperienceDeps {
  experience: Experience;
  clientes: Clientes;
  agenda: AgendaRecursos;
}

function responderErro(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof SessaoExpiradaError) {
    return reply.code(409).send({ error: err.message, sessaoExpirada: true });
  }
  if (err instanceof HelperIndisponivelError) {
    return reply.code(503).send({ error: err.message, helperIndisponivel: true });
  }
  if (err instanceof HelperError) {
    return reply.code(err.status).send({ error: err.message });
  }
  // Falha da API da Experience é 502, não 500: o defeito está do outro lado, e a
  // mensagem dela ("Código do Erro: ...") é o que a tela precisa mostrar.
  return reply.code(502).send({ error: (err as Error).message });
}

/**
 * Teto de OS por consulta de detalhe.
 *
 * Cada uma e uma requisicao propria a Experience; um dia com mais de dez OS lancadas
 * nao existe na pratica, e o numero redondo evita que um `?ids=` colado a mao vire
 * centenas de chamadas.
 */
const MAX_DETALHES_OS = 20;

/** Um dia no formato `YYYY-MM-DD`. */
function ehDia(valor: string | undefined): valor is string {
  return typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor);
}


export function registerRoutesExperience(app: FastifyInstance, deps: RouteExperienceDeps): void {
  const { experience, clientes, agenda } = deps;

  /**
   * Todos os clientes de uma vez, para a visão consolidada do mês.
   *
   * Devolve a agenda CRUA de cada um em vez de um resumo pronto: quem classifica em
   * verde/amarelo/vermelho é o mesmo código que desenha o calendário, e calcular aqui
   * também criaria duas implementações da mesma regra para sair do ar uma com a outra.
   */
  app.get<{ Querystring: { mes?: string } }>(
    '/api/experience/resumo',
    async (request, reply) => {
      const limites = limitesDoMes(request.query.mes ?? '');
      if (!limites) return reply.code(400).send({ error: 'informe ?mes=YYYY-MM' });

      // Uma sessão vencida derruba todos os clientes pelo mesmo motivo; melhor dizer
      // isso uma vez do que repetir o erro em cada linha da tela.
      try {
        await experience.verificarSessao();
      } catch (err) {
        return responderErro(reply, err);
      }

      const resultados = await Promise.all(
        clientes.listar().map(async (cliente) => {
          // A agenda do ERP é snapshot local: responde mesmo quando a Experience está
          // fora, e sem parceiro no cadastro não há o que recortar — a lane inteira
          // encheria o dia deste cliente com evento de todos os outros.
          const eventos =
            cliente.agendaCodparc === null
              ? []
              : agenda.eventos(
                  `${limites.de} 00:00:00`,
                  `${limites.ate} 23:59:59`,
                  cliente.agendaRecursoUsuario,
                  cliente.agendaCodparc,
                );

          if (cliente.experienceProjetoId === null || cliente.experiencePersonId === null) {
            return { cliente, eventos, erro: 'cadastro sem ID do projeto ou person_id' };
          }

          try {
            const [tarefas, ordens] = await Promise.all([
              experience.tarefas(cliente.experienceProjetoId, cliente.experiencePersonId),
              experience.ordens(
                cliente.experienceProjetoId,
                cliente.experiencePersonId,
                limites.de,
                limites.ate,
              ),
            ]);
            return { cliente, eventos, agenda: { tarefas, ordens } };
          } catch (err) {
            // Um cliente que falha não pode apagar os outros da tela.
            return { cliente, eventos, erro: (err as Error).message };
          }
        }),
      );

      return { clientes: resultados };
    },
  );

  /**
   * As OS lançadas num projeto, para acompanhar.
   *
   * Só o ID do projeto basta — nem cliente cadastrado, nem `person_id`. É a consulta de
   * quem quer olhar um projeto inteiro, inclusive o que os outros lançaram, e não a
   * agenda de um cliente do próprio cadastro.
   *
   * `?soMinhas=1` estreita para as próprias, resolvendo o `person_id` pelo e-mail da
   * sessão — o mesmo caminho do botão "Descobrir" do cadastro.
   */
  app.get<{ Querystring: { projetoId?: string; de?: string; ate?: string; soMinhas?: string } }>(
    '/api/experience/ordens',
    async (request, reply) => {
      const projetoId = Number(request.query.projetoId);
      if (!Number.isInteger(projetoId) || projetoId <= 0) {
        return reply.code(400).send({ error: 'informe ?projetoId=<número>' });
      }

      const { de, ate } = request.query;
      if (!ehDia(de) || !ehDia(ate)) {
        return reply.code(400).send({ error: 'informe ?de= e ?ate= no formato YYYY-MM-DD' });
      }
      if (ate < de) {
        return reply.code(400).send({ error: 'a data final precisa ser depois da inicial' });
      }

      try {
        let personId: number | null = null;
        if (request.query.soMinhas === '1') {
          const eu = await experience.descobrirPersonId(projetoId);
          if (!eu) {
            return reply.code(404).send({
              error: 'você não aparece na lista de pessoas desse projeto — confira o ID',
            });
          }
          personId = eu.personId;
        }

        return { ordens: await experience.ordens(projetoId, personId, de, ate) };
      } catch (err) {
        return responderErro(reply, err);
      }
    },
  );

  /**
   * Descobre o `person_id` do usuário logado num projeto, para o cadastro não depender
   * de o usuário ir catar esse número na mão.
   */
  app.get<{ Querystring: { projetoId?: string } }>(
    '/api/experience/person-id',
    async (request, reply) => {
      const projetoId = Number(request.query.projetoId);
      if (!Number.isInteger(projetoId) || projetoId <= 0) {
        return reply.code(400).send({ error: 'informe ?projetoId=<número>' });
      }

      try {
        const achado = await experience.descobrirPersonId(projetoId);
        if (!achado) {
          return reply.code(404).send({
            error: 'você não aparece na lista de pessoas desse projeto — confira o ID do projeto',
          });
        }
        return achado;
      } catch (err) {
        return responderErro(reply, err);
      }
    },
  );

  /**
   * O texto de "Tarefas Realizadas" das OS pedidas.
   *
   * Uma chamada da Experience por OS — por isso a tela pede so as do dia aberto, e o
   * teto existe para que uma URL montada a mao nao vire uma rajada contra a API deles.
   *
   * Uma OS que falhar nao derruba as outras: a resposta traz o que deu certo. O dia
   * inteiro sumir da tela por causa de uma OS seria pior que a OS aparecer sem texto.
   */
  app.get<{ Querystring: { ids?: string } }>(
    '/api/experience/os/detalhes',
    async (request, reply) => {
      const ids = [
        ...new Set(
          (request.query.ids ?? '')
            .split(',')
            .map((parte) => Number(parte.trim()))
            .filter((id) => Number.isInteger(id) && id > 0),
        ),
      ];
      if (!ids.length) return reply.code(400).send({ error: 'informe ?ids=1,2,3' });
      if (ids.length > MAX_DETALHES_OS) {
        return reply.code(400).send({ error: `no máximo ${MAX_DETALHES_OS} OS por consulta` });
      }

      try {
        const resultados = await Promise.allSettled(ids.map((id) => experience.detalharOrdem(id)));

        // Sessão vencida é de todas, não de uma: devolver 200 com a lista vazia
        // esconderia o único erro que a tela sabe resolver.
        const expirada = resultados.find(
          (r) => r.status === 'rejected' && r.reason instanceof SessaoExpiradaError,
        );
        if (expirada && expirada.status === 'rejected') return responderErro(reply, expirada.reason);

        return {
          detalhes: resultados.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : [])),
        };
      } catch (err) {
        return responderErro(reply, err);
      }
    },
  );

  /**
   * Lê tudo que o modal "Gerar OS" precisa. Só leitura: nenhuma destas chamadas cria OS.
   */
  app.post<{ Body: { clienteId?: unknown; tarefaIds?: unknown } }>(
    '/api/experience/os/preparar',
    async (request, reply) => {
      const cliente = clientes.obter(Number(request.body?.clienteId));
      if (!cliente?.experienceProjetoId || !cliente.experiencePersonId) {
        return reply.code(400).send({ error: 'cliente sem ID do projeto ou person_id no cadastro' });
      }

      const ids = Array.isArray(request.body?.tarefaIds) ? request.body.tarefaIds.map(Number) : [];
      if (!ids.length) return reply.code(400).send({ error: 'selecione ao menos uma tarefa' });

      try {
        const tarefas = (
          await experience.tarefas(cliente.experienceProjetoId, cliente.experiencePersonId)
        ).filter((t) => ids.includes(t.id));

        if (tarefas.length !== ids.length) {
          return reply.code(404).send({ error: 'alguma das tarefas não está mais em aberto' });
        }
        return await experience.prepararOrdem(cliente.experienceProjetoId, tarefas);
      } catch (err) {
        return responderErro(reply, err);
      }
    },
  );

  /**
   * CRIA a ordem de serviço de verdade.
   *
   * Com `enviarParaAprovacao`, dispara e-mail para o CLIENTE — o hub não desfaz isso. Por
   * isso a rota é POST, exige a lista explícita de tarefas e nunca é chamada por
   * carregamento de tela, só por clique.
   */
  app.post<{ Body: Record<string, unknown> }>('/api/experience/os', async (request, reply) => {
    const corpo = request.body ?? {};
    const cliente = clientes.obter(Number(corpo['clienteId']));
    if (!cliente?.experienceProjetoId || !cliente.experiencePersonId) {
      return reply.code(400).send({ error: 'cliente sem ID do projeto ou person_id no cadastro' });
    }

    const ids = Array.isArray(corpo['tarefaIds']) ? (corpo['tarefaIds'] as unknown[]).map(Number) : [];
    const dia = String(corpo['dia'] ?? '');
    const horaInicio = String(corpo['horaInicio'] ?? '');
    const horaFim = String(corpo['horaFim'] ?? '');

    if (!ids.length) return reply.code(400).send({ error: 'selecione ao menos uma tarefa' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
      return reply.code(400).send({ error: 'informe o dia no formato YYYY-MM-DD' });
    }
    if (!/^\d{2}:\d{2}$/.test(horaInicio) || !/^\d{2}:\d{2}$/.test(horaFim)) {
      return reply.code(400).send({ error: 'informe hora inicial e final no formato HH:MM' });
    }
    if (horaFim <= horaInicio) {
      return reply.code(400).send({ error: 'a hora final precisa ser depois da inicial' });
    }

    try {
      const tarefas = (
        await experience.tarefas(cliente.experienceProjetoId, cliente.experiencePersonId)
      ).filter((t) => ids.includes(t.id));

      if (tarefas.length !== ids.length) {
        return reply.code(404).send({ error: 'alguma das tarefas não está mais em aberto' });
      }

      return await experience.criarOrdem({
        projetoId: cliente.experienceProjetoId,
        personId: cliente.experiencePersonId,
        dia,
        horaInicio,
        horaFim,
        intervalo: String(corpo['intervalo'] ?? '01:00'),
        observacoes: String(corpo['observacoes'] ?? ''),
        notas: String(corpo['notas'] ?? ''),
        tarefas,
        enviarParaAprovacao: corpo['enviarParaAprovacao'] === true,
      });
    } catch (err) {
      return responderErro(reply, err);
    }
  });

  app.get<{ Querystring: { clienteId?: string; mes?: string } }>(
    '/api/experience/agenda',
    async (request, reply) => {
      const cliente = clientes.obter(Number(request.query.clienteId));
      if (!cliente) return reply.code(404).send({ error: 'cliente não encontrado' });

      if (cliente.experienceProjetoId === null || cliente.experiencePersonId === null) {
        return reply.code(400).send({
          error: `"${cliente.nome}" ainda não tem o ID do projeto e o person_id preenchidos no cadastro`,
          cadastroIncompleto: true,
        });
      }

      const limites = limitesDoMes(request.query.mes ?? '');
      if (!limites) return reply.code(400).send({ error: 'informe ?mes=YYYY-MM' });

      try {
        // Em paralelo: são dois endpoints independentes e a tela precisa dos dois para
        // saber quais tarefas do dia ainda não viraram OS.
        const [tarefas, ordens] = await Promise.all([
          experience.tarefas(cliente.experienceProjetoId, cliente.experiencePersonId),
          experience.ordens(
            cliente.experienceProjetoId,
            cliente.experiencePersonId,
            limites.de,
            limites.ate,
          ),
        ]);

        return { tarefas, ordens };
      } catch (err) {
        return responderErro(reply, err);
      }
    },
  );

  /**
   * Gera aceite (e, se pedido, dispara e-mail) de uma OS JÁ LANÇADA — sem recriá-la.
   * `orderId` vem da URL; `projetoId`/`personId` vêm sempre do cadastro, nunca do
   * corpo da requisição, pelo mesmo motivo de `/api/experience/os`: quem chama não
   * decide de qual pessoa/projeto a escrita sai.
   *
   * Verificação de identidade: antes de escrever, confirma que o e-mail do JWT da
   * sessão Experience autenticada AGORA resolve para o mesmo `person_id` que o
   * cadastro espera (mesmo mecanismo de `GET /api/experience/person-id`). Isso NÃO
   * é uma reautenticação completa — só confirma que a sessão de sistema atualmente
   * capturada pertence à mesma pessoa do cadastro antes de um efeito irreversível
   * (e-mail ao cliente). A autoridade real continua sendo a própria API da
   * Experience: se ela aceitar a chamada, a operação é válida por conta dela.
   *
   * ATENÇÃO: `enviarEmail: true` manda e-mail para o CLIENTE. Não é reversível pelo hub.
   */
  app.post<{ Params: { orderId: string }; Body: { clienteId?: unknown; enviarEmail?: unknown } }>(
    '/api/experience/os/:orderId/aceite',
    async (request, reply) => {
      const orderId = Number(request.params.orderId);
      if (!Number.isInteger(orderId) || orderId <= 0) {
        return reply.code(400).send({ error: 'orderId inválido' });
      }

      const cliente = clientes.obter(Number(request.body?.clienteId));
      if (!cliente?.experienceProjetoId || !cliente.experiencePersonId) {
        return reply.code(400).send({ error: 'cliente sem ID do projeto ou person_id no cadastro' });
      }

      try {
        const eu = await experience.descobrirPersonId(cliente.experienceProjetoId);
        if (!eu || eu.personId !== cliente.experiencePersonId) {
          return reply.code(409).send({
            error:
              'a sessão Experience autenticada agora não corresponde à pessoa esperada para este cliente — recapture a sessão certa antes de gerar aceite',
            identidadeDivergente: true,
          });
        }

        const enviarEmail = request.body?.enviarEmail === true;
        return await experience.gerarAceite(orderId, cliente.experienceProjetoId, cliente.experiencePersonId, {
          enviarEmail,
        });
      } catch (err) {
        return responderErro(reply, err);
      }
    },
  );
}
