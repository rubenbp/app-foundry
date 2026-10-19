# Prototipo desechable del Dashboard

**Pregunta:** ¿qué composición permite seguir una Ejecución en tiempo real, consultar su pasado sin saltos y mantener visibles la fase y las decisiones pendientes?

Este código es exploratorio. Vive en la rama local `codex/prototype-dashboard`, separado de `main`. No representa una implementación de producción. El usuario eligió la composición A el 19/10/2026 y pidió profundizarla antes de implementarla.

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

A es la composición seleccionada y su control «Estado» está integrado en la barra del prototipo, sin reservar altura al pie. B y C siguen disponibles mediante la URL para consultar la exploración inicial; conservan su selector inferior y sus atajos. «Estado» muestra la composición, la fuente, el escenario, la fase observada y la consultada, el seguimiento y los registros visibles.

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

## Iteración sobre A: densidad y navegación

Tras la elección del usuario:

- La cabecera integra issue y título y reduce los metadatos a una segunda línea compacta. El estado de la Ejecución permanece visible también en móvil.
- Desde 900 px, un aside izquierdo contiene el historial y la cola, con scroll propio y acceso permanente. En pantallas menores se conserva el selector de ejecuciones.
- Se elimina el rótulo redundante «Contexto de la ejecución». El aside derecho empieza directamente con la fase.
- Las comprobaciones se resumen en comando, resultado, duración y salida. Se elimina el ID del grupo del resumen y el diagnóstico queda plegado.
- «Limpieza confirmada» se sustituye en el detalle por una explicación del cierre del comando. Si la finalización de sus procesos es incierta o pendiente, aparece un aviso visible sin desplegar el diagnóstico.
- «Ver evidencia y criterios» abre el diálogo directamente en la verificación, sin obligar a recorrer la configuración anterior.

Se comprobaron las vistas a 941×896, 706×896 y 390×844, sin scroll exterior. La cabecera de tarea ocupa unos 64 px a 706 y 941 px; una comprobación plegada ocupa unos 60 px. Pasan las cuatro pruebas existentes de `panel.spec.ts` y `verification.spec.ts`.

## Iteración sobre A: registro técnico y datos estables

- El icono y la tarjeta de cada evidencia quedan centrados verticalmente cuando están plegados; al expandir, el icono permanece junto a su cabecera.
- Proyecto, modelo y tokens observados se muestran junto a los datos del Intento en una cabecera estable para todas las fases. «Encargo y criterios» abre el contenido autorizado desde esa misma ubicación.
- Se eliminan los bloques permanentes de Encargo y Recursos del aside, la estimación SDK y la frase explicativa de consumo. El aside queda dedicado a la información de la fase.
- Se retira «Solo consulta · decisiones en GitHub» del lateral y del pie.
- El historial muestra la fecha y la hora de inicio de cada Ejecución, no la fecha de creación del issue, que no está disponible en la proyección.
- El registro técnico se agrupa en bloques cronológicos plegables. El inicio y la confirmación de una operación se representan juntos; ciclos diferentes de una operación siguen siendo distintos. Las señales internas repetidas de OpenCode se resumen, conservando todos sus registros.
- Las claves de operación se traducen: `status:<sha>:pending` actualiza el check de merge de GitHub; `review-ready:<id>` registra la notificación de revisión. El detalle identifica el Commit candidato y las referencias de informe o preview cuando la proyección permite distinguirlas.
- «Ver registro original» conserva acceso a todos los registros retenidos por la API, sin agrupar, y a sus salidas. No se afirma que el proveedor haya sido observado por completo.

Con la Ejecución disponible, los 123 registros técnicos se representan exactamente una vez dentro de 25 bloques. Se conserva el acceso a las 165 entradas originales y a las 29 salidas. Se comprobaron también operaciones sin confirmación, confirmación sin inicio observado, ciclos repetidos y operaciones desconocidas. Ninguno de esos casos inventa una confirmación ni descarta registros.

Verificación manual a 993×987, 793×987 y 390×844: sin scroll exterior ni horizontal en la cronología; desalineación de las evidencias plegadas de 0 px; posición de lectura conservada al recibir novedades y retorno al final correcto. A 993 px, los metadatos conservaron la misma posición vertical al alternar entre preparación, implementación, verificación, revisión y finalización. TypeScript, ESLint y el build pasan.

## Iteración sobre A: operaciones directas y evidencia legible

- Al activar el registro técnico, las operaciones aparecen directamente en la cronología. Se elimina el plegado exterior de los bloques; solo se despliega el detalle de una operación. Cada operación tiene su propio anclaje de lectura.
- Se retiran la última observación y el contador de registros del detalle. Los registros originales conservan sus horas. Las filas técnicas tienen espaciado vertical simétrico, incluida la última.
- Los diálogos quedan centrados en ambos ejes. El acceso directo a la verificación desplaza únicamente el contenido interior del diálogo.
- El detalle de código elimina las fases duplicadas y presenta «Versión de partida» y «Trabajo de esta Ejecución». Los enlaces llevan al repositorio, la rama principal, el código de partida y el diff de la PR; los identificadores completos quedan plegados.
- Las pruebas E2E muestran pruebas ejecutadas, omitidas y navegador. El entorno técnico queda bajo demanda y el modo offline mantiene un aviso visible.
- Los criterios se presentan en tarjetas numeradas. La evidencia técnica común aparece una sola vez; los enlaces específicos permanecen junto a su criterio. Se distingue la aceptación mediante merge de la validación automática de cada criterio.
- El alcance, las limitaciones y el registro original de evidencia siguen disponibles bajo demanda.

Esta iteración sustituye los 25 bloques plegables anteriores por 40 operaciones técnicas visibles en la Ejecución disponible. Sus 123 registros de origen se conservan exactamente una vez. Se comprobaron el centrado en escritorio y móvil, la ausencia de scroll exterior y horizontal, los enlaces del código, las tres tarjetas de criterios y las cinco comprobaciones comunes. Al añadir actividad, el seguimiento conserva el final; al consultar el pasado, la posición permanece estable y «Volver al final» recupera el seguimiento.

## Límites y decisión de composición

La simulación utiliza una copia en memoria de la Ejecución seleccionada. Sus escenarios recortan datos de una Ejecución ya observada; los eventos añadidos están marcados como simulados. La cabecera muestra los tokens observados de la Ejecución de origen, no una reconstrucción histórica de su consumo.

Las salidas disponibles solo tienen `updatedAt`. El orden inicial de estas entradas corresponde a su última actualización observada, no acredita el instante de su primera emisión. La implementación definitiva deberá concretar ese contrato si necesita un orden estable desde el inicio de cada mensaje o herramienta. El anclaje de lectura conserva la posición visual al actualizar contenido.

Se han comprobado directamente en el navegador el seguimiento al final, la conservación de la posición al recibir novedades, el retorno al final, la carga de salidas, los escenarios por fase y la ausencia de scroll exterior en escritorio y móvil. También pasan TypeScript, ESLint y el build de producción. No se añaden pruebas automatizadas al código desechable.

**Decisión del usuario:** A · Cabina. Se continúa profundizando el prototipo con historial fijo, cabecera compacta y evidencia resumida. B y C quedan como referencia de la exploración inicial. La implementación definitiva sigue pendiente; no se ha promovido el código desechable a producción.
