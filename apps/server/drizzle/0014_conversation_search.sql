CREATE VIRTUAL TABLE `conversation_search`
USING fts5(
	`tenant_id` UNINDEXED,
	`session_id` UNINDEXED,
	`thread_id` UNINDEXED,
	`source_type` UNINDEXED,
	`source_id` UNINDEXED,
	`title`,
	`content`,
	tokenize='unicode61 remove_diacritics 2'
);--> statement-breakpoint
INSERT INTO `conversation_search` (`tenant_id`, `session_id`, `thread_id`, `source_type`, `source_id`, `title`, `content`)
SELECT
	`tenant_id`,
	`session_id`,
	`id`,
	'thread',
	`id`,
	coalesce(`title`, ''),
	''
FROM `session_threads`;--> statement-breakpoint
INSERT INTO `conversation_search` (`tenant_id`, `session_id`, `thread_id`, `source_type`, `source_id`, `title`, `content`)
SELECT
	`tenant_id`,
	`session_id`,
	`thread_id`,
	'message',
	`id`,
	'',
	coalesce((
		SELECT trim(group_concat(json_extract(`part`.`value`, '$.text'), ' '))
		FROM json_each(`session_messages`.`content`) AS `part`
		WHERE json_extract(`part`.`value`, '$.type') = 'text'
			AND json_type(`part`.`value`, '$.text') = 'text'
	), '')
FROM `session_messages`;--> statement-breakpoint
CREATE TRIGGER `session_threads_search_insert`
AFTER INSERT ON `session_threads`
FOR EACH ROW
BEGIN
	INSERT INTO `conversation_search` (`tenant_id`, `session_id`, `thread_id`, `source_type`, `source_id`, `title`, `content`)
	VALUES (NEW.`tenant_id`, NEW.`session_id`, NEW.`id`, 'thread', NEW.`id`, coalesce(NEW.`title`, ''), '');
END;--> statement-breakpoint
CREATE TRIGGER `session_threads_search_update`
AFTER UPDATE OF `id`, `title`, `session_id`, `tenant_id` ON `session_threads`
FOR EACH ROW
BEGIN
	DELETE FROM `conversation_search`
	WHERE `source_type` = 'thread'
		AND `source_id` = OLD.`id`;
	INSERT INTO `conversation_search` (`tenant_id`, `session_id`, `thread_id`, `source_type`, `source_id`, `title`, `content`)
	VALUES (NEW.`tenant_id`, NEW.`session_id`, NEW.`id`, 'thread', NEW.`id`, coalesce(NEW.`title`, ''), '');
END;--> statement-breakpoint
CREATE TRIGGER `session_threads_search_delete`
AFTER DELETE ON `session_threads`
FOR EACH ROW
BEGIN
	DELETE FROM `conversation_search`
	WHERE `source_type` = 'thread'
		AND `source_id` = OLD.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `session_messages_search_insert`
AFTER INSERT ON `session_messages`
FOR EACH ROW
BEGIN
	INSERT INTO `conversation_search` (`tenant_id`, `session_id`, `thread_id`, `source_type`, `source_id`, `title`, `content`)
	VALUES (
		NEW.`tenant_id`,
		NEW.`session_id`,
		NEW.`thread_id`,
		'message',
		NEW.`id`,
		'',
		coalesce((
			SELECT trim(group_concat(json_extract(`part`.`value`, '$.text'), ' '))
			FROM json_each(NEW.`content`) AS `part`
			WHERE json_extract(`part`.`value`, '$.type') = 'text'
				AND json_type(`part`.`value`, '$.text') = 'text'
		), '')
	);
END;--> statement-breakpoint
CREATE TRIGGER `session_messages_search_update`
AFTER UPDATE OF `id`, `content`, `thread_id`, `session_id`, `tenant_id` ON `session_messages`
FOR EACH ROW
BEGIN
	DELETE FROM `conversation_search`
	WHERE `source_type` = 'message'
		AND `source_id` = OLD.`id`;
	INSERT INTO `conversation_search` (`tenant_id`, `session_id`, `thread_id`, `source_type`, `source_id`, `title`, `content`)
	VALUES (
		NEW.`tenant_id`,
		NEW.`session_id`,
		NEW.`thread_id`,
		'message',
		NEW.`id`,
		'',
		coalesce((
			SELECT trim(group_concat(json_extract(`part`.`value`, '$.text'), ' '))
			FROM json_each(NEW.`content`) AS `part`
			WHERE json_extract(`part`.`value`, '$.type') = 'text'
				AND json_type(`part`.`value`, '$.text') = 'text'
		), '')
	);
END;--> statement-breakpoint
CREATE TRIGGER `session_messages_search_delete`
AFTER DELETE ON `session_messages`
FOR EACH ROW
BEGIN
	DELETE FROM `conversation_search`
	WHERE `source_type` = 'message'
		AND `source_id` = OLD.`id`;
END;
