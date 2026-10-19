# Configurar proveedor y modelo

La Factory usa **un proveedor, un modelo y un esfuerzo globales**, leídos al arrancar. Todas las Ejecuciones usan esa selección. Para cambiarla, edita la configuración y reinicia. El esfuerzo es opcional. El MVP se opera en macOS.

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

Usa el ID sin sufijo `#variante`. Para elegir el esfuerzo, añade el campo opcional `reasoningEffort` con el ID exacto de una variante del modelo. No hay una escala común a todos los proveedores: consulta las opciones mediante `npm run test:opencode -- --config factory.local.json`. El comando muestra líneas listas para copiar al JSON, por ejemplo, si el modelo anuncia esa variante:

```json
"reasoningEffort": "low"
```

Si omites el campo, OpenCode usa su valor predeterminado. Si el modelo no ofrece variantes, el diagnóstico lo indica y debes omitirlo. Las configuraciones y Ejecuciones antiguas sin ese campo conservan el significado de selección predeterminada, aunque su evidencia registre una variante efectiva.

Solo `test:opencode` comprueba la compatibilidad del esfuerzo con el catálogo antes de enviar el prompt. La Factory transmite el valor a OpenCode y propaga sus errores; no añade comprobaciones del esfuerzo efectivo ni cambia automáticamente la selección. Que una variante aparezca en el catálogo no acredita que complete bien el trabajo de la Factory.

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

Antes de arrancar la Factory, comprueba que OpenCode puede obtener una respuesta
con el proveedor y modelo del JSON:

```sh
npm run test:opencode -- --config factory.local.json
npm run test:opencode -- --config factory.local.json --prompt "Responde OK sin usar herramientas"
```

`--config` es obligatorio. Se reutiliza la validación de la Factory, incluidas
las rutas y la configuración del Managed project; puede crear `dataDir`.
Se prueba únicamente la selección de ese archivo, sin opciones para cambiar
proveedor/modelo/esfuerzo, fallback ni reenvíos del prompt. Si has editado el JSON con la
Factory arrancada, la prueba comprueba la selección del próximo arranque.

El comando levanta su propia instancia temporal mediante el adaptador de
OpenCode y la autenticación configurada. No necesita arrancar la Factory ni
preparar un clon: el directorio de trabajo está vacío. El prompt predeterminado
pide `OK` sin herramientas; `--prompt` permite sustituirlo. Una respuesta final
de texto no vacía es válida, aunque no coincida literalmente con `OK`, siempre
que se observe el proveedor/modelo configurado en ese mismo mensaje.

El plazo fijo es de 120 segundos desde el inicio de la prueba de OpenCode;
no admite `--timeout`. Un error, una laguna de observación, una respuesta vacía,
una intervención pendiente o superar el plazo producen `FAIL` y código de
salida `1`. El comando espera a que termine la llamada del adaptador en curso
antes de cerrar el proceso; el arranque y las llamadas HTTP conservan sus
propios límites. El cierre y la limpieza pueden prolongar la duración total.
Cancelar con Ctrl+C también intenta cerrar OpenCode.

La terminal muestra proveedor/modelo, el esfuerzo configurado, las variantes disponibles con el valor exacto de `"reasoningEffort"` para cada una, respuesta saneada, duración y `PASS` o `FAIL`. Si no hay variantes, indica que se omita el campo. Un esfuerzo explícito no anunciado produce `FAIL` antes de crear la sesión o enviar el prompt; se conserva el listado para corregir la configuración. El listado se muestra también si falla después la generación. `PASS` devuelve código `0` y exige confirmar el cierre del proceso.
No se guardan informes y se elimina el runtime temporal tras confirmar la
parada. Si el cierre queda incierto, falla e indica la ruta conservada para
inspección. Esta prueba acredita configuración y generación; no comprueba
ejecución de herramientas ni el workflow completo de la Factory.

Para arrancar la Factory:

```sh
npm start -- serve --config factory.local.json --port 4310
```

Si hay una Ejecución iniciada y pendiente con otro proveedor, modelo **o esfuerzo**, la Factory muestra un error por consola y no arranca. Incluye esperas humanas, revisión, intervención, recuperación y reintentos en cola. Pasar de un esfuerzo explícito al predeterminado, o al revés, también cambia la selección. Para cambiar:

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
| Esfuerzo incompatible en `test:opencode`        | Copia un valor de `reasoningEffort` del listado; si no hay variantes, omite el campo.     |
| Error de autenticación o cuota al trabajar      | Acceso y cuota en el proveedor; resuelve la causa y solicita `Reintentar` en el issue.    |
| Arranque bloqueado por otra selección           | Recupera la selección anterior y termina o cancela el trabajo pendiente.                  |

Hay [evidencia histórica](../evidence/opencode-panel/README.md) con OpenAI `gpt-6-luna` mediante OAuth y variante `low`; ahora se puede elegir mediante `reasoningEffort` o dejar el predeterminado de OpenCode. Las pruebas usan OpenCode real, claves ficticias y Ollama simulado, **sin llamar a modelos reales**. El diagnóstico comprueba también petición, respuesta y limpieza contra el simulador local. No acreditan flujos completos nuevos con Gemini, Claude o local.

Para declarar una combinación comprobada, completa un issue hasta merge humano y cierre, y anota proveedor/modelo. En local, registra también memoria y contexto. Las demás combinaciones siguen siendo seleccionables y experimentales.

Referencia técnica: [proveedores V2](https://opencode.ai/v2/docs/providers) y [cuentas y autenticación](https://opencode.ai/v2/docs/cli/providers).
