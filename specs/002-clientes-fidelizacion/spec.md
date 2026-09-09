# Especificación de Feature: Clientes y Fidelización

**Feature**: `002-clientes-fidelizacion` | **Fecha**: 2026-09-04
**Departamento que aporta**: Fidelización y Clientes (`FC`)
**Deriva de**: OT2.3 (personalizar promociones según el valor real del cliente), OT2.5 (recuperar clientes en riesgo real de abandono)

## Resumen

Este módulo es dueño de la entidad `cliente` (referenciada por `venta.cliente_id` en `001-core-ventas-inventario`) y del historial de segmentación de valor y riesgo de abandono que producen los modelos de IA (K-Means y el modelo de churn). El enunciado exige distinguir dos cosas que un programa de fidelización genérico no distingue: el valor real de un cliente no es solo cuánto gasta, y el riesgo de abandono real no es un umbral fijo de días para todos. El mecanismo de cupones en sí (cómo se envían y canjean, sin importar el origen) vive aparte, en `005-promociones-inteligentes`, porque tiene su propio ciclo de vida transaccional.

## Escenarios de Usuario

### Historia principal

Como Encargado de Fidelización, quiero identificar qué clientes son realmente valiosos (frecuencia y margen, no solo gasto) y saber cuándo un cliente está en riesgo real de abandono — nunca a los 30 días fijos para todos, porque cada cliente tiene su propio ciclo de compra normal.

### Escenarios de aceptación

1. **Dado** un cliente registrado, **cuando** consulto su historial de compras, **entonces** el sistema devuelve sus ventas (dato que vive en `001-core-ventas-inventario`, este módulo solo lo consulta).
2. **Dado** un ciclo de cálculo del modelo de segmentación K-Means, **cuando** consulto el segmento de un cliente, **entonces** el sistema devuelve el segmento más reciente con tamaño de muestra y periodo (Art. 5.9).
3. **Dado** un cliente evaluado como en riesgo real de abandono, **cuando** se registra el envío de una campaña de recuperación, **entonces** el sistema primero valida que el cliente no haya vuelto a comprar desde la evaluación — si ya compró, rechaza el envío.
4. **Dado** una campaña de recuperación enviada, **cuando** consulto si el cliente recuperó actividad, **entonces** el sistema responde si hubo una compra posterior a la fecha de envío.

### Casos límite (qué pasa si...)

- **¿Qué pasa si** un cliente nunca ha comprado o tiene muy pocas compras? → No se le calcula segmento ni evaluación de riesgo en ese ciclo — la consulta declara explícitamente que no hay datos suficientes.
- **¿Qué pasa si** un cliente en riesgo compra por su cuenta antes de que se le envíe la campaña de recuperación? → El sistema rechaza el envío (RN-CF-001) — evita el descuento contraproducente que menciona el enunciado.
- **¿Qué pasa si** el modelo evalúa a un cliente con 45 días sin comprar pero su frecuencia histórica normal es cada 60 días? → No se marca en riesgo real; esta decisión la toma el modelo (Analítica), este módulo solo almacena el resultado con su justificación.

## Requisitos Funcionales

- **RF-CF-001**: El sistema DEBE permitir registrar un cliente (nombre, contacto, fecha de nacimiento).
- **RF-CF-002**: El sistema DEBE permitir consultar el historial de compras de un cliente, en modo solo lectura sobre `001-core-ventas-inventario`.
- **RF-CF-003**: El sistema DEBE exponer el segmento de valor más reciente de un cliente, con tamaño de muestra y periodo; si nunca se calculó, DEBE declararlo explícitamente.
- **RF-CF-004**: El sistema DEBE exponer la evaluación de riesgo de abandono más reciente de un cliente, con su justificación.
- **RF-CF-005**: Antes de registrar una campaña de recuperación, el sistema DEBE validar que el cliente no haya vuelto a comprar desde su última evaluación de riesgo.
- **RF-CF-006**: El sistema DEBE permitir consultar si un cliente recuperó actividad tras una campaña de recuperación.
- **RF-CF-007**: Ningún cliente sin historial suficiente DEBE recibir segmento o evaluación de riesgo calculados en un ciclo — la ausencia se declara explícitamente.
- **RF-CF-008** *(añadido en enmienda v1.1, normalización de catálogos)*: El segmento de un cliente DEBE seleccionarse del catálogo `segmento`, nunca escribirse como texto libre — el nombre del segmento es la etiqueta de negocio de un cluster del modelo, y si cada ciclo lo escribe a su manera, la comparación de un segmento contra sí mismo entre periodos deja de ser posible (OT2.3).
- **RF-CF-009** *(añadido en enmienda v1.1)*: Toda asignación de segmento DEBE registrar la versión del modelo de segmentación que la produjo.
- **RF-CF-010** *(añadido en enmienda v1.1)*: El sistema DEBE permitir consultar el historial completo de segmentos por los que pasó un cliente, con el rango de fechas en que cada uno estuvo vigente.
- **RF-CF-011** *(añadido en enmienda v1.1)*: El sistema DEBE exponer el catálogo `segmento` como consulta, incluyendo la prioridad comercial de cada uno, para que `005-promociones-inteligentes` decida a qué segmento atender primero cuando el presupuesto de cupones es limitado.
- **RF-CF-012** *(añadido en enmienda v1.3, cumplimiento LOPDP)*: El sistema DEBE registrar y auditar el consentimiento de privacidad y la aceptación expresa de la política de privacidad al registrar un cliente en caja o administración.
- **RF-CF-013** *(añadido en enmienda v1.4, búsqueda interactiva en POS)*: La búsqueda de clientes (`GET /clientes?q=`) DEBE admitir el parámetro `q` como opcional. Si se omite o está vacío, el endpoint debe devolver un listado inicial de clientes registrados (hasta 50 registros) para poblar el menú interactivo desplegable al hacer foco en la barra de caja, y filtrar reactivamente por nombre o contacto conforme el cajero escribe.

## Requisitos No Funcionales

- **RNF-CF-001**: `segmento_cliente` y `evaluacion_churn` son append-only, cada fila con tamaño de muestra y periodo obligatorios (Art. 5.9).
- **RNF-CF-002**: Este módulo nunca escribe en `venta`/`detalle_venta` (propiedad de `001-core-ventas-inventario`).

## Reglas de Negocio

- **RN-CF-001**: No se puede registrar una campaña de recuperación para un cliente que ya volvió a comprar desde su última evaluación de riesgo.
- **RN-CF-002** *(añadida en enmienda v1.1)*: Un cliente no puede tener dos segmentos vigentes a la vez. Se impone con un índice único parcial en base de datos (`UNIQUE (cliente_id) WHERE vigente_hasta IS NULL`), no solo con validación de aplicación: si un error del servicio dejara dos asignaciones abiertas, el historial quedaría corrupto en silencio y toda la dimensión de cliente saldría mal para siempre.
- **RN-CF-003** *(añadida en enmienda v1.1)*: Registrar un segmento nuevo para un cliente DEBE cerrar la vigencia del anterior en la misma transacción. Es el único `UPDATE` admitido sobre `segmento_cliente` — no modifica ningún dato del cálculo ya registrado, solo marca hasta cuándo estuvo vigente (compatible con RNF-CF-001).
- **RN-CF-004** *(añadida en enmienda v1.1)*: Ninguna fila del catálogo `segmento` se borra; se da de baja con `activo = false`. Borrarla dejaría sin significado las asignaciones históricas que la referencian.
- **RN-CF-005** *(añadida en enmienda v1.2, auditoría de riesgos derivados 2026-09-05)*: No se puede registrar una campaña de recuperación contra una evaluación de churn con `es_riesgo_real = false`. Antes de esta enmienda solo se validaba RN-CF-001 (que el cliente no hubiera vuelto a comprar), pero eso no exige que el riesgo sea real — el propio documento de objetivos define esta operación (OO-FC08) como "a un cliente en riesgo real", y OT2.5 pide recuperar clientes "sin descuentos innecesarios". Sin este guard se podía enviar un cupón y un correo real (Art. 8.4) a un cliente en su ciclo normal de compra, el gasto contraproducente que el enunciado original advierte explícitamente.

## Caso límite adicional (enmienda v1.1)

- **¿Qué pasa si** el modelo de segmentación se reentrena y reclasifica a media clientela el mismo día? → Cada asignación nueva cierra la anterior y queda registrada con el `version_modelo_id` que la produjo (RF-CF-009). Así se puede distinguir una reclasificación masiva causada por el modelo nuevo de un cambio real de comportamiento de los clientes. Sin ese dato, un reentrenamiento se leería como si toda la clientela hubiera cambiado de hábitos de un día para otro.
- **¿Qué pasa si** se intenta dar de baja un segmento que tiene asignaciones históricas? → Se permite (`activo = false`), y las asignaciones históricas lo siguen referenciando sin problema. Lo que nunca se permite es borrarlo (RN-CF-004): el segmento tiene que seguir existiendo para que la historia siga significando algo.
- **¿Qué pasa si** un cliente nunca fue segmentado? → No tiene ninguna fila en `segmento_cliente`, y la consulta responde `datos_suficientes: false` (RF-CF-007, sin cambios). La enmienda no altera este comportamiento.

## Entidades Clave

- **Segmento** *(enmienda v1.1)*: catálogo de los segmentos de valor, con su prioridad comercial. Los códigos son los nombres de negocio de los clusters, no los números que devuelve el algoritmo.
- **Cliente**: nombre, contacto, fecha de nacimiento.
- **SegmentoCliente**, **EvaluacionChurn**: historial append-only de resultados de modelos batch. *(Enmienda v1.1)* `SegmentoCliente` es además la **dimensión SCD tipo 2 de cliente**: con `fecha_calculo` como inicio de vigencia y `vigente_hasta` explícito, el ETL de `011-analitica-reportes` lee el rango directo en lugar de deducirlo. No existe una tabla de historia aparte porque esta ya lo era.
- **CampanaRecuperacion**: envío de campaña, vinculado a la evaluación que la originó y, opcionalmente, a un cupón externo (`005-promociones-inteligentes`).

## Checklist de revisión

- [ ] Todo RF tiene un endpoint correspondiente en `contracts/clientes-fidelizacion.openapi.yaml`
- [ ] Ninguna consulta de segmento o riesgo presenta un resultado sin datos suficientes (RF-CF-007)
- [ ] RN-CF-001 está implementado como validación de servicio antes del `INSERT`
- [ ] Los 3 casos límite están cubiertos por al menos un test de contrato en `tasks.md`
- [ ] Ningún endpoint acepta el segmento como texto libre (RF-CF-008, enmienda v1.1)
- [ ] RN-CF-002 es un índice único parcial de base de datos, no solo validación de aplicación (enmienda v1.1)
- [ ] Toda asignación de segmento trae su `version_modelo_id` (RF-CF-009, enmienda v1.1)
