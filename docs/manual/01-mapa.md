# 1. Mapa de la fábrica

[Índice](README.md) · [Siguiente: del issue al agente](02-issue-y-trabajo.md)

## Quién hace qué

```mermaid
flowchart TB
    H["Persona responsable"] -->|"Autoriza, responde, recupera y acepta mediante merge"| G["GitHub del Managed project<br/>Issues, ramas, PR y controles"]
    F["Factory<br/>Coordina y conserva evidencias"] -->|"Lee peticiones y decisiones"| G
    F -->|"Publica dudas, rama, PR con descripción y estado"| G
    F -->|"Encarga un Intento"| A["Agente de código<br/>OpenCode"]
    A -->|"Edita y crea commits locales"| W["Clon propio del Managed project"]
    F -->|"Prepara y verifica"| W
    G -->|"Integración Git"| V["Vercel<br/>Preview y producción"]
    F -->|"Comprueba identidad y versión de preview"| V
    F -->|"Expone estado y evidencias"| L["Dashboard"]
    H -->|"Consulta"| L
```

La persona decide el objetivo y si el resultado es aceptable. El agente propone código. La Factory controla el recorrido y verifica las pruebas. GitHub conserva la conversación y la integración. Vercel construye y sirve las versiones mediante su integración con GitHub.

El dashboard permite entender lo que ocurre, pero no autoriza peticiones, responde preguntas del agente ni acepta resultados.

Las dudas del agente se responden en el issue. Cualquier persona puede aportar esa información sin permisos de escritura; la aceptación mediante merge conserva sus controles de permisos.

## Los dos repositorios

| Repositorio                                                              | Contenido y propósito                                                                            |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Factory: `rubenbp/app-foundry`                                           | Código y documentación de la fábrica. Sus issues describen cambios en la propia Factory.         |
| Managed project configurado: por ejemplo, `rubenbp/appfoundry-site-demo` | Producto desarrollado. Aquí se crean los issues que consume la fábrica y las PR con sus cambios. |

Un issue del repositorio de la Factory no se convierte en trabajo para Rebobina. La admisión consulta el repositorio del Managed project configurado. Las PR no son una entrada alternativa de peticiones.

## Vocabulario para seguir el recorrido

| Término                      | Significado práctico                                                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Issue autorizado**         | Issue admitido al observar `factory:ready`, con su contenido capturado como encargo inicial. Permite empezar, pero no acepta el resultado.                                  |
| **Ejecución**                | Recorrido completo para atender esa petición, incluidas esperas, integración y cierre del issue.                                                                            |
| **Intento**                  | Trabajo encargado al agente dentro de la Ejecución. Puede incluir varias rondas de aclaraciones en el mismo thread; no hay reintento automático.                            |
| **Aceptación del resultado** | Decisión humana sobre un Commit candidato concreto, expresada mediante el merge de su PR tras revisar la preview.                                                           |
| **Base**                     | Versión de partida del producto, identificada por su SHA.                                                                                                                   |
| **Commit candidato**         | `HEAD` de la rama de trabajo que dejó el agente. La Factory verifica todos los cambios acumulados desde la base antes de presentarlo para aceptación.                       |
| **SHA**                      | Identificador completo de una versión de Git. Permite saber exactamente qué se comprobó y aceptó.                                                                           |
| **PR**                       | Propuesta de integración en GitHub, con los cambios y la conversación de revisión.                                                                                          |
| **Preview**                  | Versión de prueba desplegada para revisar el Commit candidato antes de integrarlo.                                                                                          |
| **Commit integrado**         | Versión resultante del merge. Su SHA puede diferir del Commit candidato, por ejemplo con squash.                                                                            |
| **Intervención**             | Situación que requiere inspección o decisión porque falta una garantía o hay un fallo. Conserva el puesto de trabajo mientras no se resuelva o detenga de forma confirmada. |

## Recorrido completo

```mermaid
flowchart TD
    I["Issue abierto del Managed project"] --> A["Se aplica factory:ready"]
    A --> Q["Capturar Issue autorizado y poner en cola"]
    Q --> W["Esperar puesto libre"]
    W --> B["Preparar clon y comprobar base"]
    B -->|"Encargo inicial"| O["Trabajo del agente<br/>Un thread para este issue"]
    O -->|"Código terminado"| T["Detener edición y verificar árbol del Commit candidato"]
    O -->|"Necesita una o varias aclaraciones"| Y["Publicar dudas en el issue<br/>Esperar sin caducidad y mantener puesto"]
    Y -->|"Primer comentario humano nuevo<br/>Continuar el mismo thread"| O
    T --> R["Publicar rama y PR"]
    R --> V["Esperar y comprobar preview de Vercel"]
    V --> E["Conservar evidencia y esperar revisión"]
    E --> G["Factory habilita su control de merge"]
    G --> M["Persona revisa la preview y acepta mediante merge"]
    M --> C["Publicar resumen de integración y cerrar issue"]
    C --> F["Ejecución completada<br/>Liberar puesto y atender siguiente"]
    B -. "Fallo o incertidumbre" .-> X["Intervención"]
    O -. "Fallo" .-> X
    T -. "Fallo o evidencia insuficiente" .-> X
    V -. "Deployment fallido" .-> X
    M -. "Merge fuera del contrato" .-> X
    X --> N["Publicar causa y acciones en el issue"]
    N -->|"Reintentar"| P["Repetir fase fallida en la misma Ejecución"]
    P -->|"Preparación"| B
    P -->|"Agente"| O
    P -->|"Verificación"| T
    P -->|"Publicación"| V
    P -->|"Cierre tras merge"| C
    N -->|"Corregir: instrucciones<br/>Antes del merge"| O
    N -->|"Cancelar<br/>Antes del merge"| Z["Confirmar parada y cerrar issue<br/>como no implementado; liberar puesto"]
```

La intervención tiene salida desde el mismo issue: `Reintentar` repite la fase fallida y `Corregir: instrucciones` encarga otro Intento en la misma conversación, rama y PR. `Cancelar` confirma la parada y cierra como no implementado. Basta un comentario humano, sin comprobar permisos para estas órdenes. Después del merge solo se reintentan el resumen y el cierre pendientes.

Este es el camino favorable. [Las variantes](05-variantes-e-intervencion.md) explican cuándo se espera, se vuelve a comprobar o se exige intervención.

## Tres versiones que no deben confundirse

```mermaid
flowchart LR
    B["Base<br/>Versión de partida"] --> C["Candidato<br/>Versión comprobada y aceptada"]
    C -->|"Merge humano, incluido squash"| M["Integrado<br/>Versión resultante del merge"]
    C --> V["Preview debe servir el SHA del Commit candidato"]
```

La preview debe servir el Commit candidato que se presenta a revisión. La persona responsable comprueba allí el resultado antes de aceptarlo; la Factory termina con la integración y el cierre.
