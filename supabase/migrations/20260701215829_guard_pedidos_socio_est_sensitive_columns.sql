-- Guard de columnas sensibles vía trigger BEFORE UPDATE.
-- Las políticas RLS de `pedidos` y `socio_establecimiento` permiten al usuario final
-- (cliente / socio) actualizar SU fila sin restricción de columnas, de modo que un
-- cliente podía bajar importes (subtotal/coste_envio → total recalculado menor) o un
-- socio cambiar su comisión/tarifas saltándose el flujo de propuestas.
-- Los flujos legítimos escriben con la SERVICE ROLE (edge functions) o SQL directo
-- (crons) → hacen BYPASS. Solo se restringe al usuario final autenticado vía PostgREST.

create or replace function public._ctx_is_trusted_writer()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  claims text := current_setting('request.jwt.claims', true);
  jrole  text;
begin
  if claims is null or claims = '' then
    return true; -- conexión directa (migraciones, pg_cron, psql)
  end if;
  begin
    jrole := (claims::jsonb ->> 'role');
  exception when others then
    jrole := null;
  end;
  if jrole = 'service_role' then
    return true; -- edge functions (escrituras legítimas)
  end if;
  if public.is_superadmin() then
    return true;
  end if;
  return false;
end;
$$;

create or replace function public.pedidos_guard_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owns_est boolean;
begin
  if public._ctx_is_trusted_writer() then
    return new;
  end if;

  if new.total is distinct from old.total
     or new.subtotal is distinct from old.subtotal
     or new.coste_envio is distinct from old.coste_envio
     or new.propina is distinct from old.propina
     or new.descuento is distinct from old.descuento
     or new.comision_pidoo_pct_override is distinct from old.comision_pidoo_pct_override
     or new.monto_reembolsado is distinct from old.monto_reembolsado
     or new.stripe_refund_id is distinct from old.stripe_refund_id
  then
    raise exception 'pedidos: no autorizado a modificar importes/reembolso del pedido'
      using errcode = '42501';
  end if;

  owns_est := public._user_owns_establecimiento(new.establecimiento_id);
  if (new.socio_id is distinct from old.socio_id
      or new.rider_account_id is distinct from old.rider_account_id)
     and not owns_est
  then
    raise exception 'pedidos: no autorizado a reasignar el pedido'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_pedidos_guard_update on public.pedidos;
create trigger trg_pedidos_guard_update
  before update on public.pedidos
  for each row execute function public.pedidos_guard_update();

create or replace function public.socio_est_guard_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public._ctx_is_trusted_writer() then
    return new;
  end if;

  if new.comision_pct is distinct from old.comision_pct
     or new.tarifa_base is distinct from old.tarifa_base
     or new.tarifa_maxima is distinct from old.tarifa_maxima
     or new.tarifa_precio_km is distinct from old.tarifa_precio_km
     or new.tarifa_radio_base_km is distinct from old.tarifa_radio_base_km
     or new.tarifa_pendiente is distinct from old.tarifa_pendiente
     or new.tarifa_pendiente_origen is distinct from old.tarifa_pendiente_origen
     or new.estado is distinct from old.estado
     or new.exclusivo is distinct from old.exclusivo
     or new.es_captador is distinct from old.es_captador
  then
    raise exception 'socio_establecimiento: tarifas/comisión/estado solo se cambian por el flujo de propuestas'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_socio_est_guard_update on public.socio_establecimiento;
create trigger trg_socio_est_guard_update
  before update on public.socio_establecimiento
  for each row execute function public.socio_est_guard_update();
