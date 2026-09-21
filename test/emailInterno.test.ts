/**
 * EmailInterno: senha do SMTP nunca em claro, contatos substituem a lista inteira, os
 * dois contatos fixos sempre entram no envio (com dedupe), e a config singleton não
 * duplica ao reabrir o banco.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Clientes } from '../src/sankhya/clientes.ts';
import { EmailInterno, type TransporteEmail } from '../src/sankhya/emailInterno.ts';
import type { HubHelper } from '../src/sankhya/helper.ts';
import type { ClienteEntrada } from '../src/types.ts';
import { dirTemporario } from './helpers.ts';

/** Mesma cifra de mentira do teste do cartão: prefixo, só para provar ida e volta. */
const helperFalso = {
  async requisitar<T>(caminho: string, init: RequestInit = {}): Promise<T> {
    const { valor } = JSON.parse(String(init.body ?? '{}')) as { valor: string };
    const resultado = caminho.endsWith('/encrypt') ? `cifrado:${valor}` : valor.replace(/^cifrado:/, '');
    return { valor: resultado } as T;
  },
} as unknown as HubHelper;

const CLIENTE: ClienteEntrada = {
  nome: 'Cliente de teste',
  experienceProjetoId: null,
  experiencePersonId: null,
  agendaRecursoUsuario: '',
  agendaCodparc: null,
  agendaDemandaId: '',
  sankhyaUrl: '',
  repositorioLocal: '',
  repositorioRemoto: '',
  anotacoes: '',
  anotacoesNotificar: false,
  demandaFim: '',
  emailFinalizacaoEm: '',
};

interface FabricaFalsaResultado {
  enviados: {
    from: string;
    to: string;
    subject: string;
    text: string;
    attachments?: { filename: string; content: Buffer; contentType?: string }[];
  }[];
  transporte: TransporteEmail;
}

function fabricaFalsa(): FabricaFalsaResultado {
  const enviados: FabricaFalsaResultado['enviados'] = [];
  const transporte: TransporteEmail = {
    verify: async () => true,
    sendMail: async (mensagem) => {
      enviados.push(mensagem);
      return undefined;
    },
  };
  return { enviados, transporte };
}

function comEmail(
  prova: (email: EmailInterno, clientes: Clientes, dir: string, enviados: FabricaFalsaResultado['enviados']) => void | Promise<void>,
) {
  return async () => {
    const dir = dirTemporario();
    const { enviados, transporte } = fabricaFalsa();
    const clientes = new Clientes(dir.path);
    const email = new EmailInterno(dir.path, helperFalso, () => transporte);
    try {
      await prova(email, clientes, dir.path, enviados);
    } finally {
      email.close();
      clientes.close();
      dir.remove();
    }
  };
}

const CONFIG_BASE = {
  smtpHost: 'smtp.gmail.com',
  smtpPorta: 465,
  smtpUsuario: 'hub@sankhya.com.br',
  smtpRemetente: 'Sankhya Hub',
  assinatura: '',
  liderImediato: { nome: 'Líder', email: 'lider@sankhya.com.br' },
  responsavelOrcamento: { nome: 'Orçamento', email: 'orcamento@sankhya.com.br' },
  resumoAnotacoes: { ativo: false, hora: '08:00' },
};

describe('EmailInterno — contatos do cliente', () => {
  test(
    'salvarContatos substitui a lista inteira, não acumula',
    comEmail((email, clientes) => {
      clientes.criar(CLIENTE);
      email.salvarContatos(1, [{ papel: 'consultor', nome: 'A', email: 'a@x.com' }]);
      email.salvarContatos(1, [
        { papel: 'gp', nome: 'B', email: 'b@x.com' },
        { papel: 'lider', nome: 'C', email: 'c@x.com' },
      ]);

      const lista = email.contatos(1);
      assert.equal(lista.length, 2, 'a segunda gravação substitui, não soma');
      assert.deepEqual(lista.map((c) => c.nome), ['B', 'C']);
    }),
  );

  test(
    'cada contato novo preserva a ordem em que foi mandado',
    comEmail((email, clientes) => {
      clientes.criar(CLIENTE);
      email.salvarContatos(1, [
        { papel: 'gp', nome: 'Primeiro', email: '' },
        { papel: 'consultor', nome: 'Segundo', email: '' },
      ]);
      assert.deepEqual(email.contatos(1).map((c) => c.nome), ['Primeiro', 'Segundo']);
    }),
  );
});

describe('EmailInterno — configuração global', () => {
  test(
    'a senha do SMTP nunca aparece em obterConfig()',
    comEmail(async (email) => {
      const config = await email.salvarConfig(CONFIG_BASE, 'app-password-secreta');
      assert.equal(config.temSenha, true);
      assert.ok(!JSON.stringify(config).includes('app-password-secreta'));
      assert.ok(!JSON.stringify(email.obterConfig()).includes('app-password-secreta'));
    }),
  );

  test(
    'salvar sem senha mantém a guardada; salvar com vazio apaga',
    comEmail(async (email) => {
      await email.salvarConfig(CONFIG_BASE, 'segredo');
      await email.salvarConfig({ ...CONFIG_BASE, smtpRemetente: 'Outro nome' });
      assert.equal(email.obterConfig().temSenha, true, 'sem `senha` no corpo, mantém');
      assert.equal(email.obterConfig().smtpRemetente, 'Outro nome');

      await email.salvarConfig(CONFIG_BASE, '');
      assert.equal(email.obterConfig().temSenha, false, "'' explícito apaga");
    }),
  );

  test(
    'reabrir o banco não duplica a linha singleton',
    comEmail(async (email, _clientes, dir) => {
      await email.salvarConfig(CONFIG_BASE, 'segredo');

      for (let i = 0; i < 3; i += 1) {
        const outra = new EmailInterno(dir, helperFalso);
        outra.close();
      }

      assert.equal(email.obterConfig().smtpUsuario, CONFIG_BASE.smtpUsuario);
    }),
  );
});

describe('EmailInterno — enviar', () => {
  test(
    'inclui os dois contatos fixos mesmo sem contato nenhum do cliente',
    comEmail(async (email, clientes, _dir, enviados) => {
      clientes.criar(CLIENTE);
      await email.salvarConfig(CONFIG_BASE, 'segredo');

      const resultado = await email.enviar(1, { assunto: 'Oi', corpo: 'Corpo' });

      assert.deepEqual(
        resultado.destinatarios.sort(),
        ['lider@sankhya.com.br', 'orcamento@sankhya.com.br'].sort(),
      );
      assert.equal(enviados.length, 1);
      assert.equal(enviados[0]?.subject, 'Oi');
    }),
  );

  test(
    'contato do cliente com o mesmo e-mail de um fixo não duplica destinatário',
    comEmail(async (email, clientes) => {
      clientes.criar(CLIENTE);
      await email.salvarConfig(CONFIG_BASE, 'segredo');
      email.salvarContatos(1, [
        { papel: 'consultor', nome: 'Consultor', email: 'consultor@x.com' },
        // Mesmo e-mail do líder fixo, em caixa diferente — dedupe é case-insensitive.
        { papel: 'gp', nome: 'Duplicado', email: 'LIDER@sankhya.com.br' },
      ]);

      const resultado = await email.enviar(1, { assunto: 'Oi', corpo: 'Corpo' });

      assert.equal(resultado.destinatarios.length, 3, 'consultor + líder + orçamento, sem duplicar');
    }),
  );

  test(
    'sem SMTP configurado, recusa enviar',
    comEmail(async (email, clientes) => {
      clientes.criar(CLIENTE);
      await assert.rejects(() => email.enviar(1, { assunto: 'Oi', corpo: 'Corpo' }));
    }),
  );

  test(
    'assinatura configurada entra ao final do corpo',
    comEmail(async (email, clientes, _dir, enviados) => {
      clientes.criar(CLIENTE);
      await email.salvarConfig({ ...CONFIG_BASE, assinatura: 'Att,\nEquipe Sankhya' }, 'segredo');

      await email.enviar(1, { assunto: 'Oi', corpo: 'Corpo da mensagem' });

      assert.equal(enviados[0]?.text, 'Corpo da mensagem\n\n--\nAtt,\nEquipe Sankhya');
    }),
  );

  test(
    'sem assinatura configurada, o corpo vai exatamente como digitado',
    comEmail(async (email, clientes, _dir, enviados) => {
      clientes.criar(CLIENTE);
      await email.salvarConfig(CONFIG_BASE, 'segredo');

      await email.enviar(1, { assunto: 'Oi', corpo: 'Corpo da mensagem' });

      assert.equal(enviados[0]?.text, 'Corpo da mensagem');
    }),
  );

  test(
    'anexo chega em attachments, decodificado de base64',
    comEmail(async (email, clientes, _dir, enviados) => {
      clientes.criar(CLIENTE);
      await email.salvarConfig(CONFIG_BASE, 'segredo');

      const conteudo = Buffer.from('conteudo do arquivo', 'utf8').toString('base64');
      await email.enviar(1, {
        assunto: 'Oi',
        corpo: 'Corpo',
        anexo: { nomeArquivo: 'evidencia.txt', tipoMime: 'text/plain', conteudoBase64: conteudo },
      });

      const anexos = enviados[0]?.attachments;
      assert.equal(anexos?.length, 1);
      assert.equal(anexos?.[0]?.filename, 'evidencia.txt');
      assert.equal(anexos?.[0]?.content.toString('utf8'), 'conteudo do arquivo');
    }),
  );
});
