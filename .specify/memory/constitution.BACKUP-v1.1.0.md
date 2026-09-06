# CONSTITUCIÓN DEL PROYECTO — EL KIOSQUITO

**Versión 1.1.0 | Construcción de Software — Examen | Ratificada: 04 de septiembre de 2026 | Enmendada: 04 de septiembre de 2026**

> Este documento establece los principios, reglas y restricciones de carácter transversal que rigen la totalidad del proyecto El Kiosquito. Debe leerse antes que cualquier especificación de módulo, por cualquier persona o agente de IA que participe en el desarrollo del sistema.

## Artículo 1 — Propósito y Alcance

1.1. Este documento establece los principios, reglas y restricciones de carácter transversal que rigen la totalidad del proyecto El Kiosquito, sin excepción de módulo, paquete o caso de uso.

1.2. Toda especificación (`spec.md`), diseño (`plan.md`), conjunto de tareas (`tasks.md`) o implementación DEBE ser consistente con esta constitución. Ninguna especificación de módulo puede contradecir o redefinir una regla aquí establecida.

1.3. Este documento DEBE leerse antes que cualquier especificación de módulo, por cualquier persona o agente de IA que participe en el desarrollo del sistema.

1.4. Quedan fuera de este documento: reglas específicas de un módulo (van en su `spec.md`), diagramas UML detallados, planes técnicos por módulo (`plan.md`) y criterios de validación por funcionalidad (`checklists/requirements.md`).

## Artículo 2 — Identidad y Modelo de Negocio

2.1. El Kiosquito ES una cadena propia de minimarkets de barrio: la empresa es dueña y opera directamente todas sus sucursales.

2.2. El Kiosquito NO ES una plataforma de intermediación (no afilia negocios de terceros) y NO ES un modelo de comisión/SaaS — a diferencia de NexoStay, no existe un tercero "afiliado" que aporte su propio inventario o precios.

2.3. El modelo de ingresos es margen de venta directa al público sobre cada producto vendido en cualquiera de sus sucursales. El Kiosquito NO cobra comisión a nadie: vende directamente.

2.4. Toda sucursal nueva se incorpora mediante un proceso estructurado de apertura (departamento Expansión y Sucursales, OT3.5); el alta de una sucursal NUNCA debe tratarse como una inserción manual sin checklist ni herencia de catálogo/precios base.

2.5. El sistema combina tres capas: una capa operativa (PostgreSQL) con las tablas transaccionales de todas las sucursales, una capa táctica (ClickHouse) con informes compuestos por departamento y sucursal, y una capa estratégica (pandas/numpy/scikit-learn) que compara y agrega el desempeño de toda la red de sucursales.

## Artículo 3 — Modelo de Roles (jerarquía global)

3.1. La jerarquía de roles es:

- **Dueño / Gerencia General** — alcance de toda la red de sucursales. Define precios base, aprueba apertura de nuevas sucursales, consulta la analítica estratégica consolidada (OE1-OE4, comparación entre sucursales). No realiza operaciones de registro diario.
- **Encargado de Compras** — alcance de toda la red (rol corporativo, no de una sola sucursal). Gestiona proveedores, órdenes de compra y el costo de reposición para todas las sucursales (departamento Compras y Proveedores).
- **Encargado de Sucursal** — alcance de una o varias sucursales asignadas (equivalente al "Supervisor" de NexoStay). Gestiona precios locales, inventario, caducidad, fidelización y prevención de pérdidas de SU(S) sucursal(es), sin ver ni comparar el desempeño de sucursales ajenas.
- **Cajero / Vendedor** — alcance de una sucursal específica. Registra ventas, cobros, cuadre de caja y demanda insatisfecha en el punto de venta.

3.2. Ninguna especificación de módulo puede crear un rol nuevo fuera de esta jerarquía sin enmendar esta constitución.

3.3. Regla de alcance (scoping): el Encargado de Sucursal y el Cajero/Vendedor NUNCA pueden consultar datos de una sucursal que no tengan asignada. Esta restricción se aplica mediante RBAC con claims de sucursal(es) en el JWT (Art. 5.9), replicando la lección de NexoStay donde el Supervisor solo veía sus propios hoteles.

## Artículo 4 — Reglas de Negocio No Negociables

4.1. El IVA aplicable es 15% (tasa general vigente en Ecuador), parametrizable en el sistema para poder ajustarse si la tasa cambia o si se requiere una tasa diferenciada por categoría de producto en el futuro.

4.2. Toda merma DEBE registrarse con una causa obligatoria de una de estas tres categorías: robo externo, error humano, o fraude interno (además de caducidad, que se gestiona por su propio flujo). Ninguna merma puede quedar sin causa clasificada (OT3.4).

4.3. Toda compra motivada por una oferta de proveedor (precio atractivo) DEBE consultar el pronóstico de demanda del producto antes de confirmarse. Si la compra se realiza en contra de la recomendación del pronóstico, el sistema DEBE registrar el motivo (OT1.5, OO-CP07/OO-CP08). Esta regla nace directamente del enunciado del examen (compra de 50 unidades de edición limitada que no se vendieron).

4.4. Todo evento de demanda insatisfecha (cliente solicita un producto sin stock disponible) DEBE registrarse en el punto de venta al momento en que ocurre (OT3.7, OO-VC09). El pronóstico de demanda NUNCA debe basarse únicamente en las ventas históricas, sin considerar la demanda que existió pero no se convirtió en venta por falta de stock.

4.5. El valor de un cliente para fines de fidelización NUNCA se calcula únicamente por el gasto acumulado. DEBE considerar frecuencia de compra y margen de los productos comprados (OT1.4, OT2.3) — un cliente de compras pequeñas y constantes puede valer más que uno de una compra grande única.

4.6. Antes de contactar a un cliente con una campaña de recuperación (win-back), el sistema DEBE distinguir entre un cliente en su ciclo normal de compra y uno en riesgo real de abandono (OT2.5). Ofrecer un descuento de recuperación a un cliente que iba a volver de todas formas es una pérdida de margen, no una ganancia.

4.7. Toda venta de producto fraccionado (unidad suelta) DEBE convertir correctamente la unidad de venta a la unidad de inventario al momento del registro, nunca de forma manual o aproximada (OT3.8).

## Artículo 5 — Stack Tecnológico Obligatorio

5.1. Persistencia:
   - **PostgreSQL** — base de datos relacional operativa. Todas las tablas transaccionales de negocio (ventas, inventario, compras, clientes, mermas, cuadre de caja) y autenticación. Reemplaza tanto a DuckDB como a PocketBase de NexoStay, por decisión explícita para evitar el patrón de bugs de DuckDB documentado en el proyecto anterior (UPDATE implementado como DELETE+INSERT interno, imposibilidad de `ALTER TABLE DROP CONSTRAINT`, corrupción de catálogo por migraciones no idempotentes).
   - **ClickHouse** — base de datos columnar para la capa táctica (informes compuestos por departamento y sucursal), alimentada por Airflow. No dio problemas documentados en NexoStay; se mantiene sin cambios.

5.2. Orquestación de datos: Apache Airflow. Al menos un DAG de ELT que alimente el modelo Fact-Dim de ClickHouse desde PostgreSQL, con cargas incrementales por sucursal (OT3.6).

5.3. Backend: FastAPI + Jinja2, Python 3.11. Autenticación mediante PyJWT con claims de rol y sucursal(es) asignada(s) (Art. 3.3). Hash de contraseñas con bcrypt usado directamente.

5.4. Frontend: Bootstrap 5 + Chart.js.

5.5. Infraestructura: Docker Compose. Servicios mínimos: PostgreSQL, Airflow, FastAPI (API), ClickHouse, nginx (frontend). Toda carpeta editada desde el host (schema SQL, frontend, scripts, tests) DEBE montarse como volumen — lección directa de NexoStay, donde no hacerlo costó tiempo de depuración en más de una ocasión.

5.6. Analítica y aprendizaje automático:

   > **Enmendado en v1.1.0 (04 de septiembre de 2026).** Se amplía de 3 a 5 los modelos de ML comprometidos (se agregan detección de anomalías y segmentación de clientes, ambos dentro de scikit-learn, sin requerir enmienda de stack) y se incorpora formalmente el asistente conversacional de 5.10, con una excepción acotada y justificada a la prohibición general de LLM.

   - **pandas** y **NumPy** — manipulación de datos y cálculo numérico.
   - **scikit-learn** — única biblioteca admitida de aprendizaje automático para tareas de predicción/clasificación/clustering. Modelos comprometidos:
     1. Pronóstico de demanda (regresión), considerando confusores: promociones, sustitutos, estacionalidad, demanda insatisfecha (OT4.1)
     2. Pricing dinámico por margen y costo de reposición (OT1.1)
     3. Predicción de churn distinguiendo ciclo normal de abandono real (OT2.5)
     4. Detección de anomalías en cuadre de caja (Isolation Forest o equivalente) para identificar patrones de fraude interno más allá de un umbral fijo (OT3.4)
     5. Segmentación de clientes por comportamiento (K-Means: frecuencia + margen + recencia, no solo gasto acumulado) para personalizar fidelización (OT2.3)
   - Queda EXPRESAMENTE fuera del stack, y por lo tanto prohibido sin una nueva enmienda: aprendizaje profundo (PyTorch, TensorFlow) para cualquiera de los 5 modelos anteriores, y cualquier servicio de inferencia externo para tareas de predicción/clasificación/clustering numérica. La única excepción de LLM externo admitida es la de 5.10, acotada a lenguaje natural, nunca a predicción numérica.
   - **Regla de honestidad de los modelos (vinculante):** ningún informe puede presentar como resultado de un modelo algo que en realidad sea una regla fija, un valor inventado o una proyección sin datos que la respalden. Todo informe de inteligencia artificial DEBE declarar en pantalla el tamaño de la muestra con la que fue calculado y el periodo que cubre. Si los datos disponibles no alcanzan para sostener un modelo, el informe NO se implementa: se documenta por qué. Esta regla aplica también al asistente conversacional de 5.10: nunca puede presentar una cifra que no provenga de una consulta real a los datos.

5.10. Asistente conversacional en lenguaje natural (nuevo en v1.1.0):
   - Alcance: exclusivo del rol Dueño/Gerencia General, sobre los reportes y datos ya consolidados de toda la red (capa estratégica y táctica). Permite preguntas como "¿qué sucursal tuvo más merma esta semana?" o "¿qué productos debería dejar de comprar?".
   - Mecánica obligatoria: el asistente traduce la pregunta en lenguaje natural a una consulta estructurada sobre datos reales (PostgreSQL/ClickHouse/los 5 modelos de 5.6) y responde solo con lo que esa consulta devuelve. NUNCA genera una cifra, tendencia o recomendación que no provenga de una consulta real — no es un modelo predictivo adicional, es una interfaz sobre modelos y datos que ya existen.
   - Proveedor admitido: API de Anthropic (Claude), única excepción de LLM externo del stack, exclusivamente para esta funcionalidad. Requiere API key propia, fuera del Docker Compose local (única dependencia de red externa del sistema en producción, debe documentarse como tal).
   - Toda pregunta y su consulta estructurada generada DEBEN registrarse (auditoría del asistente), igual que cualquier otra operación crítica (Art. 4.2 de auditoría inmutable, OT4.3).
   - Esta funcionalidad es un extra de diferenciación del proyecto, no un reemplazo de ningún reporte o dashboard ya definido en la cascada de objetivos — todos los reportes tácticos/estratégicos siguen existiendo de forma independiente del asistente.

5.7. Ningún módulo puede introducir una tecnología fuera de este stack sin enmendar esta constitución.

5.8. Toda dependencia DEBE fijarse a una versión exacta en `requirements.txt` (sin rangos abiertos ni "latest"). Antes de fijar las versiones definitivas del entorno se DEBE verificar compatibilidad cruzada entre librerías críticas — especialmente entre FastAPI/Starlette, las versiones de los providers de Airflow, y los conectores de PostgreSQL/ClickHouse — porque un mismatch de versión de Starlette entre host y contenedor causó 44 validaciones caídas en producción en NexoStay pese a que los tests pasaban en el host. Se DEBE fijar una matriz de compatibilidad probada antes de congelar versiones.

5.9. RBAC: JWT con claims de rol (Art. 3.1) y sucursal(es) asignada(s) (Art. 3.3). Ningún endpoint puede omitir la validación de alcance por sucursal.

## Artículo 6 — Convenciones de Nomenclatura y Codificación

6.1. Objetivos: `OE-N` (estratégico) / `OT-N.N` (táctico) / `OO-[ABR]NN` (operativo).

6.2. Abreviaturas de departamento: VC (Ventas y Caja), IN (Inventario y Caducidad), CP (Compras y Proveedores), PM (Precios y Márgenes), FC (Fidelización y Clientes), PP (Prevención de Pérdidas y Seguridad), ES (Expansión y Sucursales), AD (Administración), AR (Analítica y Reportes).

6.3. Requisitos por módulo: `RF-[ABR]-NNN`, `RNF-[ABR]-NNN`, `RN-[ABR]-NNN`, `CA-[ABR]-NNN`, `US-[ABR]-NNN`, usando las abreviaturas de 6.2.

6.4. Los endpoints REST se definen en español, orientados a recursos (no a acciones). La definición concreta de cada endpoint vive en el `spec.md` del módulo correspondiente.

## Artículo 7 — Estándares de Calidad y Estructura de Requisitos

7.1. ISO/IEC/IEEE 29148:2018 rige la forma de todo requisito: único, verificable, atómico y sin ambigüedad.

7.2. ISO/IEC 25010 rige la clasificación de todo requisito no funcional de software (ocho características).

7.3. ISO/IEC 25012 rige la clasificación de calidad de datos en la capa analítica.

7.4. Todo RF, RNF, RN, US y CA DEBE tener código único y ser trazable a un caso de uso y a un objetivo (OE/OT/OO).

## Artículo 8 — Restricciones Generales

8.1. Proyecto académico de Construcción de Software: la arquitectura debe ser representativa de un sistema real, sin exigir escala de producción comercial.

8.2. Los pagos electrónicos se procesan mediante un proveedor de pagos simulado/sandbox; el sistema no mueve dinero real, aunque toda la lógica de cobro, margen e IVA se calcula y persiste como en una transacción real.

8.3. Todo dato del sistema se trata como dato de producción real, sin distinción de "datos de prueba" — se DEBE probar con volumen realista (catálogo completo, historial de ventas suficiente para entrenar los modelos de ML), no solo con datasets pequeños de desarrollo, lección directa de NexoStay.

8.4. Las notificaciones al cliente (cupón de cumpleaños, cupón por patrón de compra, alerta de campaña de recuperación) se envían mediante un canal real con tier gratuito (correo electrónico o similar); el envío por SMS puede quedar en modo simulado por costo de proveedor.

8.5. El sistema soporta autenticación mediante correo + contraseña (JWT). No se implementa autenticación multifactor (MFA) en esta versión.

8.6. Ningún módulo operativo puede simular un flujo de aprobación o proceso contable no solicitado explícitamente en esta constitución o en el `spec.md` del módulo — lección directa de NexoStay, donde un módulo completo de caja/arqueo de turno tuvo que descartarse por esta razón. "Operativo" es estrictamente INSERT/UPDATE/DELETE de registro o consulta puntual.

## Artículo 9 — Gobernanza

9.1. Esta constitución solo puede enmendarse mediante una nueva versión numerada, dejando registro del cambio y propagando el ajuste a toda especificación dependiente.

9.2. **Versión 1.0.0 | Ratificada: 04 de septiembre de 2026**

## Artículo 10 — Protección de Datos y Cumplimiento Normativo

10.1. El sistema DEBE cumplir con la Ley Orgánica de Protección de Datos Personales (LOPDP) de Ecuador (Ley 0, publicada el 26 de mayo de 2021, vigente desde mayo de 2023).

10.2. Principios rectores del tratamiento de datos: licitud/lealtad/transparencia (consentimiento explícito del cliente al registrarse en el programa de fidelización), finalidad (los datos del cliente solo se usan para venta, fidelización y comunicación operativa), minimización (solo se recolecta lo necesario: nombre, contacto, fecha de nacimiento, historial de compras), exactitud, limitación del plazo de conservación, integridad y confidencialidad.

10.3. El sistema DEBE exponer un mecanismo para que los clientes ejerzan sus derechos de acceso, rectificación, cancelación y oposición (ARCO) sobre sus datos personales, gestionado desde el módulo de Administración.

10.4. Todo registro de cliente en el programa de fidelización DEBE incluir una casilla de aceptación de la política de privacidad, previa al envío del formulario. El consentimiento DEBE registrarse con fecha, hora y versión de la política aceptada.

10.5. El sistema DEBE registrar todo intento de acceso no autorizado o anomalía de autenticación en un log de auditoría inmutable (OT4.3). Ante una brecha de seguridad que afecte datos personales, el sistema DEBE notificar al Dueño/Gerencia General y, cuando la ley lo exija, a la Autoridad de Protección de Datos Personales (APDP) de Ecuador dentro de las 72 horas siguientes a la detección.

10.6. El sistema NO DEBE almacenar datos sensibles (origen racial o étnico, ideología política, religión, salud, orientación sexual, datos biométricos o genéticos). El diseño actual de El Kiosquito no requiere el tratamiento de datos sensibles para ninguno de sus módulos.

10.7. Seguridad técnica: todo dato personal DEBE transmitirse cifrado en tránsito (TLS 1.2+) y almacenarse cifrado en reposo. Las contraseñas DEBEN almacenarse con hash bcrypt. El acceso a datos personales DEBE restringirse según el principio de mínimo privilegio (RBAC, Art. 3.3).

10.8. Datos de pago (tarjetas): el sistema NUNCA almacena el número completo de tarjeta ni el código de seguridad — solo los últimos 4 dígitos y el resultado de la transacción del proveedor de pagos, en línea con la regla de seguridad de pagos del Art. 4 y el hallazgo del enunciado sobre clonación de tarjetas y responsabilidad legal del negocio.

10.9. Para efectos de este proyecto académico, el equipo desarrollador actúa como responsable del tratamiento. No se designa un DPO formal, pero el sistema DEBE incluir un punto de contacto para solicitudes de privacidad.

## Artículo 11 — Diseño Visual y Experiencia de Usuario

11.1. Paleta de colores oficial El Kiosquito (distinta de la paleta hotelera vino/terracota de NexoStay — identidad propia de retail de barrio):

   **Colores de marca**
   - **Primario** `#0F6E5C` — verde esmeralda profundo. Color de acción del sistema: botones primarios, ítem activo de navegación, series principales de gráficos. Con texto blanco encima da contraste AA.
   - **Primario texto** `#0B5445` — verde esmeralda más oscuro, para texto/links sobre fondo claro.
   - **Primario suave** `#E1F0EC` — verde muy claro, para fondos de badge y filas resaltadas.
   - **Profundo de marca** `#0B2E2A` — verde bosque casi negro. Sidebar, encabezados de tabla, cifras de indicador.
   - **Secundario/Acento** `#E8871E` — naranja mango. Acentos decorativos, borde de ítem activo, cuarta serie de gráficos. Nunca como texto sobre fondo claro (contraste insuficiente).
   - **Fondo general** `#FAF6EE` — crema cálido, distinto del crema rosado de NexoStay.
   - **Superficie** `#FFFFFF`. Texto principal `#1F2B27`. Texto secundario `#5C6B65`.
   - **Semánticos:** Éxito `#1E7D4F`, Peligro `#A32E1F`, Advertencia `#C77D1E`, Información `#2F6B8C`.

11.2. Tipografía: fuente de display `Fraunces` o similar con carácter propio para títulos/KPI (a definir en detalle en la fase de frontend); fuente de interfaz `Inter` o `Plus Jakarta Sans` para el resto — a confirmar cuando se trabaje el `plan.md` de frontend, junto con el resto de componentes UI (layout shell, estados vacíos/carga, accesibilidad WCAG 2.1 AA), siguiendo el mismo nivel de detalle que el Artículo 11 de NexoStay pero con esta paleta propia.

11.3. Ningún módulo puede introducir colores o patrones de layout que contradigan esta paleta sin enmendar la constitución.

## Artículo 12 — Métricas y Umbrales de la Cascada de Objetivos

12.1. Este artículo fija en un solo lugar las metas cuantitativas ya establecidas en el documento de empresa y objetivos (`claude/el-kiosquito-cascada-objetivos.md`), para que ningún módulo las redefina por su cuenta: margen bruto real +8% trimestral; merma <5% anual; costo de reposición -5% anual; ticket promedio +10%, frecuencia +15% en clientes fidelizados; stock sin rotación -30% en 6 meses; productos en rango competitivo ≥80%; tiempo de cobro <90 seg, adopción de pago electrónico ≥60%; cupones bien segmentados ≥85%; quiebres de stock <3%; recuperación de clientes en riesgo real ≥25%; cuadres de caja a tiempo 100% con diferencia <0.5%; productos con acción de caducidad a tiempo ≥90%; compras con costo actualizado el mismo día 100%; mermas con causa clasificada ≥95%; apertura de sucursal <15 días; latencia del pipeline ETL <10 min/ciclo; captura de demanda insatisfecha ≥80%; ventas fraccionadas con conversión correcta 100%; modelos de ML en producción ≥3; RBAC y auditoría 100%; terminales de pago conformes 100%.
