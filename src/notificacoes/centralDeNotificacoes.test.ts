import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { RepositorioNotificacoesArquivo } from '../repositorio/repositorioNotificacoesArquivo.ts';
import type { Notificacao } from '../tipos.ts';
import { CentralDeNotificacoes, type DadosDeNotificacao } from './centralDeNotificacoes.ts';
import type { MensagemDeEmail } from './enviadorDeEmail.ts';

const registradorSilencioso = { info: () => {}, warn: () => {} };

let diretorio: string;
let emailsEnviados: MensagemDeEmail[];
let falhaDoEmail: Error | null;
let central: CentralDeNotificacoes;

function dados(campos: Partial<DadosDeNotificacao> = {}): DadosDeNotificacao {
  return {
    origem: 'lembrete',
    chave: 'lembrete:l1:2026-09-28T12:00:00.000Z',
    titulo: 'Lembrete',
    mensagem: 'Enviar relatório',
    enviarEmail: true,
    ...campos,
  };
}

beforeEach(async () => {
  diretorio = await mkdtemp(join(tmpdir(), 'hub-snk-notificacoes-'));
  emailsEnviados = [];
  falhaDoEmail = null;
  central = new CentralDeNotificacoes(
    new RepositorioNotificacoesArquivo(diretorio),
    {
      enviarPeloSmtpGravado: async (mensagem) => {
        if (falhaDoEmail) throw falhaDoEmail;
        emailsEnviados.push(mensagem);
      },
    },
    registradorSilencioso,
  );
});

afterEach(async () => {
  await rm(diretorio, { recursive: true, force: true });
});

describe('CentralDeNotificacoes', () => {
  it('grava, envia o e-mail e avisa quem está ouvindo', async () => {
    const ouvidas: Notificacao[] = [];
    central.assinar((notificacao) => ouvidas.push(notificacao));

    const notificacao = await central.emitir(dados());

    assert.equal(notificacao?.lida, false);
    assert.equal(emailsEnviados[0]?.assunto, '[HUB SNK] Lembrete');
    assert.equal(ouvidas.length, 1);
    assert.equal((await central.listar()).length, 1);
  });

  it('não repete a mesma chave, nem o e-mail', async () => {
    await central.emitir(dados());
    const repetida = await central.emitir(dados());

    assert.equal(repetida, null);
    assert.equal(emailsEnviados.length, 1);
  });

  it('não envia e-mail quando não é para enviar', async () => {
    await central.emitir(dados({ enviarEmail: false }));
    assert.equal(emailsEnviados.length, 0);
  });

  it('guarda o motivo da falha do e-mail e notifica assim mesmo', async () => {
    falhaDoEmail = new Error('535 autenticação recusada');

    const notificacao = await central.emitir(dados());

    assert.equal(notificacao?.erroDoEmail, '535 autenticação recusada');
    assert.equal((await central.listar()).length, 1);
  });

  it('limpar o painel não libera a chave para repetir', async () => {
    await central.emitir(dados());
    await central.limpar();

    assert.deepEqual(await central.listar(), []);
    assert.equal(await central.emitir(dados()), null);
  });

  it('marca como lidas só as pedidas, ou todas', async () => {
    const primeira = await central.emitir(dados({ chave: 'a' }));
    await central.emitir(dados({ chave: 'b' }));

    const depoisDeUma = await central.marcarComoLidas([primeira!.id]);
    assert.equal(depoisDeUma.filter((n) => n.lida).length, 1);

    const depoisDeTodas = await central.marcarComoLidas();
    assert.ok(depoisDeTodas.every((n) => n.lida));
  });
});
