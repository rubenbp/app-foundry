# Instalar la Factory con el wizard de macOS

El asistente instala una copia de la Factory en la carpeta elegida, configura un
Managed project existente de GitHub y su proyecto Vercel, comprueba la preparación
y genera un lanzador. Sus mensajes están en español; las herramientas externas
conservan su propio idioma. No arranca la Factory automáticamente.

Desde un checkout de una versión confirmada de App Foundry:

```bash
bash scripts/setup-factory.sh
```

También puedes indicar el destino, incluidos espacios y discos externos:

```bash
bash scripts/setup-factory.sh "/Volumes/Mi disco/App Foundry"
```

Utiliza una carpeta dedicada fuera del checkout original. No introduzcas `~` como
texto: escribe la ruta absoluta. El wizard admite el Bash 3.2 incluido en macOS.

## Antes de comenzar

- Node y npm deben coincidir con `.node-version` y `packageManager` de la Factory.
  El asistente comprueba las versiones y muestra cómo resolver las ausencias.
- Necesitas Git, GitHub CLI y Vercel CLI en el `PATH`. Las instalaciones de
  herramientas se realizan en otra terminal; después puedes continuar o repetir.
- La cuenta GitHub necesita acceso de escritura al repositorio y administración
  para configurar su protección clásica. El repositorio debe permitir Issues.
  Tu plan de GitHub debe permitir proteger la rama base de ese repositorio.
- El Managed project debe estar preparado: dependencias con lockfile, instrucciones
  y comandos de instalación y verificación funcionales. El asistente propone
  comandos desde `package.json`; confirma sus valores. No inventa pruebas ausentes.
- Instala el gestor y la versión de paquetes del producto, junto con los binarios
  necesarios para sus comandos. Para E2E, instala Python si usas el servidor
  propuesto, y Chrome o el navegador que requiera Playwright.

Este recorrido admite proyectos situados en la raíz de su repositorio. Un monorepo
o una aplicación que necesite otro contrato de ejecución requiere preparación
específica. Una base fallida impide completar el wizard. Consulta el error,
prepara el proyecto y vuelve a ejecutarlo. La instalación no requiere una preview
existente ni comprueba el marcador de un deployment.

## Ocho etapas

1. **Destino.** Crea una carpeta dedicada con permisos privados y conserva las
   respuestas públicas en `.setup.env`. Ese archivo nunca se ejecuta como shell.
2. **Requisitos.** Comprueba macOS y herramientas. Clona la versión confirmada del
   checkout de origen, instala con `npm ci`, prepara OpenCode local, comprueba tipos
   y compila el Dashboard. Una instalación existente conserva su código de
   producto. El entrypoint del asistente se alinea con el script que estás
   ejecutando, para que las preguntas y las comprobaciones sean la misma versión.
3. **GitHub.** Guía el inicio de sesión cuando falta, pregunta repositorio y rama,
   comprueba sus permisos y crea las etiquetas del contrato que falten, con su
   color y descripción. No modifica las que ya existen. Después clona
   temporalmente la base para proponer valores.
4. **Proyecto.** Comprueba la versión exacta de Node de `.node-version`, si está
   declarada, y la versión del gestor indicada en `packageManager`. Pregunta
   archivos de instrucciones, instalación y verificaciones.
   Las listas usan `|` como separador; no se admite ese carácter dentro de un
   comando de la lista. Si hay E2E, pregunta configuración de Playwright, build,
   servidor y origen local exclusivo. Usa `si` o `no` para activar E2E.
5. **Vercel.** Guía la importación o selección, captura equipo/proyecto y comprueba
   mediante la API su identidad, integración Git, rama Production y variables de
   sistema. La importación de un proyecto nuevo puede publicar producción. Guía
   la creación inicial de una protección clásica de rama y, tras confirmación,
   añade PR obligatoria, rama actualizada y checks Vercel y Factory, conservando
   las reglas existentes. No solicita una URL de Preview ni prepara deployments.
6. **Modelo.** Selecciona proveedor, CLI de autenticación, modelo y esfuerzo real
   del catálogo. Pide las tres tarifas USD por millón de tokens. Consulta el
   catálogo y valida soporte de herramientas sin enviar prompts.
7. **Comprobación.** Revalida GitHub, Vercel y la protección de la rama. Tras
   confirmación, instala y verifica la base en un clon temporal con el entorno y
   adaptadores de la Factory. Incluye el servidor E2E exclusivo y evidencia de
   Playwright cuando están configurados. Una prueba opcional de generación solicita
   confirmación porque puede consumir cuota. Omitirla deja sin comprobar la
   respuesta real del proveedor.
8. **Arranque.** Comprueba el puerto del Dashboard y publica la configuración y
   `start-factory.sh`. Conserva copias `.previous` de archivos de una instalación
   anterior. No abre issues, no aplica `factory:ready` ni hace merge.

## Modelo y tarifas

Los proveedores admitidos son OpenAI con OAuth, Gemini y Anthropic con API key,
y Ollama local experimental. Puedes usar una CLI OpenCode V2 existente con
`auth export`, o el binario fijado instalado dentro de la Factory. Conecta la
cuenta en esa misma CLI. El asistente abre la página correspondiente; introduce
las claves solo en el prompt de autenticación de OpenCode. No se guardan claves
ni tokens en los JSON o en `.setup.env`.

Selecciona un ID del catálogo sin el prefijo del proveedor ni `#variante`. El
esfuerzo `default` omite `reasoningEffort`; los demás valores deben aparecer en el
catálogo del modelo. El acceso real y la cuota pueden fallar al generar incluso
después de una consulta de catálogo correcta. Sigue la
[guía de proveedores](llm-providers.md) para revisar cuentas y restricciones.

Introduce tarifas de **entrada**, **salida** y **lectura de caché**, todas en
**USD por millón de tokens** y con punto decimal. Las tres son obligatorias,
finitas y no negativas; cero solo representa la tarifa que tú hayas indicado.
No se consulta un catálogo de precios ni se asume gratuidad por usar OAuth o
Ollama. La escritura de caché se estima con la tarifa de entrada y el razonamiento
con la de salida. No se establece un límite de gasto ni se acredita una factura.
Las tarifas se guardan en `tokenPrices` de `factory.local.json` y cada Ejecución
conserva la copia tomada al comenzar.

## Previews durante las Ejecuciones

El wizard guarda la ruta del marcador en `publication.versionPath` de
`managed-project.json`. No pide ni guarda una URL de Preview nueva. Un valor
`PREVIEW_URL` conservado en `.setup.env` por una versión anterior se ignora.
La Factory obtiene y verifica la preview de cada Commit candidato durante su
Ejecución. Completar la instalación no acredita ese recorrido de publicación.

Vercel debe estar conectado al repositorio correcto. En el Dashboard, revisa
**Settings → Git**, la rama de producción y **Build and Deployment**. Habilita
el acceso a variables de sistema para recibir `VERCEL_GIT_COMMIT_SHA` en cada
build. Consulta la [integración Git de Vercel](https://vercel.com/docs/git) y las
[variables de sistema](https://vercel.com/docs/environment-variables/system-environment-variables).

La aplicación debe servir un marcador JSON, normalmente en `/version.json`:

```json
{
  "sha": "0123456789abcdef0123456789abcdef01234567",
  "dirty": false
}
```

El ejemplo no es un SHA para copiar: el build debe generar su SHA real. En Vercel
debe proceder de `VERCEL_GIT_COMMIT_SHA`. La Factory compara el marcador con los
metadatos Git del deployment. No basta un JSON fijo ni una URL de producción.
Mantén Deployment Protection: se comprueba el acceso mediante `vercel curl` con
la sesión existente, sin guardar credenciales del navegador.

El wizard no crea ramas ni PRs, ni modifica o integra código del Managed project
para preparar ese contrato. Antes de usar la Factory, documenta en las
instrucciones del producto la identidad de autor Git autorizada por Vercel;
el entorno de la Factory usa por defecto
`App Foundry <factory@localhost>`, que puede necesitar un `--author` explícito al
crear commits. Véase la [prueba local](../manual/07-prueba-local-github-vercel.md).

## Archivos y uso diario

```text
Destino/
├── factory/                  # Código y dependencias de Factory
├── data/                     # SQLite, artefactos y clones de Ejecuciones
├── factory.local.json        # Proveedor, modelo, esfuerzo y tarifas
├── managed-project.json      # Repositorio, comandos y publicación
├── start-factory.sh          # Lanzador ejecutable
├── .setup.env                # Respuestas públicas para repetir el wizard
└── .setup-config/            # Configuración provisional de la preparación
```

Arranca desde cualquier directorio:

```bash
"/Volumes/Mi disco/App Foundry/start-factory.sh"
```

El lanzador conserva la ruta absoluta de Node y el `PATH` de la instalación.
Mantén disponible esa versión de Node y el disco en el mismo punto de montaje.
Abre `http://127.0.0.1:4310`, o el puerto elegido, y conserva la terminal abierta.
El arranque admite automáticamente los issues abiertos con `factory:ready`.
Detén el proceso con Ctrl-C.

Puedes repetir el wizard desde el checkout original o el instalado, indicando
el mismo destino. Revisa las respuestas existentes antes de conservarlas con
Enter. Las confirmaciones usan `s` para aceptar; Enter rechaza. Una Factory con
`factory.lock` bloquea la reinstalación: detén el proceso y revisa cualquier lock
residual antes de repetir. No elimines reservas para saltar trabajo pendiente.
Termina o cancela las Ejecuciones iniciadas antes de cambiar proveedor, modelo
o esfuerzo; el runtime también comprueba esa condición al arrancar.

Cancelar conserva las respuestas para repetir. La configuración instalada solo
se sustituye en la última etapa; si falla esa publicación, revisa las copias
`.previous` antes de arrancar. El asistente elimina sus clones temporales cuando
puede confirmar la parada. Si queda una verificación incierta, indica la ruta que
debes inspeccionar. Una interrupción no revierte la importación de Vercel ni las
protecciones de GitHub ya confirmadas.

## Referencias de los pasos manuales

- [Importar un repositorio Git en Vercel](https://vercel.com/docs/git).
- [Proyectos y selección de equipo desde la CLI](https://vercel.com/docs/cli/project).
- [Autenticación de proveedores OpenCode V2](https://opencode.ai/v2/docs/cli/providers).
- [Acceder a previews con Vercel CLI](https://vercel.com/docs/cli/curl).

## Verificación del asistente

```bash
bash -n scripts/setup-factory.sh
shellcheck scripts/setup-factory.sh # Cuando esté instalado
npm run typecheck
node --experimental-strip-types --test tests/setupFactory.test.ts
```

Las pruebas cubren configuración compatible, tarifas, entradas literales, rutas
con espacios y comillas, lanzador desde otro directorio, symlinks, permisos,
identidades GitHub/Vercel, etiquetas del contrato, comprobación remota sin Preview y puerto ocupado. No ejecutan el
wizard interactivo, no cambian recursos remotos ni llaman a modelos reales.
