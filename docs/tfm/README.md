# Memoria del TFM · App Foundry

Borrador de la memoria técnica del TFM. Cada archivo es un apartado del documento final; se unen y exportan a PDF al terminar.

## Estado

| Archivo                                                                  | Apartado                        | Páginas objetivo | Estado   |
| ------------------------------------------------------------------------ | ------------------------------- | ---------------- | -------- |
| [00-resumen.md](00-resumen.md)                                           | Resumen ejecutivo               | 0,5              | Borrador |
| [01-problema-y-contexto.md](01-problema-y-contexto.md)                   | 1. Problema y contexto          | 1                | Borrador |
| [02-objetivo-y-alcance.md](02-objetivo-y-alcance.md)                     | 2. Objetivo y alcance           | 1                | Borrador |
| [03-solucion.md](03-solucion.md)                                         | 3. Solución paso a paso         | 5                | Borrador |
| [04-verificacion-y-resultados.md](04-verificacion-y-resultados.md)       | 4. Verificación y resultados    | 2,5              | Borrador |
| [05-justificacion-de-negocio.md](05-justificacion-de-negocio.md)         | 5. Justificación de negocio     | 2                | Borrador |
| [06-reutilizacion-y-conclusiones.md](06-reutilizacion-y-conclusiones.md) | 6. Reutilización y conclusiones | 2,5              | Borrador |
| [evidencias.md](evidencias.md)                                           | Lista de capturas               | —                | Hecha    |
| [datos-medidos.md](datos-medidos.md)                                     | Fuente única de cifras          | —                | Generado |

Total objetivo: unas 15 páginas con figuras.

## Reglas de redacción

- **Enfoque**: la Factory automatiza el flujo de creación de software con un workflow determinista. Un agente de IA analiza y construye las peticiones de los clientes, y el flujo lo guía con fases, tareas y validaciones fijas. Rebobina es un banco de pruebas generado con IA y sin backend para simplificar el ejemplo; una fábrica real podría soportar proyectos más complejos. No presentar la Factory como una solución para «cambios pequeños en webs».
- **Dos piezas clave**: la calidad de la fábrica recae en el **arnés** (contexto, herramientas, permisos y skills que acotan al agente) y en el **flujo determinista**, que evalúa el resultado del agente y automatiza lo repetitivo hasta producción (entornos, pruebas, PR, preview y cierre, apoyándose en GitHub y Vercel; producción la publica Vercel tras el merge humano). Cada apartado debe reflejarlo cuando corresponda.
- **Human in the loop**: nombrar así, en cursiva, los momentos del flujo en los que decide una persona (autorizar, aclarar, revisar y aceptar, resolver fallos). Se define en el apartado 3.5.
- **Enlaces**: cada mención a un issue o PR enlaza a su repositorio.
- **Estilo**: tono académico, natural y directo; frases claras y párrafos breves; negrita solo en ideas clave; sin relleno, repeticiones ni conclusiones que repitan lo anterior. Detalles técnicos solo cuando ayuden a evaluar el trabajo.
- **Voz**: primera persona del singular, como autor («diseñé», «pedí», «elegí»). En los ejemplos reales, la persona que interviene soy yo. «La persona» queda solo para describir el rol en el flujo genérico.
- **Lector**: tribunal técnico que no conoce el proyecto. Debe entender el flujo sin leer el código.
- **Una idea por bloque**: cada apartado empieza con una frase que lo resume. Cada figura lleva «Qué muestra» y «Qué permite comprobar».
- **Hilo conductor**: el [issue #4 de Rebobina](https://github.com/rubenbp/appfoundry-site-demo2/issues/4) («Modo comparador de juegos») aparece en la solución, la verificación y el negocio. El [issue #6](https://github.com/rubenbp/appfoundry-site-demo2/issues/6) («Algo nuevo») es el ejemplo secundario de aclaraciones del agente (apartado 3.5).
- **Vocabulario reducido**: Factory, proyecto gestionado, Ejecución, Intento, Commit candidato y preview. Se definen una vez en el apartado 3.
- **Cifras**: solo desde [datos-medidos.md](datos-medidos.md). Cada cifra se etiqueta como medida, calculada o estimada.
- **Marcas**: `[TODO-RUBÉN: …]` indica algo que solo el autor puede aportar o confirmar. `![Figura N…](img/…)` indica una captura pendiente, descrita en [evidencias.md](evidencias.md).

## Regenerar los datos

```sh
node --experimental-strip-types scripts/tfmMetrics.ts \
  ../sample/factory.local.sol.json ../sample/factory.local.luna.json ../sample2/factory.local.json \
  > docs/tfm/datos-medidos.md
```
