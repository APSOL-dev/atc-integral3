## Sincronización Espejo SQL Server — Supabase y Cola Buffer Outbound

**Qué hace:** 
Garantiza que la aplicación web funcione de manera completamente autónoma, ultra-rápida y tolerante a fallos de red hacia el servidor local de SQL Server en San Juan (Casa29 / `sj.atodocolor.com.ar`). 
La lectura de catálogos (clientes, productos, vendedores) y pedidos de SQL Server se realiza directamente desde vistas y tablas espejo aisladas en Supabase (`atc_migración.sql_*`), mientras que las acciones generadas en la app (aprobación de borradores de estado 0 a 1, edición de pedidos 0.0, anulaciones) se persisten inmediatamente en Supabase y se encolan en un búfer transaccional (`atc_migración.sync_cola_pedidos`) para impactar en SQL Server de forma asíncrona con reintentos automáticos.

---

**Escenarios cubiertos:**
- **Lectura Offline-Ready / Sin Bloqueos:**
  - `GET /api/clientes`, `GET /api/productos` y `GET /api/pedidos` leen desde las vistas espejo de Supabase (`atc_sql_clientes_v`, `atc_sql_productos_v`, `atc_sql_vendedores_v`, `atc_sql_pedidos_cabe_v`, `atc_sql_pedidos_deta_v`).
  - Las caídas de red o demoras en la conexión TCP a San Juan ya no degradan la velocidad ni impiden la navegación de los vendedores.
- **Sincronización Periódica en Segundo Plano:**
  - Un worker programado en Node.js consulta SQL Server periódicamente (cada 20 minutos) e inserta/actualiza las novedades en las tablas espejo de Supabase.
- **Sincronización Manual Forzada:**
  - Endpoint `POST /api/sync/forzar` y botón "Sincronizar" en la barra de navegación del frontend para actualizar el espejo a demanda.
- **Impacto de Pedidos Salientes (App ➔ SQL Server):**
  - Al pasar un pedido a estado `1`, `1.` o anular `0.0.99`, el cambio se guarda en Supabase y se agrega a la cola `sync_cola_pedidos` con estado `PENDIENTE`.
  - El procesador de cola intenta enviar la transacción a SQL Server inmediatamente. Si SQL Server está caído, la orden permanece encolada sin pérdida de información hasta que se restablezca la conexión.

---

**Casos borde conocidos:**
- **Caída prolongada de conexión con San Juan:**
  - Los vendedores pueden seguir creando borradores (estado 0), editando y pasando pedidos a estado 1. Todo queda resguardado en Supabase y se despacha a SQL Server al reconectar.
- **Caché inicial en frío:**
  - Si las tablas espejo aún no contienen datos en el primer arranque, el sistema realiza fallback transparente a SQL Server.
- **Timeouts o resolución DNS dinámica:**
  - Se utiliza resolución DNS pública dual (8.8.8.8 / 1.1.1.1) y timeouts de conexión de 30 segundos en la capa MSSQL.

---

**Restricciones o supuestos:**
- Las tablas nativas de Supabase (`atc_migración.usuarios`, `atc_migración.pedidos`, `atc_migración.detalles_pedidos`, `atc_migración.descuentos_marca`) no se modifican ni se alteran sus contratos para preservar la compatibilidad con las aplicaciones existentes.
- Los pedidos creados localmente en la app inician en `atc_pedidos_v` y migran a las tablas de SQL Server únicamente al ser confirmados/aprobados (estado 1 o similar).
