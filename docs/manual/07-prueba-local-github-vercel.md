# 7. Probar un issue real con GitHub y Vercel

[Índice](README.md) · [Anterior](06-guia-de-un-issue.md) · [Descripción del issue lista para copiar](ejemplo-issue-prueba-local.md)

Esta guía recorre un issue real de principio a fin contra el GitHub y el Vercel de tu copia de Rebobina. Parte de una instalación hecha con el asistente; si todavía no la tienes, sigue los pasos 1 y 2 del [README](../../README.md) y la [guía del asistente](../guides/setup-wizard.md). El merge que hagas al final actualizará producción.

En los comandos, sustituye `/ruta/absoluta/App Foundry` por la carpeta de instalación y `TU_USUARIO/rebobina-demo` por tu repositorio.

## 1. Antes de arrancar

El asistente ya comprobó herramientas, cuentas, proyecto Vercel, protección de la rama y base del proyecto. Antes de cada prueba, confirma que siguen disponibles:

```sh
gh auth status
vercel whoami
```

Si GitHub dejó de estar autenticado, ejecuta `gh auth login --hostname github.com`. Si Vercel pide autenticación, usa `vercel login` con la misma CLI que configuraste en el asistente. Para la cuenta del proveedor de modelos, sigue la [guía de proveedores y modelos](../guides/llm-providers.md). No pegues credenciales ni ejecutes `auth export` para mostrarlas en pantalla.

El puerto del servidor E2E que configuraste en el asistente (en Rebobina, `4173`) y el del Dashboard (`4310` por defecto) deben estar libres:

```sh
lsof -nP -iTCP:4173 -sTCP:LISTEN
lsof -nP -iTCP:4310 -sTCP:LISTEN
```

Sin salida significa que no hay un proceso escuchando. Si hay uno, identifícalo y detenlo antes de continuar.

La identidad Git de la automatización pertenece a la preparación del Managed project. En un equipo Hobby de Vercel, el autor de los commits debe ser el propietario del equipo. Indica una sola vez en las instrucciones de la rama base el autor reconocido por Vercel, por ejemplo `git commit --author "App Foundry (TU_USUARIO) <ID+TU_USUARIO@users.noreply.github.com>" ...`. La Factory usa por defecto `factory@localhost`; cambiar tu `git config --global user.email` no sustituye ese valor del entorno.

## 2. Arrancar y ver el Dashboard

```sh
"/ruta/absoluta/App Foundry/start-factory.sh"
```

Deja esa terminal abierta durante todo el recorrido y abre [http://127.0.0.1:4310](http://127.0.0.1:4310). El Dashboard debería mostrar la Factory sin Ejecución activa. El arranque consulta automáticamente los issues abiertos con `factory:ready`; comprueba que no hayas autorizado otros trabajos que no quieras ejecutar todavía.

Si la carpeta de datos ya tenía una Ejecución iniciada, puede aparecer en intervención. No arranques otra instancia ni borres reservas para saltarla; inspecciona esa Ejecución.

## 3. Crear el issue sin autorizar todavía

En una segunda terminal:

```sh
gh issue create --repo TU_USUARIO/rebobina-demo \
  --title "Prueba: actualizar el mensaje del pie de Rebobina" \
  --body-file "/ruta/absoluta/App Foundry/factory/docs/manual/ejemplo-issue-prueba-local.md"
```

Apunta el número que devuelve GitHub. Lee el [cuerpo preparado](ejemplo-issue-prueba-local.md) antes de autorizarlo: cambia únicamente el mensaje del pie y conserva la vuelta al inicio. Incluye el objetivo y tres criterios observables, sin plan técnico de pruebas.

## 4. Autorizar y observar

El asistente creó las etiquetas de la Factory. Aplica `factory:ready`, sustituyendo `NUMERO_DEL_ISSUE` por el número real:

```sh
gh issue edit NUMERO_DEL_ISSUE --repo TU_USUARIO/rebobina-demo \
  --add-label factory:ready
```

El Dashboard debería pasar por cola, preparación, trabajo del agente, verificación y espera de preview. En GitHub, `factory:ready` se sustituye por `factory:queued` y después por `factory:in-progress`. La Factory consulta de nuevo unos 15 segundos después de terminar la consulta anterior; la preparación y las pruebas pueden tardar varios minutos.

La Factory captura el título y el cuerpo que observa al admitir. Las ediciones posteriores no actualizan el encargo; volver a etiquetar no reejecuta el issue. Los comentarios publicados mientras el agente trabaja quedan sin procesar.

La Factory creará una rama y una PR, y Vercel producirá la preview mediante su integración Git. Si aparece intervención, lee el comentario de la Factory en el issue y consulta las salidas del Dashboard. Publica una de las órdenes ofrecidas: `Reintentar`, `Corregir: instrucciones` o `Cancelar`.

### Si el agente pide una aclaración

Abre el issue y responde al comentario «La Factory necesita tu respuesta» con un comentario nuevo. Puedes contestar todas las dudas juntas y en texto libre; puede responder cualquiera, sin comandos ni comprobación de permisos. Espera a que el Dashboard vuelva a mostrar trabajo del agente. Si la información no basta, el agente publicará otra solicitud.

La espera no caduca y conserva el puesto. Para comprobar la recuperación, puedes cerrar la Factory con Ctrl-C mientras muestra esa espera y arrancarla de nuevo: la pregunta queda pendiente y la siguiente respuesta continúa el mismo thread. Responder una aclaración no acepta la PR.

## 5. Revisar y aceptar

Espera el aviso de revisión en el issue y la etiqueta `factory:pending-review`. El aviso incluye la preview y la PR. Abre la PR y lee su descripción funcional: Resumen, Evidencia y Riesgo de fusión. Consulta el Dashboard para las salidas técnicas completas. Abre la preview con tu sesión de Vercel y comprueba:

1. El nuevo texto del pie en `/`.
2. El mismo texto en `/sobre-rebobina/`.
3. Que el enlace de marca del pie permite volver al inicio.

Puedes corregir una frase de la descripción de la PR y esperar una consulta: la Ejecución debe seguir en `awaiting_review` y conservar el control favorable. Una nueva entrega del agente sustituirá ese texto por la descripción completa actualizada.

Si quieres cambios, escríbelos en el issue sin prefijos: durante la revisión, cualquier comentario nuevo en el issue abre otro Intento. No publiques un comentario de aceptación: la aceptación es el merge.

## 6. Hacer merge y comprobar el cierre

Cuando estén favorables `Factory / ready-to-merge` y `Vercel`, haz el merge manualmente en GitHub. Mantén encendida la Factory.

La Factory debe publicar el resumen de integración en el issue, cerrarlo y pasar a `completed`. Puede mostrar brevemente `closing_issue` mientras confirma esos efectos. El resumen conserva el Commit candidato aceptado y el commit integrado, que pueden diferir si usaste squash. La Factory no espera ni comprueba el despliegue de producción después del merge.

## 7. Detener y repetir con otra petición

Al completar, puedes cerrar la Factory con Ctrl-C. Para cancelar desde GitHub, publica exactamente `Cancelar` en el issue: antes del merge, confirma la parada y cierra el issue como no implementado (`not_planned`).

Para una parada operativa local, abre en el Dashboard **Configuración, procesos y evidencia** y, en el bloque **Para emergencias**, copia el comando **Parar**. Ya incluye el ID de la Ejecución y las rutas de Node y de la CLI de tu instalación; ejecútalo desde la carpeta de instalación con la Factory funcionando. La parada local no cierra el issue ni revierte cambios integrados.

Al reiniciar, una espera de respuesta humana, de preview con la PR ya publicada o de revisión confirmada continúa sin aviso de intervención. Los demás trabajos iniciados quedan en intervención y no se reanudan automáticamente.

Si una Ejecución bloquea las pruebas y la parada normal no permite liberarla, copia en el mismo bloque el comando **Descartar**, para la Factory y ejecútalo desde la carpeta de instalación. El comando rechaza una Factory activa o procesos registrados que sigan vivos; no los mata. Tras el éxito, arranca de nuevo. Para repetir el mismo issue, consulta el [procedimiento de descarte y borrado del historial](05-variantes-e-intervencion.md#descartar-una-ejecución-bloqueante-durante-las-pruebas-del-mvp).

Para probar otro cambio, crea otro issue con un resultado diferente. El mismo issue no se consume dos veces dentro del historial.

## Si no avanza

| Lo que ves                      | Qué revisar                                                                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No aparece ningún issue         | Repositorio configurado, issue abierto con `factory:ready` y sin Ejecución previa en el historial.                                                                                    |
| Fallo de preparación            | Salida concreta: instalación, pnpm, Node, base defectuosa o puerto E2E ocupado. La Factory clona la rama base remota.                                                                 |
| `waiting`                       | Si hay dudas publicadas por la Factory, responder con un comentario nuevo en el issue.                                                                                                |
| Preview ausente o rechazada     | Bloque **Búsqueda de preview** del Dashboard, estado del deployment en Vercel, autor Git reconocido y SHA del deployment.                                                             |
| Preview protegida sin acreditar | Sesión de la CLI de Vercel configurada, proyecto y acceso; conservar Deployment Protection.                                                                                           |
| Cierre en intervención          | Resumen de integración vigente y permiso de comentar y cerrar. Comentar `Reintentar` completa el resumen y el cierre pendientes; después del merge no se admite corregir ni cancelar. |
| Intervención tras reiniciar     | Leer el aviso y solicitar `Reintentar` tras resolver la causa. Las esperas de aclaración, de preview publicada y de revisión confirmada continúan solas. No borrar datos ni reservas. |
