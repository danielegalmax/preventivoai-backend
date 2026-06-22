-- Eseguire manualmente su Supabase SQL Editor prima di usare reminder_rate_giorni nel cron.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS reminder_rate_giorni integer;

COMMENT ON COLUMN profiles.reminder_rate_giorni IS
  'Giorni di anticipo per notifiche rata/canone in scadenza. NULL = usa CRON_GIORNI_SCADENZA_RATE (default 3).';
