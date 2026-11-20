# 🍧 Marcianos de la Risa · Panel de administración

Panel colaborativo en tiempo real para un negocio de marcianos (chupetes helados) artesanales:
ventas y delivery, producción, inventario, pago por unidad a cocina y vendedores, incentivos por
niveles, reportes y auditoría permanente.

- **Frontend:** HTML + CSS Grid + JavaScript vanilla · PWA instalable · GitHub Pages (gratis)
- **Backend:** Supabase plan gratuito · PostgreSQL + Auth (anónima) + Realtime + Row Level Security
- **Idioma / moneda:** español (Perú) · S/ 0.00 · hora de Lima

```
/index.html          estructura de la app (login, menú lateral/inferior, FAB, modal)
/styles.css          estilos, variables de marca, modo claro/oscuro, impresión
/app.js              lógica: sesión, rutas, vistas por rol, realtime, presencia, offline
/manifest.json       PWA
/sw.js               service worker (offline de lectura)
/config.js           URL y clave pública (anon) de Supabase
/icons/              logo e íconos generados desde tu logo
/sql/schema.sql      tablas, triggers, funciones de negocio, datos de prueba
/sql/rls_policies.sql  RLS, permisos de funciones, realtime y presencia
```

---

## 1. Crear el proyecto en Supabase (gratis)

1. Entra a <https://supabase.com> → **Start your project** → inicia sesión con GitHub.
2. **New project** → nombre `marcianos`, contraseña de base de datos (guárdala), región **South America (São Paulo)**, plan **Free**.
3. Espera 1–2 minutos a que el proyecto esté listo.
4. **Activa el inicio de sesión anónimo** (lo usa el login por clave):
   *Authentication → Sign In / Providers → **Allow anonymous sign-ins** → ON → Save.*
   Recomendado: en la misma sección activa **CAPTCHA** más adelante si abres el panel a mucha gente.
5. Copia tus credenciales públicas: *Project Settings → API Keys* (o *Data API*):
   - **Project URL** → `https://xxxx.supabase.co`
   - **anon public** (o **publishable**) key
6. Pégalas en `config.js`:
   ```js
   SUPABASE_URL: 'https://xxxx.supabase.co',
   SUPABASE_ANON_KEY: 'eyJhbGciOi...  ó  sb_publishable_...',
   ```
   ⚠️ Nunca pongas la clave `service_role` / `secret` en el frontend.

> El plan gratuito pausa el proyecto tras 7 días **sin ninguna actividad**. Con uso diario no pasa;
> si se pausa, se reactiva con un clic en el dashboard de Supabase.

## 2. Ejecutar las migraciones

En Supabase → **SQL Editor** → **New query**:

1. Pega **todo** `sql/schema.sql` → **Run**. (Crea tablas, funciones, triggers y datos de prueba.)
2. Nueva query → pega **todo** `sql/rls_policies.sql` → **Run**. (Activa RLS, Realtime y presencia.)

Ambos archivos se pueden volver a ejecutar sin romper nada (idempotentes).
Comprobación rápida: *Table Editor* debe mostrar `pedidos`, `sales`, `audit_log`, etc. con el candado
**RLS enabled**, y *Database → Publications → supabase_realtime* debe incluir `pedidos`, `sales`,
`inventory`, `payments`…

## 3. Publicar en GitHub Pages

1. Crea un repositorio en GitHub (puede ser público), p. ej. `marcianos-panel`.
2. Sube todos los archivos manteniendo la estructura (botón **Add file → Upload files**, arrastra la carpeta completa).
3. *Settings → Pages → Build and deployment → Source: **Deploy from a branch** → Branch: `main` / `(root)` → Save.*
4. En 1–2 minutos tendrás la URL: `https://TU-USUARIO.github.io/marcianos-panel/`.
5. Cada vez que publiques cambios, sube el número de `VERSION` en `sw.js` para que los celulares descarguen la versión nueva.

Todas las rutas son relativas, así que funciona en la subcarpeta de GitHub Pages sin configuración extra.

## 4. Instalar como app (PWA)

- **Android (Chrome):** abre la URL → menú ⋮ → **Instalar app** (o el botón "📲 Instalar app" en *Mi perfil*).
- **iPhone (Safari):** abre la URL en Safari → **Compartir** → **Agregar a pantalla de inicio**.
- Se abre a pantalla completa, sin barra del navegador, con tu logo como ícono. Sin internet muestra los
  últimos datos vistos con el aviso "Sin conexión".

## 5. Credenciales de prueba

Creadas por `schema.sql`, válidas **30 días**. Se escriben en la pantalla de ingreso (no distingue mayúsculas):

| Rol | Persona | Clave |
|---|---|---|
| Super Admin / Dueño | Dueño (Super Admin) | `DEMO-SUPER-2026` |
| Gerente (Sucursal A) | Gerente Sucursal A | `DEMO-GERENTE-A` |
| Cocina (Sucursal A) | Cocinera Sucursal A | `DEMO-COCINA-A` |
| Repartidor / Vendedor (Sucursal A) | Repartidor Sucursal A | `DEMO-VENDEDOR-A` |
| Solo lectura (contabilidad) | Contabilidad | `DEMO-LECTURA` |
| *Extra para probar aislamiento:* Gerente Sucursal B | Gerente Sucursal B | `DEMO-GERENTE-B` |
| *Extra:* Vendedor Sucursal B | Vendedor Sucursal B | `DEMO-VENDEDOR-B` |

**Al pasar a producción:** entra como Super Admin → *Usuarios y claves* → genera tu clave personal →
pestaña *Claves* → **Revocar** todas las `DEMO-…`. Cambia los nombres de las personas de prueba o desactívalas.

---

## 6. Cómo funciona (decisiones técnicas)

### Login con clave (sin registro público)
1. La app crea una sesión **anónima** de Supabase Auth (`supabase.auth.signInAnonymously()`).
2. Llama a `supabase.rpc('canjear_clave', { p_clave })`. La función valida la clave en `access_keys`
   (activa, no vencida, de un solo uso o temporal), y vincula la sesión con la persona en `sesiones`.
3. Todas las políticas RLS usan `mi_admin_id()`, que solo devuelve a la persona si su sesión sigue activa.
   Por eso **cerrar sesión remota** (`cerrar_sesiones`) corta el acceso al instante; además la app recibe el
   cambio por Realtime y vuelve al login.
4. Anti fuerza bruta: 8 intentos fallidos en 15 min bloquean ese dispositivo/IP.
5. Para agregar **2FA** más adelante: añadir un segundo paso en `canjear_clave` (p. ej. código TOTP en una
   tabla `segundo_factor`) sin cambiar RLS, porque todo depende de `sesiones.activa`.

### Reglas de negocio en la base de datos (no se pueden saltar desde el navegador)
| Regla | Dónde |
|---|---|
| Cocinero: S/ 0.20 × marciano preparado | `registrar_lote` + trigger `trg_lote_efectos` → `payments` |
| Vendedor: S/ 0.30 × marciano vendido | `registrar_venta` + trigger `trg_sales_efectos` → `payments` |
| Bonos acumulables 500 / 1 000 / 2 000 (S/ 20 / 50 / 120), reinicio por periodo | `recalcular_progreso` → `bonuses`, `seller_progress`, `payments` |
| Delivery mínimo 20 para envío gratis | `registrar_venta` (rechaza o cobra según configuración) |
| Precio sugerido = costo ÷ (1 − 0.70); precio entre S/ 2.00 y S/ 3.00 | columna generada `flavors.margen`, trigger `trg_flavor_precio`, `dashboard_kpis` |
| Stock: producción (+), venta (−), ajuste (±) | `mover_inventario` → `inventory`, `inventory_movements` |
| Reversión: anular devuelve stock, anula pagos y recalcula bonos (si ya se pagó, crea un ajuste negativo) | `anular_pedido`, `revertir_auditoria`, `anular_pago_de` |

Las tablas de negocio **no tienen políticas de escritura**: solo se modifican mediante funciones RPC
`SECURITY DEFINER` que revisan rol, sucursal y la matriz de permisos (`tiene_permiso`). Las funciones
internas (`mover_inventario`, `recalcular_progreso`…) no son invocables desde la API.

### RLS por rol
- **Super Admin:** todo. **Solo lectura:** todo (o solo su sucursal, si se le asigna una), sin escribir.
- **Gerente:** filas con `branch_id` = su sucursal.
- **Cocina:** sus lotes, pagos y disponibilidad. **Vendedor:** sus pedidos, ventas, pagos, bonos y el stock de su punto.
- Los paneles (`dashboard_kpis`, `panel_vendedor`, `panel_cocina`, `reporte`) son `SECURITY INVOKER`:
  calculan solo sobre las filas que RLS deja ver a quien consulta.

### Tiempo real (< 2 s)
- `supabase.channel('cambios-…').on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, …)`
  (una suscripción por tabla: `pedidos`, `sales`, `inventory`, `production_batches`, `payments`, `bonuses`,
  `seller_progress`, `sesiones`, `flavors`, `configuracion`, `access_keys`). Realtime respeta RLS.
  *Nota:* `supabase.from(...).on(...)` era la API de supabase-js v1; en v2 se usa `.channel().on('postgres_changes')`.
- **Presencia:** canal privado `presencia` con `channel.track()` y `presenceState()`; protegido por políticas
  en `realtime.messages`. Si tu proyecto no las acepta, pon `PRESENCIA_PRIVADA: false` en `config.js`.
- **Reconexión:** ante `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED` se reintenta con backoff exponencial
  (1 s, 2 s, 4 s… máx. 30 s) y al reconectar se recarga la vista para recuperar eventos perdidos.
  **Heartbeat:** `rpc('latido')` cada 25 s (confirma sesión y conexión) + heartbeat del socket cada 15 s.
- **Conflictos:** cada tabla editable tiene `version` + `updated_at` (trigger `tocar_version`). Al guardar se
  envía `.eq('version', v)`; si otra persona guardó antes, aparece el aviso **"Recargar / Guardar de todos
  modos"** (last write wins solo si tú lo eliges). Si alguien cambia el registro que tienes abierto, se avisa en vivo.
- Auditoría: refresco cada 10 s. Reportes y configuración: al abrir la pantalla.

### Auditoría permanente
`audit_log` registra quién, qué, cuándo, valor anterior/nuevo, IP y dispositivo (cabeceras de la
petición). Un trigger impide **cualquier** UPDATE o DELETE sobre la tabla. "Revertir" no borra nada:
inserta una entrada nueva `REVERTIR` que apunta a la original (`revierte_a`) y aplica el cambio inverso.

### Supuestos que tomé (todos configurables en *Configuración*)
1. **Niveles:** Novato (0) → Bronce (500) → Plata (1 000) → Oro (2 000). Puedes añadir "Platino" con su umbral y bono.
2. **Lotes:** el stock y el pago del cocinero se registran al momento; si el gerente **rechaza** el lote, ambos se revierten. Los lotes que registra un gerente quedan aprobados.
3. **Delivery < 20:** se **rechaza** por defecto (criterio 5). Alternativa: "Cobrar delivery" (S/ 5.00 configurable).
4. **Pedidos con varios sabores:** una venta es un pedido con líneas por sabor; el mínimo de delivery cuenta el total del pedido.
5. **Gerente:** no crea usuarios ni cambia roles (solo el Super Admin), pero sí genera claves, restablece acceso y cierra sesiones de **su** cocina/vendedores, aprueba lotes y bonos, asigna repartidor a pedidos delivery y liquida pagos de su sucursal.
6. **Revertir:** solo Super Admin (editable en la matriz de permisos).
7. **Sin stock:** por defecto no se puede vender más de lo producido; se puede permitir en Configuración.

---

## 7. Plan de verificación (criterios de aceptación)

Preparación: proyecto creado, ambos SQL ejecutados, `config.js` completado y la app publicada.
Usa un **celular** y una **laptop**. Las claves están en la sección 5.

**1. Mismos datos en móvil y laptop**
1. En la laptop entra con `DEMO-SUPER-2026`; en el celular, con la misma clave (es temporal y reutilizable).
2. Abre *Dashboard* en ambos con el filtro "Todas". ✅ KPIs, gráfico y rankings idénticos.

**2. Venta en móvil → dashboard del gerente en < 2 s sin recargar**
1. Laptop: entra con `DEMO-GERENTE-A` y deja abierto *Dashboard*. Verifica el punto verde **"En vivo"** arriba.
2. Antes, como Super Admin o Gerente A, registra un lote (*Registrar lote*: Fresa, 200) para tener stock.
3. Celular: entra con `DEMO-VENDEDOR-A` → botón **Vender** → Fresa +10 → **Registrar venta**.
4. ✅ En la laptop "Ventas hoy" y el gráfico cambian solos (normalmente en menos de 1 s). Mídelo con un cronómetro o grabando ambas pantallas.

**3. 500 marcianos → S/ 150 + bono S/ 20 y nivel Bronce**
1. Como Gerente A registra lotes hasta tener ≥ 500 en stock (p. ej. Maracuyá 300 + Mango 300).
2. Como `DEMO-VENDEDOR-A` registra ventas hasta sumar **500** en el mes (p. ej. 300 + 200; recuerda que en el paso 2 ya vendiste 10, así que completa 490).
3. ✅ Aparece el aviso 🎉 "¡Nivel Bronce desbloqueado! Bono de S/ 20.00".
4. ✅ *Mi panel*: insignia **Bronce**, "Comisiones S/ 150.00 · Bonos S/ 20.00", total **S/ 170.00**, "Te faltan 500 para Plata".
5. ✅ Como Super Admin → *Incentivos* muestra el bono; *Pagos y nómina* muestra S/ 150.00 + S/ 20.00 para el vendedor.

**4. Cocinero prepara 100 → acumulado S/ 20.00**
1. Entra con `DEMO-COCINA-A` → **Lote** → elige sabor → cantidad **100** → ve "Pago al cocinero S/ 20.00" → **Registrar lote**.
2. ✅ *Mi panel* muestra **S/ 20.00** acumulado y "100 en el periodo" (suma con lotes anteriores de esta cocinera si los hubo).

**5. Delivery de 19 rechazado**
1. Como `DEMO-VENDEDOR-A` → Vender → activa **🛵 Es delivery** → pon **19** marcianos.
2. ✅ El resumen muestra en rojo "Mínimo 20 para envío gratis · faltan 1. El pedido será rechazado."
3. Presiona **Registrar venta**. ✅ El servidor responde: **"Pedido delivery rechazado: mínimo 20 marcianos para envío gratis (este pedido tiene 19)."** y no se guarda nada (stock igual).
4. Súbelo a 20 → ✅ "Envío gratis" y se registra.

**6. Cambiar costo → margen recalculado y alerta < 70 %**
1. Super Admin → *Sabores y precios* → **Editar** Maracuyá (precio S/ 2.00).
2. Cambia el costo a **1.00**. ✅ En vivo: "Margen bruto 50.0 % · sugerido S/ 3.33" en rojo.
3. **Guardar**. ✅ Aviso "Margen de Maracuyá cayó a 50.0 % (bajo 70 %)…", chip rojo en la lista y alerta **"Margen bajo"** en el Dashboard.

**7. Gerente no ve otra sucursal (RLS)**
1. Registra una venta en la Sucursal B con `DEMO-VENDEDOR-B` (primero un lote en B como Super Admin eligiendo "Sucursal B").
2. Entra con `DEMO-GERENTE-A`: ✅ en *Ventas*, *Inventario*, *Pagos* y *Dashboard* solo aparece la Sucursal A.
3. Prueba directa de RLS (sin la interfaz): en la laptop con sesión de Gerente A abre la consola del navegador (F12) y ejecuta:
   ```js
   const sb = supabase.createClient(MARCIANOS_CONFIG.SUPABASE_URL, MARCIANOS_CONFIG.SUPABASE_ANON_KEY, { auth: { storageKey: 'marcianos-auth' } });
   (await sb.from('sales').select('branch_id')).data.filter(s => s.branch_id === '00000000-0000-4000-a000-00000000000b').length
   ```
   ✅ Resultado `0`. Con `DEMO-SUPER-2026` el mismo código devuelve > 0.
4. Prueba en SQL Editor (opcional): `select count(*) from sales where branch_id = '00000000-0000-4000-a000-00000000000b';` ejecutado como `postgres` muestra el total real, que el gerente nunca recibe.

**8. Super Admin revierte una venta → inventario y pagos vuelven atrás**
1. Anota el stock de Fresa en Sucursal A (*Inventario*) y el total del vendedor (*Pagos*).
2. Registra como vendedor una venta de 30 Fresa.
3. Super Admin → *Auditoría* → filtra Módulo "ventas", Acción "INSERT" → en la entrada **`pedidos`** pulsa **↩ Revertir** → confirma.
4. ✅ Aviso "Pedido anulado: stock devuelto, pagos y bonos recalculados". El stock vuelve al valor anotado, el pago de S/ 9.00 queda anulado, y si esa venta había hecho cruzar un hito, el bono y el nivel retroceden.
5. ✅ La entrada original muestra "↩ Revertido" y aparece una nueva entrada `REVERTIR` (la reversión también se puede revertir).
   *(Alternativa: Ventas → botón **Anular** con motivo.)*

**9. Auditoría permanente**
1. *Auditoría* lista cada login, venta, lote, cambio de precio, clave generada, etc. con persona, fecha/hora, IP y dispositivo; "Ver cambios" muestra anterior vs. nuevo.
2. En SQL Editor intenta: `delete from audit_log;` y `update audit_log set accion = 'x';`
3. ✅ Ambos fallan con **"El registro de auditoría es permanente: no se puede modificar ni borrar."**

**10. Instalación PWA sin barra de navegador**
1. Android: Chrome → ⋮ → **Instalar app** (o *Mi perfil → Instalar app*). iPhone: Safari → Compartir → **Agregar a pantalla de inicio**.
2. ✅ Ícono del marciano en la pantalla de inicio; al abrir, pantalla completa sin barra de direcciones.
3. Activa modo avión y abre la app: ✅ carga el último dashboard con el aviso "Sin conexión".

**11. Pantalla de 375 px**
1. Laptop: Chrome → F12 → modo dispositivo → **iPhone SE / 375 × 667**.
2. Recorre Inicio, Vender, Ventas, Producción, Inventario, Usuarios, Reportes y Configuración con cada rol.
3. ✅ Sin scroll horizontal de la página (las tablas largas se desplazan dentro de su recuadro), menú inferior y botón flotante al alcance del pulgar.

---

## 8. Personalización de marca

*Configuración → Negocio y marca*: nombre, URL del logo y 5 colores (primario, secundario, acento, alerta,
tinta). Se guardan en la base de datos y se aplican a todo el equipo como variables CSS
(`--marca-primario`, etc.). Los valores por defecto se extrajeron de tu logo:
cielo `#1B9CDA`, turquesa `#36E4D7`, naranja `#EE9B23`, coral `#FA4A2F`, azul marino `#12163A`.
Para cambiar el ícono de la app reemplaza los PNG de `/icons` con los mismos nombres.

## 9. Solución de problemas

| Síntoma | Causa / solución |
|---|---|
| "Falta activar Anonymous sign-ins" | Paso 1.4. |
| Pantalla "Falta conectar Supabase" | `config.js` aún tiene `TU-PROYECTO`. |
| "Clave inválida, vencida o revocada" | Las claves demo duran 30 días: genera nuevas como Super Admin (o vuelve a crear una con SQL: `insert into access_keys(admin_id,key,expira) values ('00000000-0000-4000-b000-000000000001','MI-CLAVE', now()+interval '30 days');`). |
| Punto rojo "Reconectando…" | Sin internet o proyecto pausado; se reconecta solo. |
| No aparece "Conectados ahora" | Pon `PRESENCIA_PRIVADA: false` en `config.js`. |
| Cambié archivos y el celular sigue igual | Sube `VERSION` en `sw.js` y usa *Mi perfil → Buscar actualización*. |
