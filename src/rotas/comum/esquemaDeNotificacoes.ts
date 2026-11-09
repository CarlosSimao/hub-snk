import { z } from 'zod';
import { MAXIMO_DE_DIAS_UTEIS_RETROATIVOS, SEGURANCAS_SMTP } from '../../tipos.ts';

/**
 * Validação do SMTP e do alerta da agenda.
 *
 * Fica fora dos arquivos de rota porque o SMTP chega por dois caminhos: gravado com o
 * resto da configuração e mandado sem gravar, para o e-mail de teste.
 */
const TAMANHO_MAXIMO_DO_HOST = 200;
const TAMANHO_MAXIMO_DO_USUARIO = 200;
const TAMANHO_MAXIMO_DA_SENHA = 200;
const TAMANHO_MAXIMO_DO_ENDERECO = 320;
const PORTA_MINIMA = 1;
const PORTA_MAXIMA = 65535;
const INTERVALO_MINIMO_DO_ALERTA_H = 1;
const INTERVALO_MAXIMO_DO_ALERTA_H = 24;
/* Folga larga para uma lista de cópia; o teto só barra lixo mandado direto na API. */
const MAXIMO_DE_CONTATOS_EM_COPIA = 50;

/* Vazio é aceito: SMTP sem host é o e-mail desligado, e não um erro de cadastro. */
const esquemaDeEnderecoOpcional = z
  .string()
  .trim()
  .max(TAMANHO_MAXIMO_DO_ENDERECO, 'O e-mail está longo demais.')
  .refine((valor) => valor === '' || z.email().safeParse(valor).success, 'E-mail inválido.');

export const esquemaDeSmtp = z.object({
  host: z
    .string()
    .trim()
    .max(TAMANHO_MAXIMO_DO_HOST, `O host deve ter no máximo ${TAMANHO_MAXIMO_DO_HOST} caracteres.`),
  porta: z.coerce
    .number({ error: 'A porta do SMTP deve ser um número.' })
    .int('A porta do SMTP deve ser um número inteiro.')
    .min(PORTA_MINIMA, `A porta do SMTP deve estar entre ${PORTA_MINIMA} e ${PORTA_MAXIMA}.`)
    .max(PORTA_MAXIMA, `A porta do SMTP deve estar entre ${PORTA_MINIMA} e ${PORTA_MAXIMA}.`),
  seguranca: z.enum(SEGURANCAS_SMTP, { error: 'Escolha a segurança do SMTP.' }),
  usuario: z.string().trim().max(TAMANHO_MAXIMO_DO_USUARIO, 'O usuário do SMTP está longo demais.'),
  senha: z.string().max(TAMANHO_MAXIMO_DA_SENHA, 'A senha do SMTP está longa demais.'),
  remetente: esquemaDeEnderecoOpcional,
  destinatario: esquemaDeEnderecoOpcional,
});

export const esquemaDeAlertaDaAgenda = z
  .object({
    ativo: z.boolean({ error: 'Informe se o alerta da agenda está ligado.' }),
    intervaloHoras: z.coerce
      .number({ error: 'A periodicidade deve ser um número.' })
      .int('A periodicidade deve ser um número inteiro de horas.')
      .min(
        INTERVALO_MINIMO_DO_ALERTA_H,
        `A periodicidade deve ser de pelo menos ${INTERVALO_MINIMO_DO_ALERTA_H} hora.`,
      )
      .max(
        INTERVALO_MAXIMO_DO_ALERTA_H,
        `A periodicidade deve ser de no máximo ${INTERVALO_MAXIMO_DO_ALERTA_H} horas.`,
      ),
    incluirProximoDiaUtil: z.boolean({
      error: 'Informe se o alerta monitora o próximo dia útil.',
    }),
    /* Padrão desligado: uma tela ainda não recarregada não manda o campo. */
    diasUteisRetroativos: z.coerce
      .number({ error: 'Os dias retroativos devem ser um número.' })
      .int('Os dias retroativos devem ser um número inteiro.')
      .min(0, 'Os dias retroativos não podem ser negativos.')
      .max(
        MAXIMO_DE_DIAS_UTEIS_RETROATIVOS,
        `Os dias retroativos devem ser no máximo ${MAXIMO_DE_DIAS_UTEIS_RETROATIVOS}.`,
      )
      .default(0),
    repetirAteResolver: z.boolean({ error: 'Informe se o alerta repete o aviso.' }),
    enviarEmail: z.boolean({ error: 'Informe se o alerta da agenda envia e-mail.' }),
    contatoIdsEmCopia: z
      .array(z.string({ error: 'Contato em cópia inválido.' }))
      .max(
        MAXIMO_DE_CONTATOS_EM_COPIA,
        `No máximo ${MAXIMO_DE_CONTATOS_EM_COPIA} contatos em cópia.`,
      )
      .default([]),
    /* Padrão desligado, pelo mesmo motivo dos dias retroativos. */
    diasParaGerencia: z.coerce
      .number({ error: 'Os dias para a gerência devem ser um número.' })
      .int('Os dias para a gerência devem ser um número inteiro.')
      .min(0, 'Os dias para a gerência não podem ser negativos.')
      .default(0),
  })
  /* Com o campo desabilitado na tela (sem e-mail ou sem janela), o valor guardado não vale. */
  .refine(
    (alerta) =>
      !alerta.enviarEmail ||
      alerta.diasUteisRetroativos === 0 ||
      alerta.diasParaGerencia <= alerta.diasUteisRetroativos,
    {
      error: 'Os dias para a gerência não podem passar dos dias úteis anteriores.',
      path: ['diasParaGerencia'],
    },
  );
