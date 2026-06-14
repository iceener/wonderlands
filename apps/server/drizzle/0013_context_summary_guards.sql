CREATE TRIGGER `context_summaries_previous_scope_insert_guard`
BEFORE INSERT ON `context_summaries`
FOR EACH ROW
WHEN NEW.`previous_summary_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `context_summaries`
    WHERE `id` = NEW.`previous_summary_id`
      AND `run_id` = NEW.`run_id`
      AND `tenant_id` = NEW.`tenant_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'context_summaries.previous_summary_id must reference a summary in the same run and tenant');
END;--> statement-breakpoint
CREATE TRIGGER `context_summaries_previous_scope_update_guard`
BEFORE UPDATE OF `previous_summary_id`, `run_id`, `tenant_id` ON `context_summaries`
FOR EACH ROW
WHEN NEW.`previous_summary_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `context_summaries`
    WHERE `id` = NEW.`previous_summary_id`
      AND `run_id` = NEW.`run_id`
      AND `tenant_id` = NEW.`tenant_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'context_summaries.previous_summary_id must reference a summary in the same run and tenant');
END;--> statement-breakpoint
CREATE TRIGGER `context_summaries_range_overlap_insert_guard`
BEFORE INSERT ON `context_summaries`
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM `context_summaries`
  WHERE `run_id` = NEW.`run_id`
    AND `tenant_id` = NEW.`tenant_id`
    AND NOT (
      `through_sequence` < NEW.`from_sequence`
      OR `from_sequence` > NEW.`through_sequence`
    )
)
BEGIN
  SELECT RAISE(ABORT, 'context_summaries sequence ranges must not overlap within the same run');
END;--> statement-breakpoint
CREATE TRIGGER `context_summaries_range_overlap_update_guard`
BEFORE UPDATE OF `run_id`, `tenant_id`, `from_sequence`, `through_sequence` ON `context_summaries`
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM `context_summaries`
  WHERE `run_id` = NEW.`run_id`
    AND `tenant_id` = NEW.`tenant_id`
    AND `id` <> NEW.`id`
    AND NOT (
      `through_sequence` < NEW.`from_sequence`
      OR `from_sequence` > NEW.`through_sequence`
    )
)
BEGIN
  SELECT RAISE(ABORT, 'context_summaries sequence ranges must not overlap within the same run');
END;
