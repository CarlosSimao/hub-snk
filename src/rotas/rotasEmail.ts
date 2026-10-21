/**
 * E-mail escrito pela pessoa no HUB SNK, para os contatos cadastrados, pelo SMTP gravado.
 *
 * Os destinatários chegam como ids de contato, e não como endereços: só vai para quem
 * está cadastrado, mesmo chamando a API direto. Os anexos vão em base64 dentro do JSON,
 * como no Kanban: o projeto não tem plugin de multipart.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { MARCAS_DO_CORPO, montarEmailAvulso, type NoDoCorpo } from '../notificacoes/emailAvulso.ts';
import type { AnexoDeEmail, EnviadorDeEmail } from '../notificacoes/enviadorDeEmail.ts';
import type { RepositorioContatos } from '../repositorio/repositorioContatos.ts';
import { responderFalhaDoEnvio } from './comum/respostaDoEnvioDeEmail.ts';

/* O Gmail recusa acima de 25 MB; o base64 do SMTP ainda engorda o anexo em 1/3. */
const MEGABYTE = 1024 * 1024;
const LIMITE_DOS_ANEXOS_BYTES = 18 * MEGABYTE;
/** O corpo JSON cresce cerca de 1/3 com o base64: daí o limite da rota ser maior. */
const LIMITE_DO_CORPO_BYTES = 26 * MEGABYTE;
const TAMANHO_MAXIMO_DO_ASSUNTO = 300;
const TAMANHO_MAXIMO_DO_NOME_DO_ANEXO = 255;
const TAMANHO_MAXIMO_DO_LINK = 2000;

const esquemaDoNo: z.ZodType<NoDoCorpo> = z.lazy(() =>
  z.union([
    z.string(),
    z.object({
      marca: z.enum(MARCAS_DO_CORPO, { error: 'Formatação não suportada no corpo.' }),
      filhos: z.array(esquemaDoNo),
      href: z.string().max(TAMANHO_MAXIMO_DO_LINK).optional(),
    }),
  ]),
);

const esquemaDeIds = z.array(z.string()).default([]);

const esquemaDoEmail = z.object({
  para: z
    .array(z.string(), { error: 'Informe os destinatários.' })
    .min(1, { error: 'Informe ao menos um destinatário.' }),
  copia: esquemaDeIds,
  copiaOculta: esquemaDeIds,
  assunto: z
    .string()
    .trim()
    .max(TAMANHO_MAXIMO_DO_ASSUNTO, { error: 'Assunto longo demais.' })
    .default(''),
  corpo: z.array(esquemaDoNo).default([]),
  anexos: z
    .array(
      z.object({
        nome: z.string().trim().min(1).max(TAMANHO_MAXIMO_DO_NOME_DO_ANEXO),
        tipo: z.string().max(TAMANHO_MAXIMO_DO_NOME_DO_ANEXO).default(''),
        conteudoBase64: z.string(),
      }),
    )
    .default([]),
});

type DadosDoEmail = z.infer<typeof esquemaDoEmail>;

interface Destinatarios {
  para: string[];
  copia: string[];
  copiaOculta: string[];
}

type Resultado<T> = { valor: T } | { mensagem: string };

function decodificarAnexos(anexos: DadosDoEmail['anexos']): Resultado<AnexoDeEmail[]> {
  const decodificados = anexos.map((anexo) => ({
    nomeDoArquivo: anexo.nome,
    tipo: anexo.tipo,
    conteudo: Buffer.from(anexo.conteudoBase64, 'base64'),
  }));
  const total = decodificados.reduce((soma, anexo) => soma + anexo.conteudo.length, 0);
  if (total > LIMITE_DOS_ANEXOS_BYTES) {
    return { mensagem: `Os anexos passam de ${LIMITE_DOS_ANEXOS_BYTES / MEGABYTE} MB.` };
  }
  return { valor: decodificados };
}

function responderMensagem(resposta: FastifyReply, mensagem: string): FastifyReply {
  return resposta.status(400).send({ mensagem });
}

/** Rota do e-mail escrito pela pessoa: o formulário "Novo e-mail" da tela de Contatos. */
export function registrarRotasDeEmail(
  servidor: FastifyInstance,
  contatos: RepositorioContatos,
  enviadorDeEmail: Pick<EnviadorDeEmail, 'enviarPeloSmtpGravado'>,
): void {
  /** Os e-mails de cada campo; o mesmo contato em dois campos é engano de quem escreveu. */
  async function resolverDestinatarios(dados: DadosDoEmail): Promise<Resultado<Destinatarios>> {
    const cadastrados = await contatos.listar();
    const vistos = new Set<string>();
    const resolver = (ids: string[]): Resultado<string[]> => {
      const emails: string[] = [];
      for (const id of ids) {
        const contato = cadastrados.find((item) => item.id === id);
        if (!contato) return { mensagem: 'Contato não encontrado.' };
        if (contato.email === '') return { mensagem: `O contato ${contato.nome} não tem e-mail.` };
        if (vistos.has(id)) {
          return { mensagem: `O contato ${contato.nome} aparece em mais de um campo.` };
        }
        vistos.add(id);
        emails.push(contato.email);
      }
      return { valor: emails };
    };

    const para = resolver(dados.para);
    if ('mensagem' in para) return para;
    const copia = resolver(dados.copia);
    if ('mensagem' in copia) return copia;
    const copiaOculta = resolver(dados.copiaOculta);
    if ('mensagem' in copiaOculta) return copiaOculta;
    return { valor: { para: para.valor, copia: copia.valor, copiaOculta: copiaOculta.valor } };
  }

  servidor.post(
    '/api/email',
    { bodyLimit: LIMITE_DO_CORPO_BYTES },
    async (requisicao, resposta) => {
      const dados = esquemaDoEmail.safeParse(requisicao.body);
      if (!dados.success) {
        return responderMensagem(resposta, dados.error.issues[0]?.message ?? 'Dados inválidos.');
      }

      const destinatarios = await resolverDestinatarios(dados.data);
      if ('mensagem' in destinatarios) return responderMensagem(resposta, destinatarios.mensagem);
      const anexos = decodificarAnexos(dados.data.anexos);
      if ('mensagem' in anexos) return responderMensagem(resposta, anexos.mensagem);

      try {
        await enviadorDeEmail.enviarPeloSmtpGravado(
          montarEmailAvulso({
            ...destinatarios.valor,
            assunto: dados.data.assunto,
            corpo: dados.data.corpo,
            anexos: anexos.valor,
          }),
        );
      } catch (erro) {
        return responderFalhaDoEnvio(resposta, erro);
      }

      return { mensagem: `E-mail enviado para ${destinatarios.valor.para.join(', ')}.` };
    },
  );
}
