# El Kiosquito — Enmienda Transversal: Catálogos Maestros y Trazabilidad Histórica

**Tipo**: Enmienda transversal a los 11 módulos | **Fecha**: 2026-09-04
**Origen**: hallazgo de `producto.categoria` como TEXT libre al construir `informes-simples-vs-compuestos.md`
**Alcance aprobado**: normalizar **todos** los campos de catálogo, incluidos los estados, y versionar con SCD tipo 2 la clasificación gancho/nicho y el segmento K-Means

**Resumen**: 32 catálogos maestros nuevos + 2 tablas de historia. Ningún campo de negocio queda como texto libre sin respaldo referencial.

---

## 1. Por qué esta enmienda

El barrido de los 11 `data-model.md` encontró dos problemas distintos:

**Problema A — texto libre sin ningún control (5 campos).** `producto.categoria`, `producto.unidad_venta`, `producto.unidad_inventario`, `segmento_cliente.segmento`, y `recurso` (duplicado en `permiso_rol` y `log_auditoria`). Si un usuario escribe "Bebidas", otro "bebidas" y otro "BEBIDAS", cualquier informe agregado por categoría devuelve tres filas para lo mismo. Es el hueco que se detecta con la pregunta "¿y dónde veo esto?".

**Problema B — CHECK cerrado, correcto pero sin tabla (27 campos).** Los estados (`'pendiente'`, `'abierto'`, `'aceptada'`…) están bien resueltos para la capa operativa, pero el valor vive únicamente dentro de la restricción: no se puede consultar el catálogo, no se le pueden colgar atributos, y no existe como dimensión para la capa táctica.

Se resuelven los dos, pero con criterios distintos: el A es corrección de un defecto, el B es habilitar la capa táctica.

---

## 2. Convención de diseño: clave natural, no `SERIAL`

**Decisión**: todos los catálogos usan el código de negocio como clave primaria (`VARCHAR`), no un entero autoincremental.

```sql
CREATE TABLE estado_venta (
    codigo   VARCHAR(40) PRIMARY KEY,       -- 'completada', 'anulada'
    etiqueta VARCHAR(80) NOT NULL,          -- 'Completada' — lo que ve el usuario en Jinja2
    orden    SMALLINT    NOT NULL DEFAULT 0,-- orden de despliegue en selects e informes
    activo   BOOLEAN     NOT NULL DEFAULT true
);

-- venta.estado_venta: de CHECK IN (...) a:
ALTER TABLE venta
    ADD CONSTRAINT fk_venta_estado
    FOREIGN KEY (estado_venta) REFERENCES estado_venta(codigo);
```

**Por qué así y no con `id SERIAL`:**

1. **El dato sigue siendo legible.** `SELECT estado_venta FROM venta` devuelve `'anulada'`, no `7`. Un `SERIAL` obligaría a un JOIN para cualquier consulta manual — justo lo contrario de lo que se busca al defender el modelo frente al ingeniero.
2. **El código de los servicios no cambia.** La lógica que hoy compara `if venta.estado_venta == 'anulada'` sigue funcionando igual. Con `SERIAL` habría que resolver IDs en cada servicio de los 11 módulos.
3. **La migración no reescribe datos.** Solo agrega la tabla, la puebla y cambia el CHECK por una FK sobre el mismo valor ya guardado.
4. **Los estados derivados siguen derivándose.** `orden_compra.estado` es un valor calculado que nunca se edita a mano (RNF-CP-001 de 008); la FK solo agrega integridad, la lógica de derivación no se toca.

**Excepción**: `categoria` sí lleva `id SERIAL`, porque necesita autorreferencia jerárquica (`categoria_padre_id`) y sus nombres son editables por el negocio — un catálogo que el usuario mantiene, no un vocabulario fijo del sistema.

**Estructura base de todo catálogo**: `codigo`, `etiqueta`, `orden`, `activo`. Los atributos adicionales de cada uno están en §3 y **cada uno existe por un OT concreto**, no por simetría.

---

## 3. Los 32 catálogos, por módulo

### 001-core-ventas-inventario — 5 catálogos *(enmienda v1.3)*

| Catálogo | Reemplaza | Atributos propios y para qué sirven |
|---|---|---|
| `categoria` *(con `id SERIAL`)* | `producto.categoria` **TEXT libre** | `categoria_padre_id` (jerarquía de 2 niveles: Bebidas → Gaseosas, para agregar informes en ambos niveles); `es_perecedero` (dispara el flujo de caducidad de OT3.2 a nivel de categoría, sin marcarlo producto por producto) |
| `unidad_medida` | `producto.unidad_venta`, `producto.unidad_inventario`, `detalle_venta.unidad_venta` **TEXT libre** | `permite_decimales` (una funda de arroz se vende en libras con decimales, una gaseosa no: valida la venta fraccionada de OT3.8 antes de que el cajero cometa el error) |
| `metodo_pago` | CHECK `('efectivo','tarjeta','electronico')` | `es_electronico` (calcula directamente el % de adopción de pago electrónico de OT2.2, sin listar los códigos en la consulta) |
| `estado_pago` | CHECK `('pendiente','aprobado','rechazado')` | `es_estado_final` (distingue lo que todavía puede cambiar de lo que ya cerró) |
| `estado_venta` | CHECK `('completada','anulada')` | `cuenta_para_ingresos` (una venta anulada no debe sumar al KPI de OT1.1; hoy eso vive como un `WHERE` repetido en cada consulta) |

### 002-clientes-fidelizacion — 1 catálogo + 1 historia *(enmienda v1.1)*

| Tabla | Reemplaza | Detalle |
|---|---|---|
| `segmento` | `segmento_cliente.segmento` **TEXT libre** | Salida del K-Means. Atributos: `prioridad_comercial` (a qué segmento se le envía cupón primero, OT2.3), `descripcion` (qué caracteriza al segmento según el modelo) |
| `cliente_segmento_historial` **(SCD tipo 2)** | — | `cliente_id`, `segmento_codigo`, `fecha_desde`, `fecha_hasta`, `version_modelo_id`. Append-only |

### 003-precios-margenes — 4 catálogos + 1 historia *(enmienda v1.2)*

| Tabla | Reemplaza | Detalle |
|---|---|---|
| `clasificacion_comercial` | `clasificacion_producto.clasificacion` CHECK `('gancho','nicho')` | `margen_objetivo_min`, `margen_objetivo_max`: el rango de margen esperado deja de estar quemado en el código del motor de pricing y pasa a ser dato configurable (OT1.1) |
| `canal_competencia` | `precio_competencia.tipo_canal` CHECK | `frecuencia_monitoreo_dias` (un canal digital se revisa a diario, la tienda de la esquina semanalmente — OT2.1) |
| `fuente_precio` | `precio_producto.fuente` CHECK `('manual','motor_dinamico')` | `requiere_justificacion` (el precio del motor exige justificación por Art. 5.9; el manual no) |
| `estado_recomendacion` | `recomendacion_precio.estado` CHECK | `es_estado_final` |
| `producto_clasificacion_historial` **(SCD tipo 2)** | — | `producto_id`, `clasificacion_codigo`, `fecha_desde`, `fecha_hasta`, `motivo_cambio`. Append-only |

### 004-pronostico-demanda — 1 catálogo *(enmienda v1.2)*

| Catálogo | Reemplaza | Atributos propios |
|---|---|---|
| `tipo_evento_local` | `evento_local.tipo` CHECK (5 valores) | `afecta_demanda_al_alza` (un feriado sube la demanda, un corte de servicios la baja: el signo esperado es un dato, no una suposición del modelo — alimenta el descuento de confusores del Art. 5.6) |

### 005-promociones-inteligentes — 3 catálogos *(enmienda v1.1)*

| Catálogo | Reemplaza | Atributos propios |
|---|---|---|
| `tipo_origen_cupon` | `cupon.tipo_origen` CHECK | `es_automatico` (separa el cupón que dispara el sistema del que emite una persona — el denominador del % de cupones bien segmentados de OT2.3) |
| `tipo_descuento` | `cupon.descuento_tipo` CHECK `('porcentaje','monto_fijo')` | `valor_maximo_permitido` (tope de seguridad: un 200% de descuento no debe poder crearse) |
| `estado_cupon` | `cupon.estado` CHECK | `es_estado_final` |

### 006-caja-mermas-fraude — 5 catálogos *(enmienda v1.2)*

| Catálogo | Reemplaza | Atributos propios |
|---|---|---|
| `causa_merma` | `merma.causa` CHECK (4 valores) | **`es_atribuible_a_persona`** — es el atributo más importante de toda la enmienda: separa robo externo y caducidad (nadie responsable) de error humano y fraude interno (sí lo hay). Sin ese campo, el cruce merma × cuadre de caja de OT3.4 tiene que enumerar los códigos a mano en cada consulta |
| `resultado_investigacion` | `merma.resultado_investigacion` CHECK | `cierra_investigacion` |
| `estado_turno` | `turno_caja.estado` CHECK | `es_estado_final` |
| `estado_alerta` | `alerta_fraude_pago.estado` CHECK | `es_estado_final` |
| `estado_incidencia` | `incidencia_cuadre_caja.estado` CHECK | `es_estado_final` |

### 007-pagos-seguridad — 1 catálogo *(enmienda v1.1)*

| Catálogo | Reemplaza | Atributos propios |
|---|---|---|
| `estado_revision` | `revision_datafono.estado` CHECK `('actualizado','vencido')` | `cuenta_como_conforme` (define el numerador del % de terminales conformes de OT4.4 sin quemarlo en la consulta) |

### 008-compras-proveedores — 2 catálogos *(enmienda v1.2)*

| Catálogo | Reemplaza | Atributos propios |
|---|---|---|
| `forma_pago` | `orden_compra.forma_pago` CHECK `('contado','credito')` | `dias_plazo_default` (el crédito del proveedor tiene plazo; hoy ese dato no existe en ninguna parte) |
| `estado_orden_compra` | `orden_compra.estado` CHECK (4 valores) | `permite_recepcion` (una orden cancelada no admite recepciones — hoy esa regla vive solo en el servicio). **El estado sigue siendo derivado**: la FK agrega integridad, no convierte el campo en editable (RNF-CP-001 intacto) |

### 009-expansion-sucursales — 2 catálogos *(enmienda v1.1)*

| Catálogo | Reemplaza | Atributos propios |
|---|---|---|
| `estado_sucursal` | `sucursal.estado` CHECK | `opera_ventas` (una sucursal en apertura o cerrada no debe aparecer como origen de venta) |
| `item_checklist_apertura` | `checklist_apertura_sucursal.item` CHECK (8 valores) | `orden`, `es_bloqueante` (sin permiso municipal no se activa la sucursal; sin mobiliario sí se puede avanzar — hoy los 8 ítems pesan igual). Convierte el checklist en dato configurable en lugar de una lista quemada en el CHECK |

### 010-administracion — 5 catálogos *(enmienda v1.1)*

| Catálogo | Reemplaza | Atributos propios |
|---|---|---|
| `rol` | `usuario.rol` y `permiso_rol.rol` CHECK (4 valores, **duplicado en dos tablas**) | `nivel_jerarquico` (1 Dueño → 4 Cajero) y `alcance_cadena` (booleano: Dueño y Encargado de Compras ven toda la red; los demás solo su sucursal). Hoy esa regla del Art. 3.3 está escrita en el código de scoping, no en el modelo |
| `recurso_sistema` | `permiso_rol.recurso` y `log_auditoria.recurso` **TEXT libre, duplicado** | `modulo` (a qué módulo de `specs/` pertenece), `es_auditable`. Con FK desde ambas tablas, el log solo puede auditar recursos que existen en la matriz de permisos |
| `operacion` | `permiso_rol.operacion` CHECK `('crear','leer','actualizar')` | `es_escritura` |
| `tipo_solicitud_arco` | `solicitud_arco.tipo` CHECK (4 valores) | `plazo_respuesta_dias` (cada derecho ARCO tiene su plazo legal; hoy no está en el modelo) |
| `estado_solicitud_arco` | `solicitud_arco.estado` CHECK | `es_estado_final` |

### 011-analitica-reportes — 3 catálogos *(enmienda v1.1)*

| Catálogo | Reemplaza | Atributos propios |
|---|---|---|
| `modelo_ml` | `version_modelo_ml.modelo` CHECK (5 valores) | `algoritmo` (Isolation Forest, K-Means…), `metrica_principal` (cada modelo se evalúa con una métrica distinta; hoy la comparación de desempeño de OT4.1 no sabe cuál mirar) |
| `estado_ejecucion` | `ejecucion_pipeline_etl.estado` CHECK | `es_estado_final` |
| `estado_version_modelo` | `version_modelo_ml.estado` CHECK | `es_version_servible` (solo la versión activa responde consultas; `descartado_datos_insuficientes` no) |

---

## 4. Lo que deliberadamente NO se convierte

Dejar constancia de esto vale tanto como la lista de arriba: significa que la decisión fue analizada, no aplicada en automático.

| Campo | Por qué se queda como está |
|---|---|
| `log_auditoria.accion` (010) | Crece con **cada endpoint nuevo** del sistema. Un catálogo obligaría a insertar una fila cada vez que se agrega una operación, y una acción no registrada rompería la auditoría — exactamente el efecto contrario al que busca el Art. 10.5. Se queda TEXT con convención documentada (`verbo_recurso`) |
| `parametro_sistema.clave` / `.valor` (010) | Es un almacén clave-valor **por diseño** (IVA, moneda). Catalogar las claves sería catalogar el catálogo |
| `validacion_calidad.regla_validada` (011) | Interno del pipeline, lo escribe el propio DAG y crece con cada regla nueva. Mismo argumento que `accion` |
| `justificacion` (002, 003, 006) | Es texto explicativo obligatorio del Art. 5.9, no un valor de un conjunto cerrado. Catalogarlo destruiría su propósito |
| `evaluacion_churn`, `motivo_*`, `observacion` | Texto libre legítimo escrito por una persona |

---

## 5. Las dos tablas de historia (SCD tipo 2)

**Decisión aprobada**: tabla de historia **aparte**, no `fecha_desde`/`fecha_hasta` sobre la tabla operativa. La tabla operativa guarda solo el valor vigente (el POS consulta sin filtrar nada) y la historia crece append-only al lado. Es el mismo patrón que `historial_costo_producto`, que ya existe en 008 y ya funciona.

```sql
CREATE TABLE producto_clasificacion_historial (
    id                     BIGSERIAL PRIMARY KEY,
    producto_id            INTEGER     NOT NULL REFERENCES producto(id),
    clasificacion_codigo   VARCHAR(40) NOT NULL REFERENCES clasificacion_comercial(codigo),
    fecha_desde            TIMESTAMPTZ NOT NULL,
    fecha_hasta            TIMESTAMPTZ NULL,          -- NULL = vigente
    motivo_cambio          TEXT        NOT NULL,
    usuario_id             INTEGER     NULL REFERENCES usuario(id),
    CONSTRAINT ck_rango_valido CHECK (fecha_hasta IS NULL OR fecha_hasta > fecha_desde)
);
CREATE UNIQUE INDEX ux_prod_clasif_vigente
    ON producto_clasificacion_historial (producto_id)
    WHERE fecha_hasta IS NULL;   -- un producto no puede tener dos clasificaciones vigentes

CREATE TABLE cliente_segmento_historial (
    id                BIGSERIAL PRIMARY KEY,
    cliente_id        INTEGER     NOT NULL REFERENCES cliente(id),
    segmento_codigo   VARCHAR(40) NOT NULL REFERENCES segmento(codigo),
    fecha_desde       TIMESTAMPTZ NOT NULL,
    fecha_hasta       TIMESTAMPTZ NULL,
    version_modelo_id INTEGER     NOT NULL REFERENCES version_modelo_ml(id),
    CONSTRAINT ck_rango_valido CHECK (fecha_hasta IS NULL OR fecha_hasta > fecha_desde)
);
CREATE UNIQUE INDEX ux_cli_segmento_vigente
    ON cliente_segmento_historial (cliente_id)
    WHERE fecha_hasta IS NULL;
```

**Por qué el índice único parcial**: es lo que impide, a nivel de base de datos, que un producto tenga dos clasificaciones vigentes a la vez. Sin él, un error en el servicio deja el historial corrupto en silencio y todo el margen histórico de OT1.1 queda mal para siempre.

**Por qué `version_modelo_id` en el historial de segmento**: cuando el K-Means se reentrena y reclasifica a media clientela, hay que poder responder "¿esto lo cambió el modelo nuevo o el cliente cambió de comportamiento?". Sin esa FK, esa pregunta no tiene respuesta. Conecta 002 con 011.

---

## 6. Impacto en el modelo Fact-Dim

Los 32 catálogos son, casi uno a uno, las dimensiones que pedía `informes-simples-vs-compuestos.md` §5. Lo que allí se listaba como "tres catálogos nuevos que hoy son CHECK" ahora son 32 y ya existen en la BDR, así que el ETL **los copia, no los inventa**.

Las dos historias resuelven el requisito de SCD tipo 2 de `dim_producto` y `dim_cliente`: el ETL construye la dimensión versionada leyendo directamente `producto_clasificacion_historial` y `cliente_segmento_historial`, sin tener que reconstruir nada.

Las únicas dimensiones que siguen sin origen en la BDR son `dim_tiempo` y `dim_hora`, que se generan por script en el DAG de Airflow (tarea de inicialización, una sola vez).

---

## 7. Orden de aplicación

Módulo por módulo, sin mezclar, cada uno con su número de enmienda y sus 8 artefactos actualizados:

1. **001** (v1.3) — es la base: `categoria` y `unidad_medida` las referencian los demás
2. **002** (v1.1) y **003** (v1.2) — llevan las dos historias SCD tipo 2, son las más delicadas
3. **004** a **009** — catálogos de estado y tipo, mecánicos
4. **010** (v1.1) — `rol` y `recurso_sistema` reconstruyen la matriz RBAC con FK compuesta; **011** (v1.1)
5. **Verificación cruzada** — ningún CHECK huérfano, cada catálogo con su seed en la migración Alembic, y las dimensiones de la tabla de informes cuadrando con los catálogos creados

**Nota sobre los seeds**: cada catálogo necesita su `INSERT` de datos iniciales dentro de la misma migración Alembic que lo crea. Un catálogo vacío rompe la FK de la tabla que lo usa y deja el sistema sin arrancar — por eso el seed es parte de la migración, no un script aparte.

---

*Enmienda derivada del barrido completo de los 11 `data-model.md` de `specs/`. Cada catálogo lleva atributos propios justificados por un OT concreto de la cascada de objetivos; ninguno es una tabla de código-etiqueta vacía puesta por simetría.*
