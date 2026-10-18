# 6. Guía práctica de un issue completo

[Índice](README.md) · [Anterior](05-variantes-e-intervencion.md)

## Ejemplo: cambiar un pie y comprobar su enlace

El ejemplo es una plantilla de petición, no un issue ya creado ni una garantía sobre los selectores actuales del producto. Los selectores y textos deben revisarse antes de autorizar.

Crear el issue en el repositorio del **Managed project**, con un título como «Actualizar el mensaje del pie y conservar la vuelta al inicio» y este cuerpo:

````markdown
## Objetivo

Mostrar «Otra partida.» en el pie y permitir volver al inicio desde la página Sobre.

## Criterios de aceptación

- [ ] La página de inicio muestra «Otra partida.» en el texto del pie.
- [ ] El enlace del pie de la página Sobre permite volver al inicio.

## Comprobaciones de producción

```factory-production
[
  {
    "criterion": 1,
    "path": "/",
    "selector": "footer p",
    "text": "Otra partida."
  },
  {
    "criterion": 2,
    "path": "/sobre/",
    "selector": "footer a",
    "href": "/",
    "follow": true
  }
]
```
````

La primera comprobación prueba el texto visible en el inicio. La segunda exige un único enlace visible en el pie de Sobre, con destino `/`, y comprueba que al pulsarlo se llega correctamente al inicio.

El número `criterion` sigue el orden de la lista. La sección separada evita que el bloque técnico forme parte del texto de un criterio. Si cambia el orden, deben revisarse las referencias antes de autorizar.

## Pasos de la persona responsable

1. **Revisar la petición.** Confirmar objetivo, criterios observables y comprobaciones públicas. Si el comportamiento no se puede expresar con el plan actual, ampliar la capacidad de verificación antes de usarlo para cerrar ese trabajo.
2. **Autorizar en GitHub.** Una persona con escritura aplica `factory:ready` al contenido estable. Si aún no se admite por ambigüedad, revisar la causa y volver a aplicar la etiqueta tras estabilizarlo.
3. **Seguir la Ejecución.** Abrir el panel local y comprobar si espera turno, prepara, trabaja o requiere intervención. Una petición admitida no se cancela quitando la etiqueta.
4. **Revisar la PR y su informe.** Leer el diff completo, resultados y lagunas. Confirmar que el SHA informado es el del Commit candidato vigente.
5. **Probar la preview.** Revisar cada criterio en la URL del informe. Comprobar el resultado visible y la navegación, además de las pruebas técnicas.
6. **Aceptar o pedir corrección.** Si el resultado es correcto, copiar el ejemplo del informe con SHA completo y URL. Publicarlo como comentario nuevo en el issue o la conversación principal de la PR. Si no es correcto, una orden reconocida como `Corrige el texto del pie.` revoca el control y requiere intervención; hoy no lanza otro Intento.
7. **Realizar el merge.** Esperar `Factory / ready-to-merge: success` y los demás controles exigidos. Hacer el merge en GitHub. Si cambió el Commit candidato, esperar verificación, preview, informe y aceptación nuevos.
8. **Esperar la comprobación pública.** La Factory debe acreditar el deployment del commit integrado y los criterios en el dominio público. No cerrar manualmente para saltarse este paso.
9. **Confirmar el final.** Comprobar informe de producción en el issue y estado `completed` de la Ejecución. El puesto queda libre para la siguiente petición.

## Decidir durante la revisión

```mermaid
flowchart TD
    R["Estoy revisando un issue"] --> A{"¿Se ha admitido ya?"}
    A -->|"No"| P["Completar petición y autorizar contenido estable"]
    A -->|"Sí"| C{"¿Hay informe y preview vigentes?"}
    C -->|"No"| E["Consultar fase y causa en el panel"]
    C -->|"Sí"| B{"¿Cumple todos los criterios?"}
    B -->|"Tengo dudas"| Q["Preguntar en GitHub<br/>La consulta no acepta"]
    B -->|"No"| X["Pedir corrección mediante orden reconocida<br/>Requiere intervención"]
    B -->|"Sí"| H["Aceptar SHA y preview con comentario nuevo"]
    H --> G{"¿Control favorable y demás requisitos de GitHub?"}
    G -->|"No"| V["Revisar cambios, permisos y observaciones"]
    G -->|"Sí"| M["Hacer merge humano"]
    M --> F["Esperar evidencia pública y completed"]
```

## Cómo reconocer un issue terminado

| Evidencia                                  | Qué demuestra                                                           |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| Issue autorizado                           | Qué se autorizó y quién lo autorizó.                                    |
| Base comprobada                            | Sobre qué versión empezó el trabajo y si ya tenía problemas.            |
| Diff y verificaciones del Commit candidato | Qué cambió y qué controles técnicos superó.                             |
| Preview e informe                          | Qué versión se presentó a revisión y con qué evidencia.                 |
| Comentario de aceptación                   | Qué SHA y preview aceptó una persona con permiso.                       |
| Merge y control histórico                  | Qué candidato se integró, por quién y bajo qué aceptación.              |
| Marcador y comprobaciones públicas         | Qué commit sirve producción y si pasan las aserciones declaradas.       |
| Informe en el issue y `completed`          | Que la Factory conservó la evidencia y completó el recorrido de cierre. |

La cobertura final se limita a las aserciones declaradas y al juicio humano sobre el Commit candidato. El informe debe conservar esa limitación; no acredita comportamientos del producto que nadie haya comprobado.
