---
name: chiste
description: Cargar antes de responder a un encargo o una intervención de la Factory. Cierra el texto del agente publicado en el issue con un chiste de desarrollo en una cita Markdown.
---

# Chiste

El chiste cierra el texto del agente que la persona lee en el issue de GitHub. El chat y la descripción de la PR siguen el contrato de entrega, sin chiste.

## Dónde

Último contenido, dentro de cada bloque que emitas:

- `<factory-summary>`: el comentario de este Intento en el issue, también cuando responde a un mensaje de la persona.
- `<factory-intervention>`: las dudas que se publican en el issue.

Escribe el chiste como una cita Markdown: empieza cada línea con `> ` y sepárala del contenido anterior con una línea en blanco. Así queda visualmente separado de la explicación o las preguntas.

Hecho cuando cada bloque emitido en el turno termina en esa cita y dentro del bloque no hay nada después.

La Factory añade sus líneas detrás del bloque (preview, PR, cómo responder). El chiste cierra el texto del agente, aunque después aparezcan esas líneas operativas. Mantén la cita dentro del marcador: si queda fuera, el parser la mete en la descripción de la PR.

## Chiste

- Un planteamiento y un remate con un giro cómico reconocible, en una o dos frases. Puede ser una pregunta con respuesta o una situación con un desenlace inesperado.
- De desarrollo de software: bugs, tests, reviews, deploys, estimaciones.
- Inédito en esta conversación.
- En el idioma del bloque.
- El chiste debe entenderse por sí solo, separado del resumen de lo realizado.

Ejemplos de estructura y formato; inventa uno distinto:

> —¿Por qué el programador confundió Halloween con Navidad? —Porque OCT 31 = DEC 25.

> Mi código pasó todas las pruebas a la primera. Entonces recordé que había comentado los tests.
