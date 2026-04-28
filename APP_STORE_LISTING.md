# App Store Connect — ficha Pidoo Socio (com.pido.socio)

Borrador listo para copiar/pegar en App Store Connect.

---

## Información de la app

**Nombre (max 30):** `Pidoo Socio`

**Subtítulo (max 30):** `Reparte con Pidoo`

**Categoría primaria:** `Empresa` (Business) — la app es herramienta profesional para socios/repartidores
**Categoría secundaria:** `Productividad`

**Idioma principal:** `Español (España)`

**Bundle ID:** `com.pido.socio`

**SKU:** `pidoo-socio-001`

---

## Descripción larga (max 4000)

```
Pidoo Socio es la app oficial para los repartidores y socios del marketplace Pidoo, la plataforma de reparto de comida en Tenerife.

CARACTERÍSTICAS PRINCIPALES

- Recibe pedidos en tiempo real de los restaurantes vinculados a tu cuenta de socio.
- Entrega ágil con flujo paso a paso: aceptar, recoger, en camino, entregado.
- Notificaciones push para no perder ningún pedido aunque tengas la pantalla bloqueada.
- Ubicación en directo: el cliente sigue tu posición en su app durante el reparto.
- Historial completo de pedidos con detalle de items, propinas, distancia y tiempos.
- Vinculación con restaurantes: solicita unirte a los que quieras y empieza a recibir sus pedidos cuando aprueben.
- Configura tu zona de cobertura, tarifa y horario desde la app.

PARA QUIÉN

Esta app es solo para personas dadas de alta como socios en Pidoo. Si quieres ser socio o repartidor con nosotros, escríbenos a soporte desde la propia app.

Web: https://pidoo.es
Soporte: soporte@pidoo.es
```

---

## Descripción corta / Promotional Text (max 170)

```
La app oficial para socios y repartidores de Pidoo. Recibe pedidos, navega y entrega rápido en Tenerife. Solo para socios dados de alta en la plataforma.
```

---

## Palabras clave (max 100 caracteres separados por coma)

```
pidoo,socio,reparto,delivery,repartidor,riders,pedidos,tenerife,marketplace,canarias
```

---

## URL de soporte

```
https://pidoo.es/contacto
```

(Confirmar que la página existe; si no, usar `https://pidoo.es` o crear `/soporte`.)

---

## URL de marketing (opcional)

```
https://pidoo.es
```

---

## Política de privacidad (obligatoria)

```
https://pidoo.es/privacidad
```

(Verificar que la página `/privacidad` está pública y al día.)

---

## Calificación por edad

- **No restringido** / `4+`
- Sin contenido violento, sexual, gambling, drogas, alcohol, etc.

---

## Privacidad de la app (App Privacy)

Datos recopilados, todos LINKED al usuario, sin tracking de terceros:

| Tipo | Categoría | Uso |
|---|---|---|
| Email | Datos de contacto | Funcionalidad de la app (login) |
| Nombre | Datos de contacto | Funcionalidad de la app |
| Teléfono | Datos de contacto | Funcionalidad de la app |
| Ubicación precisa | Ubicación | Funcionalidad de la app (asignación + tracking en pedidos) |
| ID de dispositivo | Identificadores | Funcionalidad de la app (FCM token push) |
| Interacciones con producto | Uso | Funcionalidad de la app (logs internos) |

Ninguno marcado para **Tracking** ni **Third-Party Advertising**.

---

## What's New (changelog v1.0.0)

```
Primera versión de Pidoo Socio para iOS.
- Recibe pedidos en tiempo real
- Notificaciones push
- Tracking de entrega con ubicación en directo
- Historial completo de pedidos
- Gestión de restaurantes vinculados
```

---

## Capturas necesarias

iOS exige al menos 1 captura para cada uno de estos tamaños (al subir 1, el resto se autoescalan, pero recomendado tener nativos):

- **iPhone 6.7" / 6.9"** (1290×2796 o 1320×2868) — 3-10 capturas
- **iPhone 6.5"** (1242×2688) — 3-10 capturas (opcional si usas 6.7")
- **iPad Pro 13"** (2064×2752) — 3-10 capturas (solo si la app está disponible para iPad)

Pidoo Socio es solo iPhone (`UISupportedInterfaceOrientations~ipad` sigue ahí pero la app práctica es retrato móvil), así que con 6.7" basta.

Capturas sugeridas (5):
1. Login — pantalla de acceso con logo Pidoo Socio
2. Dashboard — pedidos del día + botón Online
3. Pedido entrante — modal con dirección + cliente + monto
4. Tracking — mapa con ruta al cliente
5. Mis ganancias / facturas — semana liquidada

Generación: usar Chrome DevTools modo iPhone 15 Pro Max (430×932 lógicos = 1290×2796 reales con DPR=3) cargando `socio.pidoo.es` con sesión activa.

---

## Información de revisión App Store

### Cuenta de demostración (obligatoria)

App Review necesita poder entrar para probar la app. Crear un socio de prueba:

```
Email:     review-apple@pidoo.es
Password:  PidooReview2026!
```

Asegurar que ese socio:
- Está aprobado y activo
- Tiene al menos 1 restaurante vinculado
- Está marcado como "online" o se puede poner online fácilmente
- Tiene algún pedido de prueba reciente para que vean el historial

### Notas para el revisor

```
Pidoo Socio es la app de reparto del marketplace de comida Pidoo.es,
operativa en Tenerife (España). La app está restringida a personas
registradas como socios en la plataforma.

Cuenta demo:
Email: review-apple@pidoo.es
Password: PidooReview2026!

Esta cuenta tiene un restaurante de prueba vinculado y aparece como
online por defecto, listo para recibir un pedido de prueba.

Para probar el flujo completo de reparto, podemos coordinar un pedido
real desde la app cliente Pidoo (com.pidoo.app) hacia esta cuenta demo
si lo solicitan. Contacto: soporte@pidoo.es

La app NO recopila datos para fines publicitarios ni vende información
a terceros. La ubicación solo se usa mientras el socio está "online" y
exclusivamente para asignar pedidos cercanos y mostrar la posición al
cliente durante la entrega activa.
```

---

## Disponibilidad

- **Países**: solo **España** (Tenerife) — opcionalmente añadir todos los países pero la app solo es útil en Tenerife.
- **Precio**: Gratis.
- **In-App Purchases**: ninguno aún (la suscripción 39€/70€ del socio se gestiona vía Stripe externo, no IAP — riesgo: Apple puede exigir IAP si lo detecta como contenido digital. Para v1 mantenemos sin IAP y vemos si el revisor objeta).

---

## Pendientes de Marlon antes de enviar a revisión

- [ ] Crear el usuario `review-apple@pidoo.es` en producción y vincularle un restaurante de prueba.
- [ ] Verificar que `pidoo.es/privacidad` y `pidoo.es/contacto` están al día.
- [ ] Generar 5 capturas iPhone 6.7" desde Chrome DevTools.
- [ ] Subir build firmado desde Xcode (versión 1.0.0, build 1).
- [ ] Pegar el build seleccionado en la sección "Build" de la versión 1.0.0.
- [ ] Rellenar App Privacy (formulario interactivo basado en la tabla de arriba).
- [ ] Enviar a revisión.
