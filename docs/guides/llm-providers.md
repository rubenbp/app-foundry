# Configurar proveedor y modelo

La Factory usa **un proveedor y un modelo globales**, leídos al arrancar. Todas las Ejecuciones usan esa selección. Para cambiarla, edita la configuración y reinicia. El MVP se opera en macOS.

## 1. Preparar el acceso

Para proveedores remotos necesitas OpenCode V2 con `auth export`. Usa siempre la misma CLI para conectar la cuenta y en el campo `opencodeCli` de la Factory:

```sh
command -v opencode
opencode auth list
```

| Proveedor                  | `provider`  | Conexión                                                   |
| -------------------------- | ----------- | ---------------------------------------------------------- |
| OpenAI                     | `openai`    | `opencode auth login openai`; elige OAuth.                 |
| Gemini                     | `google`    | `opencode auth login google --method key`                  |
| Claude                     | `anthropic` | `opencode auth login anthropic --method key`               |
| Ollama local, experimental | `ollama`    | Sin cuenta ni `opencodeCli`; sigue el paso local de abajo. |

Introduce la clave cuando OpenCode la solicite. Para Gemini, créala en [Google AI Studio](https://aistudio.google.com/api-keys); para Claude, usa una API key de Anthropic. Una suscripción Claude Pro/Max no sustituye esa clave. La API tiene su propia cuota y facturación. Consulta [las condiciones de autenticación de Anthropic](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use).

Si tienes varias cuentas del mismo proveedor, activa la deseada con `opencode auth switch` y comprueba `opencode auth list`. La Factory importa solo la credencial activa del proveedor a su servidor privado y sanea los secretos de las evidencias. No cambia la cuenta global.

Las claves guardadas solo como variables de entorno no se importan: conecta una cuenta mediante `auth login`. No pongas claves en el JSON, el repositorio o el issue; tampoco muestres `auth export` en la terminal.

## 2. Elegir el modelo

```sh
opencode models
```

También puedes usar `/models` en OpenCode. Divide el ID `proveedor/modelo`: `provider` contiene la primera parte y `model` el resto. Por ejemplo, `openai/gpt-6-luna` se configura así:

```json
{
  "dataDir": "/absolute/path/to/factory-data",
  "provider": "openai",
  "model": "gpt-6-luna",
  "auth": "opencode",
  "opencodeCli": "/absolute/path/to/opencode",
  "managedProjectFile": "config/managed-projects/rebobina.json"
}
```

Cambia `provider` a `google` o `anthropic` y `model` al ID que muestre tu OpenCode para ese proveedor. Conserva las rutas existentes de Vercel y del Managed project. `managedProjectFile` se resuelve desde el JSON; `dataDir`, `opencodeCli` y `vercelCli` requieren rutas absolutas.

**No hay lista manual de modelos permitidos en la Factory.** El modelo debe estar habilitado en el catálogo efectivo de OpenCode y admitir herramientas. La Factory lo comprueba al preparar el agente; una clave inválida, una cuota agotada o un modelo inaccesible pueden fallar después, al pedir la primera respuesta. No se cambia automáticamente de modelo ni proveedor.

Usa el ID sin sufijo `#variante`: se emplean los valores predeterminados de OpenCode para el modelo. Que aparezca en el catálogo no acredita que complete bien el trabajo de la Factory.

## 3. Usar Ollama local

1. Instala y abre [Ollama para macOS](https://docs.ollama.com/macos).
2. Descarga un modelo local con soporte de herramientas adecuado a la memoria de tu Mac:

   ```sh
   ollama pull NOMBRE_DEL_MODELO
   ollama list
   ```

3. Mantén Ollama activo en `http://127.0.0.1:11434`. Si usas la aplicación, ella gestiona el servicio. Si prefieres la terminal y no hay otro servicio activo, ejecuta `ollama serve`.
4. Ajusta el contexto en la aplicación. Ollama recomienda al menos 64.000 tokens para agentes y código; aumenta el consumo de memoria. Con servidor por terminal: `OLLAMA_CONTEXT_LENGTH=64000 ollama serve`. Consulta [contexto y memoria](https://docs.ollama.com/context-length).
5. Configura `provider: "ollama"`, `model` con el nombre exacto de `ollama list`, incluido su tag, y `auth: "opencode"`. Puedes omitir `opencodeCli`. Conserva el resto de tu JSON.

OpenCode descubre el modelo directamente. No se instala un intermediario ni se necesita una API key. La Factory no descarga modelos ni inicia Ollama. Este camino es **experimental**: memoria, contexto, velocidad y calidad deben comprobarse en el equipo. No implica funcionamiento totalmente offline del MVP: GitHub, dependencias y Vercel siguen requiriendo sus conexiones.

## 4. Arrancar y cambiar la selección

```sh
npm start -- serve --config factory.local.json --port 4310
```

Si hay una Ejecución iniciada y pendiente con otro proveedor **o** modelo, la Factory muestra un error por consola y no arranca. Incluye esperas humanas, revisión, intervención, recuperación y reintentos en cola. Para cambiar:

1. Arranca con la selección anterior.
2. Termina o cancela las Ejecuciones pendientes y confirma su estado `completed` o `stopped`.
3. Detén la Factory, cambia el JSON y vuelve a arrancar.

Los issues en cola que **nunca empezaron** adoptan la selección nueva al comenzar. Las Ejecuciones terminadas conservan su historial y no bloquean. No se migran conversaciones entre modelos.

## Diagnóstico y alcance comprobado

| Error                                           | Qué revisar                                                                               |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| No hay credencial activa / no se puede exportar | Ruta `opencodeCli`, `auth login`, método de conexión y cuenta activa.                     |
| Modelo no disponible                            | ID exacto, proveedor, cuenta conectada o servicio Ollama activo con el modelo descargado. |
| El modelo no admite herramientas                | Elige un modelo que OpenCode anuncie con esa capacidad.                                   |
| Error de autenticación o cuota al trabajar      | Acceso y cuota en el proveedor; resuelve la causa y solicita `Reintentar` en el issue.    |
| Arranque bloqueado por otra selección           | Recupera la selección anterior y termina o cancela el trabajo pendiente.                  |

Hay [evidencia histórica](../evidence/opencode-panel/README.md) con OpenAI `gpt-6-luna` mediante OAuth y variante `low`; ahora la variante queda a OpenCode. Las pruebas usan OpenCode real, claves ficticias y Ollama simulado, **sin generar respuestas**. No acreditan flujos completos nuevos con Gemini, Claude o local.

Para declarar una combinación comprobada, completa un issue hasta merge humano y cierre, y anota proveedor/modelo. En local, registra también memoria y contexto. Las demás combinaciones siguen siendo seleccionables y experimentales.

Referencia técnica: [proveedores V2](https://opencode.ai/v2/docs/providers) y [cuentas y autenticación](https://opencode.ai/v2/docs/cli/providers).
