-- ============================================================================
-- Update pg_cron jobs to send X-Cron-Secret header to protected edge functions.
-- Requires manual step: SET secret CRON_SECRET first via:
--   ALTER DATABASE postgres SET app.cron_secret TO '<random-32-char-secret>';
-- (or, more secure, store in vault and read via decrypted_secret)
-- ============================================================================

-- jobid 7: generar_facturas_riders_semanal
SELECT cron.unschedule(7);
SELECT cron.schedule(
  'generar-facturas-riders-semanal',
  '0 2 * * 1',
  $$ SELECT net.http_post(
       url := 'https://rmrbxrabngdmpgpfmjbo.supabase.co/functions/v1/generar_facturas_riders_semanal',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'X-Cron-Secret', current_setting('app.cron_secret', true)
       ),
       body := '{}'::jsonb
     ) $$
);

-- jobid 9: liquidacion-semanal
SELECT cron.unschedule(9);
SELECT cron.schedule(
  'liquidacion-semanal',
  '0 3 * * 1',
  $$ SELECT net.http_post(
       url := 'https://rmrbxrabngdmpgpfmjbo.supabase.co/functions/v1/liquidacion-semanal',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'X-Cron-Secret', current_setting('app.cron_secret', true)
       ),
       body := '{}'::jsonb
     ) $$
);

-- jobid 10: generar-balances-socio
SELECT cron.unschedule(10);
SELECT cron.schedule(
  'generar-balances-socio',
  '30 2 * * 1',
  $$ SELECT net.http_post(
       url := 'https://rmrbxrabngdmpgpfmjbo.supabase.co/functions/v1/generar-balances-socio',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'X-Cron-Secret', current_setting('app.cron_secret', true)
       ),
       body := '{}'::jsonb
     ) $$
);
