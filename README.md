# App Foundry

Fábrica de software local que convierte un issue de GitHub en una versión revisable y lista para producción. Un agente de IA (OpenCode) analiza y construye la petición dentro de un arnés que acota su contexto, sus herramientas y sus permisos. Un flujo determinista evalúa su resultado y automatiza el resto: prepara el entorno, ejecuta las pruebas, publica la PR y comprueba la preview en Vercel. Una persona solo decide desde GitHub.

## Cómo funciona

1. Escribes un issue en lenguaje natural y le pones la etiqueta `factory:ready`.
2. El agente implementa en un clon propio. Si le falta información, pregunta en el issue.
3. La Factory ejecuta por su cuenta las comprobaciones del proyecto, abre la PR y espera la preview.
4. Revisas la preview. Un comentario pide una corrección; el merge acepta el cambio.
5. La Factory publica un resumen en el issue y lo cierra. Vercel publica producción.

El [Dashboard local](http://127.0.0.1:4310) muestra cada fase, la conversación del agente, las comprobaciones y el consumo.

## Requisitos

macOS con Git, [GitHub CLI](https://cli.github.com/), [Vercel CLI](https://vercel.com/docs/cli), Node **24.21.0** y npm **11.19.0**, y una cuenta de un proveedor de modelos (OpenAI, Gemini, Anthropic u Ollama). El asistente comprueba todo y te indica qué falta.

Deberás tener instalado **OpenCode**, usado para lanzar agentes de IA.

Para el proyecto de ejemplo necesitas también pnpm **12.14.0**, Python 3 y Google Chrome, que usan su build y sus pruebas E2E.

## 1. Crea el repositorio de ejemplo

La Factory trabaja sobre un repositorio tuyo de GitHub. Para probarla, crea uno con [Rebobina](examples/rebobina.zip), una web de demostración en Astro ya preparada con pruebas y marcador de versión:

```sh
unzip examples/rebobina.zip -d /tmp/rebobina
cd /tmp/rebobina/appfoundry-site-demo-*
git init -b main && git add . && git commit -m "chore: import Rebobina"
gh repo create rebobina-demo --public --source=. --push
```

El asistente se encarga del resto: te guía para importar el repositorio en Vercel, crea las etiquetas de la Factory y protege la rama `main`.

## 2. Instala la Factory con el asistente

```sh
git clone https://github.com/rubenbp/app-foundry.git
cd app-foundry
bash scripts/setup-factory.sh "/ruta/absoluta/App Foundry"
```

El asistente instala la Factory en esa carpeta y te guía paso a paso: GitHub, Vercel, comandos del proyecto, proveedor y modelo, y una comprobación final del proyecto. Al terminar genera el lanzador `start-factory.sh`. La [guía del asistente](docs/guides/setup-wizard.md) explica cada etapa.

## 3. Arranca y haz una petición

```sh
"/ruta/absoluta/App Foundry/start-factory.sh"
```

Abre el [Dashboard](http://127.0.0.1:4310) y crea un issue en `rebobina-demo`, por ejemplo:

> Quiero mostrar «Otra partida.» en el pie de todas las páginas.

Añade la etiqueta `factory:ready` y sigue la conversación en el issue. Si algo falla, la Factory te avisa allí: responde `Reintentar` o `Cancelar`. Detén la Factory con Ctrl-C.

## Más información

- [Guía del asistente](docs/guides/setup-wizard.md): instalación, archivos generados y uso diario.
- [Proveedores y modelos](docs/guides/llm-providers.md): cuentas, autenticación y elección del modelo.
- [Skills del agente](docs/guides/factory-skills.md): cómo ampliar el catálogo de skills.
- [Manual de la Factory](docs/manual/README.md): el ciclo completo de un issue, las decisiones humanas y la recuperación ante fallos.
- [Arquitectura](docs/architecture.md): organización del código y sus límites.
