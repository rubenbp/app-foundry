# 3. Del Commit candidato a la aceptación

[Índice](README.md) · [Anterior](02-issue-y-trabajo.md) · [Siguiente: integración y cierre](04-integracion-y-cierre.md)

## Verificar el árbol del Commit candidato

El mensaje «he terminado» del agente inicia la verificación independiente. La Factory detiene primero su edición y fija el SHA del Commit candidato. Revisa todos los cambios entre la base y ese commit, aunque el trabajo incluya varios commits.

```mermaid
flowchart TD
    A["El agente comunica que ha terminado"] --> S{"¿Se ha confirmado que dejó de editar?"}
    S -->|"No"| X["Intervención"]
    S -->|"Sí"| C{"¿Clon y rama correctos, base antecesora<br/>y ningún cambio sin commit?"}
    C -->|"No"| X
    C -->|"Sí"| D["Fijar base, Commit candidato y diff acumulado"]
    D --> P{"¿Hay cambios en controles protegidos<br/>que requieren revisión?"}
    P -->|"Sí"| X
    P -->|"No"| V["Ejecutar contrato de verificación<br/>sobre todo el árbol del Commit candidato"]
    V --> T{"¿Comandos correctos, evidencia completa<br/>y árbol de trabajo estable?"}
    T -->|"No"| X
    T -->|"Sí"| R["Verificación técnica superada<br/>Continuar hacia PR y preview"]
```

En Rebobina, el contrato incluye build, lint, comprobación de tipos, pruebas unitarias y pruebas de navegador. Un comando fallido detiene la secuencia; los posteriores quedan sin ejecutar. No hay un bucle automático para pedir al agente que corrija y vuelva a probar.

La Factory compara controles con la base: comandos, configuración, manifests, lockfiles y pruebas existentes. Eliminar o modificar controles, omitir pruebas o hacer que solo se ejecuten algunas requiere intervención. Añadir pruebas sin esas señales sí está permitido. La revisión es conservadora: puede señalar cambios inocuos y no detecta todo debilitamiento posible.

Las pruebas de navegador usan un servidor propio para el build del Commit candidato. Un puerto ocupado falla; no se reutiliza otro servidor. Hace falta informe válido y pruebas ejecutadas, sin fallos, omisiones ni resultados inestables. Un código de salida cero, por sí solo, no acredita la comprobación.

**Resultado de negocio:** superar el contrato aporta evidencia técnica. Cada criterio sigue pendiente de juicio humano; una suite verde no demuestra por sí sola que se pidió lo correcto o que la experiencia sea adecuada.

## Publicar PR y comprobar preview

```mermaid
sequenceDiagram
    participant F as Factory
    participant G as GitHub
    participant V as Vercel
    actor H as Persona revisora
    F->>G: Publicar rama y abrir PR del Commit candidato verificado
    Note over F,G: La PR referencia el issue sin cierre automático
    G->>V: La integración Git activa el deployment de preview
    F->>G: Observar PR, SHA y deployment asociado
    F->>V: Contrastar proyecto, entorno y versión servida
    alt Preview acreditada para el Commit candidato
        F->>G: Publicar informe de revisión y evidencias
        G-->>H: Mostrar cambios, criterios, lagunas y preview
        H->>V: Revisar la preview
        H->>G: Publicar aceptación con SHA completo y URL
        F->>G: Releer hechos, comentario y permisos
        F->>G: Marcar Factory / ready-to-merge como success
    else Preview pendiente o acceso sin acreditar
        F->>F: Mantener espera sin habilitar merge
    else Deployment fallido
        F->>F: Registrar causa y exigir intervención
    end
```

La preview debe coincidir con el Commit candidato, el repositorio, el proyecto Vercel y el entorno configurado. Además, debe estar desplegada correctamente y servir el SHA de ese commit en su marcador. Un enlace que abre, pero apunta a otra versión o proyecto, no cumple.

La Factory usa acceso autenticado a Vercel cuando corresponde y conserva Deployment Protection. Un 401, 403 o redirección deja el acceso sin acreditar. `pending` e `inactive` significan espera; `failure` y `error` del deployment exigen intervención. Un error al consultar el proveedor significa falta de observación, no prueba que la build haya fallado.

## Qué debe revisar una persona

El informe de la PR reúne el Issue autorizado, la Ejecución, la base, el Commit candidato, el diff acumulado, las verificaciones, la evidencia por criterio, las lagunas y la preview. Si no cabe en un comentario, se divide en fragmentos enlazados; no se recorta el diff para aparentar evidencia completa.

La persona revisa el comportamiento en preview y decide si satisface los criterios. Para aceptar, publica un comentario nuevo en el issue o en la conversación principal de la PR, usando el ejemplo exacto del informe:

```text
Acepto la versión SHA_COMPLETO y su preview URL_DE_LA_PREVIEW.
```

`SHA_COMPLETO` se sustituye por los 40 caracteres del Commit candidato. La URL debe coincidir con la del informe. Se puede usar también la frase equivalente en inglés que reconoce el sistema. Una review de GitHub con «Approve», un comentario inline o un mensaje genérico no sustituyen este comentario de aceptación.

## Árbol de decisión de los comentarios

```mermaid
flowchart TD
    C["Comentario del issue o conversación principal de PR"] --> O{"¿Es propio de Factory, de bot<br/>o ya está consumido?"}
    O -->|"Sí"| I["No produce una aceptación nueva"]
    O -->|"No"| K{"¿Qué instrucción contiene?"}
    K -->|"Consulta u otro texto"| Q["No aceptar ni iniciar otro Intento"]
    K -->|"Aceptación ambigua"| L["Pedir comentario nuevo con SHA y preview"]
    K -->|"Corrección, cancelación o revocación reconocida"| P{"¿Autor con escritura?"}
    P -->|"No"| I
    P -->|"Sí"| X["Revocar control y exigir intervención"]
    K -->|"Aceptación explícita"| V{"¿Posterior al informe, sin editar,<br/>SHA y URL vigentes y autor con escritura?"}
    V -->|"No"| N["No aceptar<br/>Registrar motivo"]
    V -->|"Sí"| A["Registrar Aceptación del resultado"]
    A --> R{"¿Petición, PR, preview, informe<br/>y permisos siguen válidos?"}
    R -->|"No"| B["Mantener o revocar control favorable"]
    R -->|"Sí"| M["Habilitar control de merge<br/>Esperar merge humano"]
```

La interpretación reconoce fórmulas concretas; no interpreta cualquier frase libre como una orden. «¿Puedo aceptar?» es una consulta. «Acepto» exige aclaración. Para revocar puede usarse, por ejemplo, un comentario nuevo que empiece por `Revoco` o `Cancela`.

Cada ID de comentario se consume una sola vez. Corregir un comentario editándolo no lo convierte en una aceptación válida; hay que publicar otro. La aceptación tampoco sirve si es anterior al informe, señala otra preview, usa una versión antigua o procede de una persona sin escritura acreditada.

## Si algo cambia antes de integrar

```mermaid
flowchart TD
    A["Candidato publicado o aceptado"] --> C{"¿Qué cambia?"}
    C -->|"Nuevo SHA en la rama o PR"| V["Invalidar comprobaciones, preview,<br/>informe y aceptación anteriores"]
    V --> F["Obtener nuevo head en el mismo clon"]
    F --> T["Verificar árbol del Commit candidato de nuevo"]
    T --> R["Exigir nueva preview, informe y aceptación"]
    C -->|"Preview deja de ser válida"| P["Retirar aceptación y esperar preview válida"]
    C -->|"Informe o fragmento editado o eliminado"| I["Invalidar informe y aceptación<br/>Publicar informe vigente y pedir nueva aceptación"]
    C -->|"Permiso retirado o aceptación alterada"| H["Revocar aceptación<br/>Requerir una aceptación válida"]
    C -->|"PR se cierra sin merge<br/>o llega orden de corrección o cancelación"| X["Intervención"]
```

Un nuevo SHA provoca reverificación automática del Commit candidato publicado; no crea otro Intento del agente. Editar el título o el cuerpo del issue no actualiza el encargo capturado ni invalida la aceptación. El issue ya consumido no vuelve a entrar por quitar y poner la etiqueta.

La Factory observa por consultas periódicas. La revocación no es instantánea y un fallo de red puede impedir confirmar su escritura en GitHub. El dashboard conserva esa incertidumbre. El control favorable debe combinarse con las protecciones de la rama y el merge humano.
