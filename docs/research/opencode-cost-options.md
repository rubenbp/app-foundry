# Opciones para registrar costes de OpenCode

Investigación: 15 de octubre de 2026. Alcance: decisión de persistencia y límites de la Factory; no se ha ejecutado ningún modelo ni modificado el tracker.

## Qué entrega OpenCode

El SDK consultado expone en cada `AssistantMessage` `providerID`, `modelID`, `cost` y `tokens.input`, `tokens.output`, `tokens.reasoning`, `tokens.cache.read`, `tokens.cache.write` y un `tokens.total` opcional. Son datos del protocolo, no una declaración del modelo en su texto. La API permite consultar mensajes y suscribirse a eventos. La revisión del SDK corresponde al commit oficial `733b2c627e5aec39cb33cc22373bdce33053ef2c`, usado por la investigación previa. [Tipos SDK](https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/sdk/js/src/v2/gen/types.gen.ts#L327), [API SDK](https://opencode.ai/docs/sdk/#sessions).

El coste habitual lo calcula OpenCode a partir de contadores de uso y las tarifas del modelo. La revisión anterior usa `Session.getUsage`; el `dev` consultado ahora, `412b2b1d8563b665b5e7fed56cb46f7c333f34d1`, ha movido el cálculo a `SessionUsage.calculateCost` y mantiene la misma fórmula básica en USD por millón de tokens:

```text
coste = (input × tarifa_input
       + (output + reasoning) × tarifa_output
       + cache.read × tarifa_lectura
       + cache.write × tarifa_escritura) / 1_000_000
```

En estos campos normalizados, `input` excluye caché y `output` excluye razonamiento; no hay que volver a restarlos. Si se usa la respuesta cruda del proveedor, su semántica puede ser distinta. OpenCode selecciona tarifas por tramo de contexto cuando existen y cobra razonamiento a tarifa de salida; no representa una tarifa de razonamiento independiente. La revisión actual retorna cero si falta una tarifa, y normaliza uso ausente a cero: un cero aislado no acredita gratuidad ni consumo completo. [Cálculo actual](https://github.com/anomalyco/opencode/blob/412b2b1d8563b665b5e7fed56cb46f7c333f34d1/packages/core/src/session/usage.ts), [Cálculo y normalización anteriores](https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/opencode/src/session/session.ts#L338).

Las tarifas proceden del catálogo Models.dev y de configuración/plugins. Se pueden sobrescribir en `opencode.json`, por proveedor y modelo, mediante `cost.input`, `cost.output`, `cost.cache_read`, `cost.cache_write`. No hace falta construir otro calculador para corregir una tarifa sencilla. Los precios pueden variar por proveedor, modelo, contexto, ruta y contrato; conservar la tarifa efectiva y su fecha permite explicar una estimación histórica. [Catálogo e importación](https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/core/src/plugin/models-dev.ts), [Esquema de configuración](https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/core/src/v1/config/provider.ts#L31), [Aplicación de overrides](https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/opencode/src/provider/provider.ts#L1533).

## OAuth, suscripciones y proveedores propios

En la revisión anterior, el plugin OpenAI pone las tarifas a cero cuando la autenticación es OAuth. Sin embargo, el código aplica después los modelos configurados, cuyos precios prevalecen: no es correcto afirmar que OAuth impide todo override. Es posible estimar un equivalente API con precios explícitos, pero ese importe no es el cargo de la suscripción. Este orden se ha verificado estáticamente en `733b2c6`, no mediante una llamada real ni como garantía sobre otra versión. [Plugin OAuth](https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/opencode/src/plugin/openai/codex.ts#L286), [Orden de hooks y configuración](https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/opencode/src/provider/provider.ts#L1499).

Para tarifa plana, la atribución de la cuota a cada ejecución exige una regla contable propia. Para modelos locales, la fórmula por tokens no mide GPU, electricidad o amortización. Para BYOK y endpoints personalizados se necesita identificar el proveedor que factura y sus condiciones. Estas son consecuencias de diseño, no funciones que OpenCode garantice. [Proveedores, suscripciones, modelos locales y endpoints](https://opencode.ai/docs/providers/).

## Opciones de la Factory

| Opción | Qué registra | Ventaja | Límite |
| --- | --- | --- | --- |
| A. Estimación de OpenCode | Contadores y `cost` del SDK, con procedencia y modalidad de pago | Integración mínima; catálogo existente; admite override | Catálogo o uso incompletos; OAuth puede producir cero |
| B. Cálculo propio | Contadores normalizados × catálogo versionado de la Factory | Comparación reproducible y políticas propias | Mantener tarifas, tramos y excepciones; sigue siendo estimación |
| C. Conciliación con proveedor | Consumo/cargos mediante API, exportación o factura | Contrasta el importe cobrado | Integración por proveedor, permisos, demora y atribución a ejecuciones |
| D. Híbrida | A durante ejecución; B solo para equivalentes cuando haga falta; C posteriormente | Separa consumo, estimación y cargo | Más complejidad si se implementa todo al inicio |

Los proveedores pueden aportar costes directamente, pero no hay un contrato universal. OpenRouter documenta `usage.cost`; OpenAI ofrece dashboard y exportaciones para revisión y conciliación. No se debe asumir que un coste informado por un gateway llega sin cambios a `AssistantMessage.cost`: el cálculo de OpenCode verificado utiliza sus propias tarifas. [OpenRouter Usage Accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting), [OpenAI revisión de consumo y costes](https://help.openai.com/en/articles/10478918-reviewing-api-usage-and-costs).

`opencode stats` y exportar sesiones son alternativas reales de inspección y recuperación de datos. `stats` agrega los costes y tokens guardados; no obtiene una segunda valoración independiente del proveedor. Para la Factory conviene SDK/API con identidad de mensajes, sin interpretar una salida de consola ni sumar simultáneamente agregados de sesión y mensajes. Hay que incluir sesiones hijas de la ejecución y evitar duplicar actualizaciones de un mismo mensaje. [CLI](https://opencode.ai/docs/cli/#stats), [Agregación verificada](https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/opencode/src/cli/cmd/stats.ts#L171).

## Recomendación para el MVP

Elegir A como implementación inicial y conservar el diseño compatible con D: persistir contadores y coste informado por OpenCode, etiquetado como estimación, junto con modelo, proveedor, modalidad, versión y fuente de tarifa cuando esté disponible. Mostrar desconocido si no hay base válida para un importe; conservar también el cero original como dato técnico, sin convertirlo automáticamente en coste real cero. Guardar cobertura parcial cuando falten llamadas o contadores.

Si la evaluación necesita comparar OAuth con API, añadir un campo separado de «coste equivalente API», usando tarifas fijadas y fechadas. No mezclarlo con cargo real ni cuota. La conciliación con facturas queda para una ampliación. No se recomienda mantener un catálogo propio completo antes de conocer proveedor y modalidad.

Los precios y contratos no se han comprobado para una cuenta concreta. Se han contrastado documentación web actual y código oficial fijado; no se ha validado el comportamiento del binario que finalmente integre la Factory. El SDK de la investigación previa y `dev` actual difieren en estructura: la implementación debe fijar y verificar una versión.
