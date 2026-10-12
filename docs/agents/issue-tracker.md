# Issue tracker: Markdown local

Los issues y specs de este repositorio se guardan como archivos Markdown en `.scratch/`.

Todas las rutas de este documento son relativas a la raíz del repositorio, `app-foundry/`.

## Convenciones

- Usa un directorio por feature: `.scratch/<feature-slug>/`.
- Guarda el spec en `.scratch/<feature-slug>/spec.md`.
- Guarda cada issue de implementación en su propio archivo: `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, con numeración desde `01`.
- Registra el estado de triage mediante una línea `Status:` cerca del inicio de cada issue. Usa los valores de `triage-labels.md`.
- Añade los comentarios y el historial de conversación al final del archivo, bajo el encabezado `## Comments`.

## Cuando una skill indique «publicar en el issue tracker»

Crea el spec o los archivos individuales de los issues en las rutas anteriores. Crea los directorios que hagan falta.

## Cuando una skill indique «consultar el ticket relevante»

Lee el archivo de la ruta indicada. Si recibes un número de ticket, búscalo en el directorio `issues/` de la feature correspondiente. Pregunta por la feature si el número es ambiguo.

## Operaciones de wayfinding

`/wayfinder` usa un map y un archivo child por ticket. Estos tickets usan los status de workflow definidos aquí. Los issues de implementación usan los roles de triage anteriores.

- **Map**: `.scratch/<effort>/map.md`, con las secciones Notes / Decisions-so-far / Fog.
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, con numeración desde `01` y la pregunta en el cuerpo. Una línea `Type:` indica `research`, `prototype`, `grilling` o `task`. Una línea `Status:` indica `open`, `claimed` o `resolved`.
- **Blocking**: una línea `Blocked by: NN, NN` cerca del inicio. Un ticket queda desbloqueado cuando todos los tickets que enumera tienen `Status: resolved`.
- **Frontier**: busca tickets con `Status: open` y sin blockers pendientes en `.scratch/<effort>/issues/`. Elige el primero por número.
- **Claim**: establece `Status: claimed` y guarda el archivo antes de empezar el trabajo.
- **Resolve**: añade la respuesta bajo `## Answer`, establece `Status: resolved` y añade un context pointer (resumen y enlace) a Decisions-so-far en `map.md`.
