# El Kiosquito — contexto para retomar en otra IA

Fecha: 2026-09-06. Escribo esto en primera persona porque me lo pediste así — es el traspaso real de lo que sé del proyecto, no un resumen genérico. Úsalo junto con `guion-elkiosquito.html` (mismo folder `scratch/`): el guion es la narrativa completa (arquitectura, los 11 módulos, roles, ML, notificaciones); esto de acá es el estado actual y lo que sigue.

## Qué es el proyecto, en una línea

Sistema de gestión para un kiosco/tienda de conveniencia — examen de Construcción de Software en la UTEQ, Grupo 04. Metodología Spec-Driven Development: cada módulo tiene su `spec.md`, `data-model.md`, `contracts-openapi.yaml`, `research.md` y checklist de requisitos en la carpeta `claude/` (Proyecto de Claude, no en el repo). Hay una constitución (`el-kiosquito-constitution.md`) que fija reglas transversales — cualquier decisión de diseño nueva debería revisar si ya hay un artículo que la cubra antes de inventar un patrón nuevo.

Stack real: 11 módulos backend (FastAPI), Postgres operativo con **83 tablas reales** (lo conté yo mismo contra las 20 migraciones de Alembic — el número "79" que aparece en algún doc viejo ya quedó desactualizado, no lo repitas), capa táctica en ClickHouse alimentada por un pipeline ETL orquestado con Airflow, 5 modelos de ML en scikit-learn, un asistente conversacional vía OpenRouter, notificaciones reales por Gmail SMTP, y un frontend React + TypeScript + Vite + Tailwind v4 + Motion (6 pantallas).

## Estado real ahora mismo (verificado por mí, no supuesto)

- El stack de Docker levanta bien: `postgres`, `backend`, `clickhouse`, `etl-bootstrap`, `airflow-postgres`, `airflow-init`, `airflow-webserver`, `airflow-scheduler`. El frontend **no** está en Docker — se levanta aparte con `npm run dev` en `frontend/app`, puerto 5173.
- Encontré y corregí un bug real: el backend no tenía CORS configurado (`backend/app/main.py` + `backend/app/core/config.py`), lo que bloqueaba toda llamada del frontend a la API. Lo arreglé y lo probé de verdad (TestClient simulando el preflight real del navegador, no solo revisar sintaxis). **Ojo**: para que el fix tome efecto hay que reconstruir el contenedor — `docker compose up -d --build backend`. Si la otra IA ve errores de CORS o "Failed to fetch" desde el frontend, lo primero que hay que preguntar es si ese rebuild ya se hizo.
- Rediseñé la pantalla de login (`frontend/app/src/screens/Login/Login.tsx`): panel de marca a la izquierda en pantallas grandes, la card de siempre sin cambios en mobile. Solo tokens del sistema de diseño existente, nada de colores nuevos.
- Verificado: `npx tsc -b --noEmit` limpio. **No pude correr `npm test`/`npm run build`** por un problema de entorno del puente a la máquina del usuario (falta un binding nativo de Linux en el `node_modules`, instalado desde Windows — no es un problema del código). Hace falta correr eso desde la propia terminal de VS Code del usuario para confirmar que los 98 tests documentados siguen pasando.
- No encontré repositorio git inicializado en la carpeta del proyecto — no hay historial de commits que revisar, el estado real es literalmente lo que hay en disco.

## Lo que sigue pendiente — el tema real que falta arrancar

El dueño del proyecto (Luis Mario) pidió esto y todavía no se hizo nada:

1. **Ingeniería inversa contra un dataset real de kiosco.** Quiere conseguir/comparar un dataset real de un kiosco/tienda de conveniencia contra el esquema actual de 83 tablas, para validar que no falta ningún campo — la preocupación explícita es que el profesor pregunte "¿y dónde veo esto?" sobre algún dato que debería estar y no está.
2. **Tabla de objetivos tácticos por departamento**, con este formato exacto que pidió el profesor:

   `DEPARTAMENTO | OBJETIVOS TÁCTICOS | ¿ES UN INFORME SIMPLE? | ¿ES UN INFORME COMPUESTO?`

   Informe simple = sale directo de la BD relacional (ej. listado de ventas por vendedor). Informe compuesto = necesita agregación/transformación (ej. ventas por día, ventas por cajero) — ese tipo va por el pipeline ETL hacia ClickHouse, nunca directo de Postgres.
3. A partir de esa tabla, identificar **qué informes salen de la BD relacional (Postgres) y cuáles de la BD columnar (ClickHouse)** — y de ahí revisar si el modelo de datos actual (tablas maestras, catálogos, dimensiones tipo día/semana, etc.) ya soporta todos esos informes o si falta algo antes de darlo por cerrado.

Esto todavía no arrancó — ni la investigación del dataset ni la tabla de objetivos tácticos. Es el próximo bloque de trabajo real, no una idea suelta.

## Dónde está todo

- Carpeta real del proyecto (en la máquina del usuario, Windows): `C:\Users\1EHP1895\Desktop\Mario\Construccion de software\Proyecto El Kiosquito`
- El guion completo: `scratch\guion-elkiosquito.html` en esa misma carpeta (y publicado como artifact aparte).
- Docs de contexto que ya existen (viven en el Proyecto de Claude, prefijo `claude/` — si la otra IA no tiene acceso a eso, hay que migrarlos o pegarlos a mano): la constitución, spec/data-model/contracts/research/checklist de cada uno de los 11 módulos, el sistema de diseño frontend, y `el-kiosquito-guia-pruebas-locales.md` (cómo levantar todo, qué puerto es cada cosa, cómo contar las tablas de Postgres — lo escribí hoy mismo tras diagnosticar el bug de CORS).

## Algo que quiero decirte yo, sin que me lo pidieras

Dos cosas que vale la pena que la otra IA sepa antes de tocar código acá. Primero: este proyecto tiene una convención fuerte de comentarios "Art. X.Y" citando la constitución en cada decisión de diseño — no es decoración, es real trazabilidad de por qué existe cada campo/regla, y romper esa convención (agregar código sin ese tipo de justificación) va a desentonar fuerte con el resto del repo. Segundo: antes de tocar el esquema de base de datos para lo del dataset/informes tácticos, valdría la pena que la otra IA lea `el-kiosquito-arquitectura-datos.md` y los `data-model.md` de los 11 módulos primero — hay bastante ya pensado sobre separación operativa/táctica (Postgres vs ClickHouse) que no conviene reinventar desde cero, solo hay que llenar los huecos reales que aparezcan al comparar contra un dataset externo.
