# Issue tracker: GitHub

Los issues y specs de este repositorio se guardan en GitHub Issues de [`rubenbp/app-foundry`](https://github.com/rubenbp/app-foundry/issues). Usa la CLI `gh` para consultarlos y actualizarlos.

## Convenciones

Usa `--repo rubenbp/app-foundry` en los comandos `gh issue` para seleccionar el repositorio explícitamente.

- **Crear un issue o spec**: `gh issue create --repo rubenbp/app-foundry --title "..." --body-file <file>`.
- **Leer un issue**: `gh issue view <number> --repo rubenbp/app-foundry --json number,title,body,labels,comments`.
- **Listar issues**: `gh issue list --repo rubenbp/app-foundry --state open --limit 100 --json number,title,body,labels,comments`. Usa filtros `--label` y `--state` según la consulta, y paginación con `gh api --paginate` cuando necesites la lista completa.
- **Actualizar el cuerpo**: `gh issue edit <number> --repo rubenbp/app-foundry --body-file <file>`.
- **Comentar**: `gh issue comment <number> --repo rubenbp/app-foundry --body-file <file>`.
- **Aplicar o retirar etiquetas**: `gh issue edit <number> --repo rubenbp/app-foundry --add-label "..." --remove-label "..."`. Usa los roles de `docs/agents/triage-labels.md` para triage.
- **Cerrar**: `gh issue close <number> --repo rubenbp/app-foundry --comment "..."`.

Para cuerpos y comentarios multilínea, prepara el contenido en un archivo temporal y usa `--body-file`.

## Relación entre specs e implementación

Guarda el spec como un issue padre y cada ticket de implementación como un issue independiente.

- **Crear un sub-issue**: `gh issue create --repo rubenbp/app-foundry --parent <parent> --title "..." --body-file <file>`.
- **Vincular un issue existente**: `gh issue edit <parent> --repo rubenbp/app-foundry --add-sub-issue <child>`.

Estos flags requieren `gh` 2.94 o posterior. Con versiones anteriores, usa `gh api --method POST repos/rubenbp/app-foundry/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>`. Obtén el ID de base de datos con `gh api repos/rubenbp/app-foundry/issues/<child> --jq .id`; es distinto del número del issue.

Si los sub-issues no están disponibles, añade `Part of #<parent>` al inicio del cuerpo del hijo y enlázalo en una lista de tareas del padre.

## Pull requests como superficie de triage

**PRs as a request surface: no.**

## Cuando una skill indique «publicar en el issue tracker»

Crea un GitHub Issue en `rubenbp/app-foundry` con el spec o ticket correspondiente.

## Cuando una skill indique «consultar el ticket relevante»

Lee el GitHub Issue indicado por número o URL, incluidos su cuerpo, etiquetas y comentarios.

## Operaciones de wayfinding

`/wayfinder` usa un issue map y sub-issues como tickets.

- **Map**: un issue con la etiqueta `wayfinder:map` y las secciones Notes / Decisions-so-far / Fog.
- **Child ticket**: un sub-issue del map, con la pregunta en el cuerpo y una etiqueta `wayfinder:<type>`, donde `<type>` es `research`, `prototype`, `grilling` o `task`. Si los sub-issues no están disponibles, usa la lista de tareas del map y `Part of #<map>` en cada hijo. Crea las etiquetas `wayfinder:*` que falten cuando se usen.
- **Blocking**: usa las dependencias nativas de GitHub. Añade una dependencia con `gh api --method POST repos/rubenbp/app-foundry/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`. Obtén el ID con `gh api repos/rubenbp/app-foundry/issues/<blocker> --jq .id`. Si las dependencias no están disponibles, usa una línea `Blocked by: #<n>, #<n>` al inicio del cuerpo. Un ticket queda desbloqueado cuando todos sus blockers están cerrados.
- **Frontier**: consulta todos los hijos del map con `gh api --paginate repos/rubenbp/app-foundry/issues/<map>/sub_issues`, o lee su lista de tareas. Conserva los hijos abiertos, sin assignee ni blockers abiertos. Consulta `issue_dependencies_summary.blocked_by` para dependencias nativas o el estado de los issues de la línea `Blocked by` para el fallback. Elige el primero según el orden del map.
- **Claim**: asigna el ticket con `gh issue edit <number> --repo rubenbp/app-foundry --add-assignee @me` antes de empezar el trabajo.
- **Resolve**: publica la respuesta como comentario, cierra el ticket y añade un context pointer (resumen y enlace) a Decisions-so-far en el map.
