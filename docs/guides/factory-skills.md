# Skills de la Factory

La Factory mantiene un catálogo común en el directorio `skills/` de su propio repositorio. Las personas responsables añaden y versionan sus skills allí. El catálogo inicial está vacío; no hace falta configurar cada Managed project.

## Añadir una skill

Crea una carpeta por skill con un identificador único en minúsculas, números y guiones, por ejemplo `review-changes`. Dentro, añade `SKILL.md`:

```text
skills/
└── review-changes/
    ├── SKILL.md
    ├── references/
    │   └── checklist.md
    ├── templates/
    │   └── report.md
    └── scripts/
        └── inspect.sh
```

Ejemplo del contenido de `SKILL.md`:

```markdown
---
name: Review changes
description: Review a completed change against its request and the repository standards before delivery.
---

Read `references/checklist.md` and inspect the accumulated change against the base.
Use `templates/report.md` to organize the findings.
Run `scripts/inspect.sh` only when its checks apply to this repository.
```

El nombre de la carpeta es el ID que usa OpenCode. `name` es el nombre visible y `description` explica cuándo debe usarse. Escribe una descripción concreta: una skill sin descripción no se anuncia al modelo. Las referencias, plantillas y scripts son opcionales y sus rutas se interpretan respecto a la carpeta de la skill. Los scripts deben indicar sus requisitos y cómo ejecutarlos; la Factory no instala dependencias para las skills.

Mantén una sola entrada `SKILL.md` por carpeta de primer nivel. La documentación del catálogo vive en `docs/`, fuera de `skills/`. La Factory autoriza los IDs de esas carpetas; los Markdown sueltos y las skills anidadas no son entradas admitidas del catálogo.

## Descubrimiento y uso

Antes de iniciar el primer Intento, la Factory copia el catálogo a `DATA_DIR/conversations/EXECUTION_ID/skills/`. OpenCode recibe esa ruta como fuente explícita. La misma copia se reutiliza en los siguientes Intentos y al recuperar la conversación después de un reinicio. Cambiar o borrar las skills del repositorio de la Factory no cambia una copia existente. Las Ejecuciones que aún no han iniciado su agente reciben el catálogo vigente al hacerlo.

OpenCode presenta al agente el ID, nombre y descripción de las skills autorizadas. El agente elige las que encajan con el trabajo y carga sus instrucciones completas mediante la herramienta nativa `skill`. Las referencias, plantillas y scripts se consultan cuando se necesitan; no se incluyen completos en todos los prompts.

El modo manual de preparación usa el mismo catálogo en su runtime temporal. Su copia se elimina junto con ese runtime al confirmar la parada.

## Permisos y procedencia

Solo se autorizan los IDs presentes en la copia de la Factory. Las demás skills quedan ocultas para el modelo y su carga mediante la herramienta `skill` se deniega, aunque OpenCode encuentre fuentes globales o del sistema. El entorno privado y la desactivación de la configuración del proyecto evitan heredar las skills personales y las del Managed project. Antes de entregar trabajo, la Factory también comprueba que cada ID autorizado resuelve al `SKILL.md` de su copia; una definición ausente o con otra procedencia hace fallar el arranque.

Las skills no amplían permisos. Sus archivos pueden leerse y su edición mediante herramientas nativas queda denegada. Los scripts siguen sujetos a la política de comandos del agente: el workflow permite desarrollo local, mientras que el modo manual no permite shell. Una skill no autoriza publicar, desplegar, acceder a credenciales ni instalar otras skills. Estos controles mantienen el alcance operativo del MVP y no ofrecen aislamiento del sistema operativo frente a procesos maliciosos del mismo usuario.

Un catálogo vacío permite trabajar sin skills. Si se produce un error de copia, formato o procedencia, se conserva el fallo de arranque y se utiliza la recuperación operativa existente; no se continúa silenciosamente con otro catálogo.

## Verificación

`tests/skills.test.ts` comprueba la estabilidad de instrucciones y archivos auxiliares entre Intentos, la actualización para otra Ejecución, el catálogo vacío y el rechazo de definiciones ajenas. `tests/opencodeRuntime.test.ts` comprueba con OpenCode real el descubrimiento, los permisos de skills, la exclusión de las fuentes del producto y la conservación de la copia después de reiniciar. Usa credenciales ficticias y no llama al modelo; no acredita la calidad con la que el modelo seleccionará o seguirá cada skill.

Referencias del formato y los permisos nativos: [Skills de OpenCode V2](https://opencode.ai/v2/docs/skills) y [Permisos de OpenCode V2](https://opencode.ai/v2/docs/permissions).
