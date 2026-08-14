# Sonidos del rider

`pedido-rider.mp3` - Loop corto (2-3s) que suena cuando llega un pedido nuevo
mientras la app está abierta. Reproducido por `ModalPedidoEntrante.jsx`.

Si no existe el archivo, el modal cae a un beep generado con Web Audio API
(ver `ModalPedidoEntrante.jsx`). Para reemplazar: arrastrar un .mp3 de 2-3
segundos a este directorio con ese nombre exacto.

Recomendación: usar el mismo chime que `pido-panel-restaurante` para
coherencia sonora dentro del ecosistema.
