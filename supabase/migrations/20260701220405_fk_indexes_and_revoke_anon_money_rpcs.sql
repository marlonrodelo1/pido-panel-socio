-- Índices de cobertura para FKs de tablas activas (advisor unindexed_foreign_keys).
create index if not exists idx_socio_est_establecimiento_id on public.socio_establecimiento(establecimiento_id);
create index if not exists idx_rider_accounts_creado_por on public.rider_accounts(creado_por);
create index if not exists idx_rider_accounts_est_origen on public.rider_accounts(establecimiento_origen_id);
create index if not exists idx_movimientos_cuenta_est_id on public.movimientos_cuenta(establecimiento_id);
create index if not exists idx_movimientos_cuenta_pedido_id on public.movimientos_cuenta(pedido_id);
create index if not exists idx_establecimientos_captador_socio on public.establecimientos(captador_socio_id);
create index if not exists idx_establecimientos_rider_unico on public.establecimientos(rider_unico_id);
create index if not exists idx_direcciones_usuario_usuario_id on public.direcciones_usuario(usuario_id);

-- Revocar EXECUTE a anon en RPCs de dinero/reporting (derivan de auth.uid(); anon no
-- debe invocarlas). Se mantiene authenticated, que es quien las usa desde el panel.
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'calcular_liquidacion_restaurante',
        'siguiente_correlativo_factura_socio',
        'get_por_cobrar_socio',
        'get_socio_por_cobrar_restaurantes',
        'get_detalle_por_cobrar_socio',
        'get_ingresos_socio_rango',
        'get_ganancias_socio_rango'
      )
  loop
    execute format('revoke execute on function %s from anon', fn.sig);
  end loop;
end $$;
