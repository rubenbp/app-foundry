# Prototipo desechable del Dashboard

**Pregunta:** ¿qué composición permite seguir una Ejecución en tiempo real, consultar su pasado sin saltos y mantener visibles la fase y las decisiones pendientes?

Este código es exploratorio. Vive en la rama local `codex/prototype-dashboard`, separado de `main`. No representa una implementación de producción ni una composición ya elegida.

## Ejecutar

Con la Factory actual disponible en `http://127.0.0.1:4310/`:

```sh
npm run prototype
```

Abre `http://127.0.0.1:4311/?variant=A&replay=1`. El servidor de Vite consulta la API existente mediante un proxy local. No inicia trabajo ni realiza mutaciones sobre la Factory.

La ruta existente `/` conserva el Dashboard actual cuando no recibe `variant`. Las variantes y su selector solo están disponibles en desarrollo; el build de producción los excluye.

## Composiciones

- **A · Cabina:** fases horizontales, cronología central y contexto de la fase en un aside independiente. Favorece observar actividad y evidencia a la vez.
- **B · Bitácora:** fases en una columna izquierda, contexto resumido en una franja superior y cronología más densa. Favorece recorrer muchos registros.
- **C · Foco:** una cronología amplia y centrada, fases superiores y un resumen inferior persistente. El contexto completo se consulta en un diálogo. Favorece leer mensajes largos.

El selector inferior y las flechas del teclado recorren las variantes. La URL conserva la variante; las flechas no se interceptan en campos de formulario. «Estado» muestra la composición, la fuente, el escenario, la fase observada y la consultada, el seguimiento y los registros visibles.

## Comprobar el comportamiento

1. En «Simular actividad», pulsa «Reproducir» o «Añadir evento». Al estar abajo, la cronología sigue las novedades.
2. Sube en la cronología. La lectura queda anclada y aparece el número de entradas nuevas o actualizadas.
3. Pulsa «Volver al final». Se recupera el seguimiento. Llegar manualmente al final también lo recupera.
4. Expande una herramienta o una evidencia. La salida se consulta bajo demanda y la lectura se pausa para inspeccionarla.
5. Cambia entre implementación, verificación y revisión humana. La evidencia independiente aparece en su fase; las decisiones humanas permanecen en GitHub.
6. Prueba intervención y desconexión. Las incidencias aparecen fuera del área desplazable; la última vista permanece disponible.
7. Cambia a «Datos en vivo». Se muestra la Ejecución real mediante el polling existente, sin eventos simulados.

## Jerarquía de información explorada

**Siempre visible:** identidad del encargo, estado de la Ejecución, fase y avance, conexión y fallos o decisiones pendientes. La cronología tiene su propio scroll; la página no se desplaza.

**Según la fase:** comprobaciones independientes y criterios, preview y PR, aceptación mediante merge e integración. Consultar otra fase no modifica el estado real de la Ejecución.

**Bajo demanda:** estados internos de OpenCode, intenciones y confirmaciones, configuración capturada, sesión, procesos, identificadores completos, limitaciones, consumo detallado y salidas completas. Las entradas `part` del historial no se duplican, ya que su salida está representada por la evidencia o herramienta correspondiente.

## Límites y decisión pendiente

La simulación utiliza una copia en memoria de la Ejecución seleccionada. Sus escenarios recortan datos de una Ejecución ya observada; los eventos añadidos están marcados como simulados. Los recursos muestran el consumo observado de la Ejecución de origen, no una reconstrucción histórica de su consumo.

Las salidas disponibles solo tienen `updatedAt`. El orden inicial de estas entradas corresponde a su última actualización observada, no acredita el instante de su primera emisión. La implementación definitiva deberá concretar ese contrato si necesita un orden estable desde el inicio de cada mensaje o herramienta. El anclaje de lectura conserva la posición visual al actualizar contenido.

Se han comprobado directamente en el navegador el seguimiento al final, la conservación de la posición al recibir novedades, el retorno al final, la carga de salidas, los escenarios por fase y la ausencia de scroll exterior en escritorio y móvil. También pasan TypeScript, ESLint y el build de producción. No se añaden pruebas automatizadas al código desechable.

**Veredicto provisional:** A permite observar actividad y verificación simultáneamente y es la propuesta inicial para valorar. B y C exploran otras prioridades. La selección visual y la implementación definitiva quedan pendientes de la revisión del usuario; no se ha promovido ninguna variante a producción.
