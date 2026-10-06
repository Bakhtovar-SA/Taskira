-- Дополнительная причина автоматической паузы; прежние значения и данные сохраняются.
ALTER TABLE recurring_rules DROP CONSTRAINT recurring_rules_paused_reason_check;
ALTER TABLE recurring_rules ADD CONSTRAINT recurring_rules_paused_reason_check
  CHECK (paused_reason IN ('manual', 'owner_lost_access', 'invalid_timing'));
