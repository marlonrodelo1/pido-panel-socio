-- Optimización RLS (advisor auth_rls_initplan): envolver auth.uid()/role()/jwt()/email()
-- en (select ...) para que el planificador las evalúe UNA vez por consulta en lugar de
-- por fila. Semánticamente idéntico (son STABLE). Solo toca políticas con la forma
-- "desnuda" (no ya envueltas). Idempotente y transaccional. (108 políticas afectadas.)
do $$
declare r record; stmt text; n int := 0;
begin
  for r in
    with pol as (
      select c.relname as tbl, p.polname as pol,
        pg_get_expr(p.polqual, p.polrelid) as ou,
        pg_get_expr(p.polwithcheck, p.polrelid) as oc
      from pg_policy p
      join pg_class c on c.oid=p.polrelid
      join pg_namespace nsp on nsp.oid=c.relnamespace
      where nsp.nspname='public'
    )
    select tbl, pol, ou, oc,
      case when ou is not null and ou ~* 'auth\.(uid|jwt|role|email)\s*\(\s*\)' and ou !~* 'select\s+auth\.'
           then regexp_replace(ou, 'auth\.(uid|jwt|role|email)\s*\(\s*\)', '(select auth.\1())', 'g') else ou end as nu,
      case when oc is not null and oc ~* 'auth\.(uid|jwt|role|email)\s*\(\s*\)' and oc !~* 'select\s+auth\.'
           then regexp_replace(oc, 'auth\.(uid|jwt|role|email)\s*\(\s*\)', '(select auth.\1())', 'g') else oc end as nc
    from pol
  loop
    if (r.ou is distinct from r.nu) or (r.oc is distinct from r.nc) then
      stmt := format('alter policy %I on public.%I', r.pol, r.tbl);
      if r.ou is not null then stmt := stmt || format(' using (%s)', r.nu); end if;
      if r.oc is not null then stmt := stmt || format(' with check (%s)', r.nc); end if;
      execute stmt;
      n := n + 1;
    end if;
  end loop;
  raise notice 'Políticas actualizadas: %', n;
end $$;
