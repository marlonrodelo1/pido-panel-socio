-- Integridad (2 jul 2026): un pedido del marketplace de un socio nace SIEMPRE con socio_id.
--
-- Por que TRIGGER BEFORE INSERT y no CHECK constraint:
--   el flujo de desvinculacion (desvincular-socio-establecimiento) LIBERA los pedidos
--   activos poniendo socio_id = NULL + shipday_status = 'no_rider'. Un CHECK se evalua
--   tambien en cada UPDATE y romperia esa liberacion. El invariante real del negocio es
--   "no puede NACER un pedido de marketplace sin socio": eso es un guard de INSERT.

create or replace function public.pedidos_enforce_marketplace_socio()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.origen_pedido = 'marketplace_socio' and new.socio_id is null then
    raise exception 'pedido de marketplace_socio requiere socio_id';
  end if;
  return new;
end
$$;

drop trigger if exists trg_pedidos_marketplace_socio_id on public.pedidos;
create trigger trg_pedidos_marketplace_socio_id
  before insert on public.pedidos
  for each row execute function public.pedidos_enforce_marketplace_socio();
