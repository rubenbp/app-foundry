# Fuentes para las normas de código de App Foundry

Consulta: 17 de octubre de 2026. Las cifras de estrellas son aproximadas y proceden de las páginas de los repositorios consultadas; pueden variar. La selección prioriza fuentes originales y correspondencia con el proyecto. Las recomendaciones de adopción son una valoración para App Foundry, no instrucciones ya adoptadas.

## Contexto local

Según `package.json`, `tsconfig.json` y `README.md`, App Foundry combina una Factory local en Node.js y TypeScript con un dashboard React, Vite, Tailwind y Radix. Usa ESM, TypeScript estricto, SQLite, procesos externos, `node:test` y Playwright. ESLint y Prettier ya definen parte de las normas mecánicas.

Conviene distinguir normas de la Factory y normas del dashboard. Las reglas de un Managed project pertenecen a su propio repositorio y deben adaptarse a su stack.

## 1. n8n: base para el núcleo de la Factory

- Documento: [`AGENTS.md`](https://github.com/n8n-io/n8n/blob/master/AGENTS.md).
- Respaldo: [n8n, unas 208.000 estrellas](https://github.com/n8n-io/n8n). Plataforma de automatización con Node.js, TypeScript, persistencia y capacidades de IA.
- Contenido relevante: tipado, tratamiento de errores, límites de persistencia, reutilización de utilidades y pruebas.
- Qué seleccionaría: estrechar entradas desconocidas mediante validación; distinguir errores de usuario, fallos operativos y bugs; mantener el acceso a persistencia detrás de operaciones del dominio; consultar utilidades existentes antes de duplicarlas.
- Adaptación: su frontend es Vue. Sus comandos, paquetes, TypeORM, clases de error y organización de monorepo son propios. Adoptar los criterios sin imponer esa infraestructura a App Foundry.

## 2. Bulletproof React: base para el dashboard

- Documentos: [`docs/project-standards.md`](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-standards.md), [`AGENTS.md`](https://github.com/alan2207/bulletproof-react/blob/master/AGENTS.md), [estructura](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) y [componentes](https://github.com/alan2207/bulletproof-react/blob/master/docs/components-and-styling.md).
- Respaldo: [repositorio de Alan Alickovic, unas 36.000 estrellas](https://github.com/alan2207/bulletproof-react). Incluye una implementación React con Vite.
- Qué seleccionaría: agrupar código relacionado, mantener límites entre funcionalidades, componer componentes y situar el estado cerca de su uso.
- Adaptación: su selección de librerías, aliases y estructura de carpetas responde a su aplicación de ejemplo. App Foundry puede mantener sus herramientas actuales. El documento de estándares se centra en tooling; los criterios de diseño están repartidos entre los otros documentos.

## 3. Microsoft VS Code: instrucciones reales para agentes

- Documento: [`.github/copilot-instructions.md`](https://github.com/microsoft/vscode/blob/main/.github/copilot-instructions.md).
- Respaldo: [proyecto oficial de Microsoft, unas 194.000 estrellas](https://github.com/microsoft/vscode).
- Qué seleccionaría: exportar solo lo necesario, usar APIs para cruzar límites de componentes, declarar dependencias, asignar responsabilidad de cierre de recursos e inyectar dobles en pruebas en lugar de parchear objetos globales.
- Adaptación: trasladar la gestión de recursos a procesos, temporizadores y conexiones de la Factory. Sus servicios, convenciones de formato y localización son propios. Su preferencia por evitar `unknown` tiene una excepción cuando es necesario; para App Foundry conviene permitirlo en fronteras externas antes de validar.

## 4. Google: referencia transversal de TypeScript

- Documento: [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html).
- Respaldo: versión pública basada en la guía interna de Google.
- Qué seleccionaría: limitar la superficie exportada, usar construcciones de tipos sencillas, aprovechar inferencia evidente y documentar APIs con propósito.
- Adaptación: la propia guía advierte que algunas reglas responden al entorno de Google. Contrasta cada decisión con Node ESM y la configuración local. Ejemplo de conflicto: Google prefiere imports relativos dentro del proyecto, mientras Bulletproof React prescribe aliases absolutos. El estándar local debe resolverlo una sola vez.

## 5. Vercel Engineering: complemento de rendimiento para React

- Documento: [`skills/react-best-practices/AGENTS.md`](https://github.com/vercel-labs/agent-skills/blob/main/skills/react-best-practices/AGENTS.md).
- Respaldo: [colección oficial de Vercel, unas 33.000 estrellas](https://github.com/vercel-labs/agent-skills). El documento está dirigido expresamente a agentes y modelos.
- Qué seleccionaría: ejemplos de comportamiento incorrecto/correcto, prioridades por impacto, evitar peticiones secuenciales independientes y mantener coherencia entre estado derivado, renderizado y efectos.
- Adaptación: seleccionar las reglas de React cliente y JavaScript aplicables. Las secciones de Server Components, Server Actions y APIs de Next.js no corresponden al dashboard Vite. Las optimizaciones requieren un problema y una comprobación adecuados a su coste.

## 6. FiftyOne: ejemplo con el nombre exacto CODING_STANDARDS.md

- Documento: [`app/CODING_STANDARDS.md`](https://github.com/voxel51/fiftyone/blob/main/app/CODING_STANDARDS.md).
- Respaldo: [proyecto de Voxel51, unas 11.000 estrellas](https://github.com/voxel51/fiftyone).
- Contenido: decisiones concretas sobre estado de UI, hooks de dominio, eventos y sistema de diseño.
- Qué seleccionaría: elegir el mecanismo de estado más sencillo suficiente y exponer operaciones de dominio que oculten detalles internos.
- Adaptación: gran parte del documento trata sus librerías, migraciones y eventos internos. Es útil como ejemplo de precisión y alcance; su contenido necesita más adaptación que Bulletproof React para este dashboard.

## 7. Node.js Best Practices: catálogo de consulta para backend

- Documento: [`README.md`](https://github.com/goldbergyoni/nodebestpractices/blob/master/README.md).
- Respaldo: [Yoni Goldberg y colaboradores, unas 106.000 estrellas](https://github.com/goldbergyoni/nodebestpractices).
- Qué seleccionaría: tratamiento de fallos, validación de entradas, pruebas de errores y timeouts de servicios externos, y puertos asignados dinámicamente en tests.
- Adaptación: es un catálogo amplio con herramientas y escenarios diversos. Convertir solo las prácticas relevantes en reglas locales verificables.
- El [repositorio declara CC-BY-SA-4.0](https://github.com/goldbergyoni/nodebestpractices); conservar la atribución y considerar sus condiciones si se reproduce o adapta texto.

## Propuesta de síntesis

Usar n8n como referencia principal del núcleo y Bulletproof React para el dashboard. Complementar con VS Code para dependencias y ciclo de vida de recursos, Google para tipos y Vercel para rendimiento cuando corresponda. FiftyOne aporta un ejemplo de estándar concreto con el nombre solicitado.

Redactar una selección local breve en `CODING_STANDARDS.md` y enlazarla desde `AGENTS.md`. Cada regla debe indicar alcance y comportamiento comprobable. La configuración seguirá siendo la fuente de verdad para formato y comprobaciones mecánicas. Las fuentes externas servirán de fundamento; resolver sus diferencias en el documento local evita instrucciones contradictorias.
