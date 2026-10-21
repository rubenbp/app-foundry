---
name: chiste
description: Chiste de desarrollo. Cargarla antes de producir código; el cuerpo lo cierra dentro del texto que la Factory publica en el issue.
---

# Chiste

El chiste cierra el texto del agente que la persona lee en el issue de GitHub. El chat y la descripción de la PR siguen el contrato de entrega, sin chiste.

## Dónde

Último párrafo, dentro del bloque:

- `<factory-summary>`: el comentario de este Intento en el issue, también cuando responde a un mensaje de la persona.
- `<factory-intervention>`: las dudas que se publican en el issue.

Hecho cuando cada bloque emitido en el turno termina en el chiste y dentro del bloque no hay nada después.

La Factory añade sus líneas detrás del bloque (preview, PR, cómo responder). El chiste no sale del marcador: si queda fuera, el parser lo mete en la descripción de la PR.

## Chiste

- Una o dos frases, leídas de un tirón.
- De desarrollo de software: bugs, tests, reviews, deploys, estimaciones.
- Inédito en esta conversación.
- En el idioma del bloque.
- Separado del contenido por una línea en blanco.

Tono, no para copiar:

- «El bug se fue. Dejó la silla caliente.»
- «Funciona en mi máquina. Mi máquina ya no responde.»
