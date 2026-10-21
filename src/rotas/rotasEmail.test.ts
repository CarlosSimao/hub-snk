import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import type { MensagemDeEmail } from '../notificacoes/enviadorDeEmail.ts';
import { RepositorioContatosArquivo } from '../repositorio/arquivo/repositorioContatosArquivo.ts';
import { registrarRotasDeEmail } from './rotasEmail.ts';

let diretorio: string;
let servidor: FastifyInstance;
let enviadas: MensagemDeEmail[];
let ana: string;
let bruno: string;
let semEmail: string;

beforeEach(async () => {
  diretorio = await mkdtemp(join(tmpdir(), 'hub-snk-rotas-email-'));
  const contatos = new RepositorioContatosArquivo(diretorio);
  const base = { telefone: '', cargo: '', clienteId: null };
  ana = (await contatos.criar({ ...base, nome: 'Ana', email: 'ana@alfa.com' })).id;
  bruno = (await contatos.criar({ ...base, nome: 'Bruno', email: 'bruno@alfa.com' })).id;
  semEmail = (await contatos.criar({ ...base, nome: 'Caio', email: '' })).id;
  enviadas = [];
  servidor = Fastify();
  registrarRotasDeEmail(servidor, contatos, {
    enviarPeloSmtpGravado: async (mensagem) => void enviadas.push(mensagem),
  });
});

afterEach(async () => {
  await rm(diretorio, { recursive: true, force: true });
});

function enviar(payload: Record<string, unknown>) {
  return servidor.inject({ method: 'POST', url: '/api/email', payload });
}

describe('POST /api/email', () => {
  it('envia para os contatos, com cópia, cópia oculta e anexo', async () => {
    const resposta = await enviar({
      para: [ana],
      copiaOculta: [bruno],
      assunto: 'Reunião',
      corpo: [{ marca: 'div', filhos: ['Olá'] }],
      anexos: [{ nome: 'ata.txt', tipo: 'text/plain', conteudoBase64: 'b2k=' }],
    });

    assert.equal(resposta.statusCode, 200);
    const [email] = enviadas;
    assert.deepEqual(email?.para, ['ana@alfa.com']);
    assert.deepEqual(email?.copiaOculta, ['bruno@alfa.com']);
    assert.equal(email?.anexos?.[0]?.conteudo.toString(), 'oi');
  });

  it('recusa sem destinatário', async () => {
    const resposta = await enviar({ para: [], assunto: 'x' });

    assert.equal(resposta.statusCode, 400);
    assert.match(resposta.json().mensagem, /destinatário/);
  });

  it('recusa contato sem e-mail e contato repetido em dois campos', async () => {
    const semEndereco = await enviar({ para: [semEmail] });
    const repetido = await enviar({ para: [ana], copia: [ana] });

    assert.match(semEndereco.json().mensagem, /não tem e-mail/);
    assert.match(repetido.json().mensagem, /mais de um campo/);
    assert.equal(enviadas.length, 0);
  });

  it('recusa formatação fora da lista', async () => {
    const resposta = await enviar({ para: [ana], corpo: [{ marca: 'script', filhos: ['x'] }] });

    assert.equal(resposta.statusCode, 400);
  });
});
