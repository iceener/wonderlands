UPDATE garden_sites
SET source_account_id = created_by_account_id
WHERE source_account_id <> created_by_account_id;
