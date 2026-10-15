/**
 * Telas fictícias no lugar do WhatsApp Web e do Google (Gmail, Chat, Agenda e Meet) no
 * painel da barra de comunicação, para os roteiros mostrarem o painel aberto sem conta
 * real nem rede.
 *
 * Responde, nas duas partições da comunicação, os hosts dos serviços com
 * `comunicacao-ficticia.html` (o host escolhe a tela) e o feed do Gmail com 4 não lidas.
 * O título `(2) WhatsApp` e o favicon com `_dot_` acendem os contadores dos botões, como os
 * serviços de verdade. Qualquer outro endereço recebe 404: nada sai para a rede.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PAGINA = readFileSync(join(AQUI, 'comunicacao-ficticia.html'), 'utf8');
const PARTICOES = ['persist:hub-whatsapp', 'persist:hub-google'];
const HOSTS = [
  'web.whatsapp.com',
  'mail.google.com',
  'chat.google.com',
  'calendar.google.com',
  'meet.google.com',
];
const FEED_DO_GMAIL = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://purl.org/atom/ns#" version="0.3">
  <title>Gmail - Caixa de entrada de ana.souza@consultoria.example</title>
  <fullcount>4</fullcount>
</feed>`;

export async function servirComunicacaoFicticia(aplicativo) {
  await aplicativo.evaluate(
    ({ session }, [particoes, hosts, pagina, feed]) => {
      for (const particao of particoes) {
        session.fromPartition(particao).protocol.handle('https', (requisicao) => {
          const { hostname, pathname } = new URL(requisicao.url);
          if (!hosts.includes(hostname) || pathname.endsWith('.png')) {
            return new Response('', { status: 404 });
          }
          if (pathname.endsWith('/feed/atom')) {
            return new Response(feed, { headers: { 'content-type': 'application/atom+xml' } });
          }
          return new Response(pagina, { headers: { 'content-type': 'text/html; charset=utf-8' } });
        });
      }
    },
    [PARTICOES, HOSTS, PAGINA, FEED_DO_GMAIL],
  );
}
