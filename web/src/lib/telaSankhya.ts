const RESOURCE_ID = /^(?=.*\.)[A-Za-z0-9._-]+$/;
const REGISTRO = /^([A-Z0-9_]+)=(.+)$/;

function base64Utf8(valor: string): string {
  const bytes = new TextEncoder().encode(valor);
  let binario = '';
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario);
}

/** Monta link que o shell desktop intercepta para abrir uma tela numa aba de base. */
export function montarUrlTelaSankhya(baseUrl: string, resourceID: string, registro = ''): string {
  const recurso = resourceID.trim();
  if (!RESOURCE_ID.test(recurso)) {
    throw new Error('ID da tela inválido');
  }

  const destino = `${new URL(baseUrl).origin}/mge/system.jsp#app/${base64Utf8(recurso)}`;
  const registroLimpo = registro.trim();
  if (!registroLimpo) return destino;

  const partes = REGISTRO.exec(registroLimpo);
  if (!partes) throw new Error('Registro inválido; use CAMPO=valor');
  const campo = partes[1]!;
  const texto = partes[2]!;
  const valor = /^\d+$/.test(texto) ? Number(texto) : texto;
  return `${destino}/${base64Utf8(JSON.stringify({ [campo]: valor }))}`;
}
