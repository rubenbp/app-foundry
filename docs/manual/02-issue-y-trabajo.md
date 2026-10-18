# 2. Del issue al trabajo del agente

[Índice](README.md) · [Anterior](01-mapa.md) · [Siguiente: verificación y aceptación](03-verificacion-y-aceptacion.md)

## Antes del primer issue

La persona que opera la Factory prepara una configuración de confianza: repositorio del Managed project, rama base, instrucciones, instalación, verificaciones, identidad del proyecto Vercel para las previews. La configuración permanece fuera del clon que modifica el agente.

También prepara los accesos de GitHub, Vercel y OpenCode y la protección de la rama.

La protección se configura mediante una operación administrativa explícita. Exige PR, rama actualizada, conversaciones resueltas y los controles `Factory / ready-to-merge` y `Vercel`, conservando las protecciones existentes. La consulta periódica de la Factory no configura esa protección.

Los pasos técnicos están en el [README](../../README.md) y la [guía de Vercel](../guides/vercel-setup.md).

## Preparar y autorizar la petición

Conviene explicar el objetivo y el resultado esperado en lenguaje natural. Encabezados, listas, contexto y límites son opcionales. La persona no necesita preparar pruebas técnicas, selectores ni JSON: la Factory decide las comprobaciones anteriores al merge. La admisión acepta también contenido vacío o incompleto; el agente decide si falta información relevante y pide una aclaración antes de implementar.

Basta con que el issue esté abierto en el repositorio del Managed project y tenga `factory:ready`. La Factory confía en la gestión de etiquetas de GitHub: no comprueba quién la aplicó, sus permisos, si es un bot ni cuándo se editó el contenido. Las PR no son una entrada alternativa.

```mermaid
flowchart TD
    I["Issue observado"] --> R{"¿Abierto, del repositorio configurado<br/>y con factory:ready?"}
    R -->|"No"| O["No es una entrada admisible"]
    R -->|"Sí"| U{"¿Ya existe una Ejecución para este issue?"}
    U -->|"Sí"| D["No crear otra Ejecución"]
    U -->|"No"| A["Capturar Issue autorizado<br/>Crear Ejecución en cola"]
```

La Factory obtiene los issues mediante una consulta paginada de abiertos con `factory:ready` y captura el contenido devuelto. No consulta eventos, permisos ni ediciones para admitirlos.

La suficiencia del contenido corresponde al agente, fuera del proceso determinista de admisión. Si necesita información o una confirmación de producto, agrupa sus dudas y pide intervención. La Factory publica la solicitud en el issue y el Dashboard muestra la espera.

## Qué queda fijado

El Issue autorizado conserva título, cuerpo, autor, momento de captura, configuración del Managed project y selección del agente. La captura sirve como encargo inicial y bitácora. Editar el título o el cuerpo después no actualiza el encargo ni bloquea la Ejecución, su aceptación o su cierre. Los registros históricos con datos antiguos de autorización siguen siendo legibles, pero esos datos ya no condicionan la admisión ni la cola.

Cada issue se consume una sola vez dentro del historial persistido. Retirar y volver a aplicar la etiqueta después de admitirlo no crea otra Ejecución. Reabrirlo tampoco es un mecanismo de reintento. Retirar la etiqueta no cancela el trabajo ya admitido.

## Cola y puesto de trabajo

Solo hay una Ejecución activa. El puesto sigue ocupado durante las esperas de revisión, merge y cierre del issue, y también durante una intervención.

```mermaid
flowchart TD
    Q["Issue autorizado admitido en cola"] --> A{"¿Hay una Ejecución activa?"}
    A -->|"Sí"| W["Conservar petición y esperar"]
    W --> A
    A -->|"No"| R["Reservar Managed project"]
    R --> B["Preparar siguiente Ejecución"]
    B --> T{"¿Cómo termina?"}
    T -->|"Integración autorizada e issue cerrado"| F["Completar y liberar puesto"]
    T -->|"Parada confirmada"| F
    T -->|"Espera o intervención"| K["Mantener puesto reservado"]
    F --> S["Atender siguiente petición"]
```

La prioridad sigue el momento de primera observación. En una misma consulta, el número de issue y la identidad de la Ejecución desempatan de forma estable.

La cola sobrevive a un reinicio. Dos procesos no pueden usar a la vez la misma raíz de datos ni el mismo Managed project.

## Preparación e Intento

```mermaid
sequenceDiagram
    actor H as Persona
    participant G as GitHub
    participant F as Factory
    participant W as Clon propio
    participant A as Agente OpenCode
    H->>G: Aplicar factory:ready
    F->>G: Consultar issues abiertos con factory:ready
    G-->>F: Contenido observado
    F->>F: Capturar petición y reservar turno
    F->>W: Clonar y crear codex/execution-ID
    F->>W: Capturar base e instrucciones
    F->>W: Instalar y ejecutar verificaciones de la base
    alt Base válida
        F->>A: Arrancar servidor propio y enviar tarea una sola vez
        A->>W: Leer, editar, comprobar y crear commits locales
        A-->>F: Comunicar actividad y resultado
        F->>A: Detener edición antes de fijar candidato
    else Fallo o incertidumbre en preparación
        F->>F: Registrar evidencia y exigir intervención
        Note over F,A: No se encarga trabajo al agente
    end
```

Comprobar primero la base permite distinguir un problema anterior de una regresión introducida por el Commit candidato. Si la base falla, la Factory conserva la causa y el puesto; no encarga al agente arreglarla automáticamente.

El agente recibe la petición fijada, las instrucciones de la base y los comandos permitidos. Puede cambiar el producto y crear commits locales. La Factory conserva el control del push, la PR, los informes y los estados remotos. No entrega al agente las credenciales de publicación.

## Aclaraciones por comentarios

Cada issue mantiene una misma conversación con el agente. Si faltan datos o una decisión de producto, el agente puede reunir varias preguntas en una solicitud.

1. La Factory publica las dudas como comentario en el issue y deja la Ejecución en `waiting`.
2. Cualquier persona puede responder con un comentario nuevo, sin comandos ni formato obligatorio. La Factory no comprueba permisos del autor para esta aclaración.
3. El primer comentario humano posterior a la pregunta vuelve completo al agente. Los comentarios de bots y de la propia Factory no cuentan como respuesta.
4. El agente continúa en el mismo thread y con el trabajo acumulado. Si necesita más información, vuelve a pedir intervención.
5. Cuando termina el código, la Factory ejecuta las verificaciones y continúa con la PR y la preview de Vercel.

La espera no caduca y mantiene el único puesto ocupado. Reiniciar la Factory mientras espera conserva el thread y la solicitud pendiente. Los comentarios de conversación publicados mientras el agente trabaja no se envían al thread; tampoco se recogen respuestas adicionales después de reanudarlo. La orden explícita `Cancelar` se procesa en las consultas del workflow. Si falta algo, el agente vuelve a preguntar.

Las respuestas aclaran el encargo; no conceden permisos técnicos ni aceptan el resultado. Los errores de autenticación, modelo, proceso, verificación o despliegue se notifican en el issue y permiten la [recuperación por comentarios](05-variantes-e-intervencion.md#recuperar-desde-el-issue). No hay reparación automática ni cambio de proveedor.

`Corregir: instrucciones` abre otro Intento en la misma Ejecución, conversación y rama. Si ya existe PR, se conserva. La Factory detiene la edición anterior, retira la aceptación y vuelve a verificar el resultado completo antes de pedir una nueva aceptación. `Reintentar` sobre un fallo del agente también abre otro Intento; repetir preparación o verificación no crea trabajo adicional del agente por sí solo.
