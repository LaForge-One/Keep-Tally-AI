DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "role_permissions" rp
    WHERE rp."account_id" IS NOT NULL
    GROUP BY rp."account_id", rp."role", rp."permission_key"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'role permission matrix failed: duplicate account-scoped role permission rows';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "account_memberships" am
    WHERE am."active" = true
      AND am."role" NOT IN ('admin', 'warehouse', 'stocker')
  ) THEN
    RAISE EXCEPTION 'role permission matrix failed: active membership uses unsupported role';
  END IF;
END $$;
--> statement-breakpoint
WITH permission_defaults("role", "permission_key", "enabled") AS (
  VALUES
    ('admin', 'manage_users', true),
    ('admin', 'delete_items', true),
    ('admin', 'edit_settings', true),
    ('admin', 'view_costs', true),
    ('admin', 'view_all_reports', true),
    ('admin', 'edit_warehouse', true),
    ('admin', 'receive_purchases', true),
    ('admin', 'transfer_inventory', true),
    ('admin', 'view_warehouse', true),
    ('admin', 'edit_store_inventory', true),
    ('admin', 'scan_barcodes', true),
    ('admin', 'use_voice_mode', true),
    ('admin', 'mark_adjustments', true),
    ('admin', 'view_all_locations', true),
    ('warehouse', 'manage_users', false),
    ('warehouse', 'delete_items', false),
    ('warehouse', 'edit_settings', false),
    ('warehouse', 'view_costs', false),
    ('warehouse', 'view_all_reports', false),
    ('warehouse', 'edit_warehouse', true),
    ('warehouse', 'receive_purchases', true),
    ('warehouse', 'transfer_inventory', true),
    ('warehouse', 'view_warehouse', true),
    ('warehouse', 'edit_store_inventory', true),
    ('warehouse', 'scan_barcodes', true),
    ('warehouse', 'use_voice_mode', true),
    ('warehouse', 'mark_adjustments', true),
    ('warehouse', 'view_all_locations', true),
    ('stocker', 'manage_users', false),
    ('stocker', 'delete_items', false),
    ('stocker', 'edit_settings', false),
    ('stocker', 'view_costs', false),
    ('stocker', 'view_all_reports', false),
    ('stocker', 'edit_warehouse', false),
    ('stocker', 'receive_purchases', false),
    ('stocker', 'transfer_inventory', false),
    ('stocker', 'view_warehouse', false),
    ('stocker', 'edit_store_inventory', true),
    ('stocker', 'scan_barcodes', true),
    ('stocker', 'use_voice_mode', true),
    ('stocker', 'mark_adjustments', true),
    ('stocker', 'view_all_locations', false)
)
INSERT INTO "role_permissions" ("account_id", "role", "permission_key", "enabled")
SELECT
  a."id",
  d."role",
  d."permission_key",
  COALESCE(global_permission."enabled", d."enabled")
FROM "accounts" a
CROSS JOIN permission_defaults d
LEFT JOIN LATERAL (
  SELECT rp."enabled"
  FROM "role_permissions" rp
  WHERE rp."account_id" IS NULL
    AND rp."role" = d."role"
    AND rp."permission_key" = d."permission_key"
  ORDER BY rp."id" DESC
  LIMIT 1
) global_permission ON true
WHERE NOT EXISTS (
  SELECT 1
  FROM "role_permissions" existing
  WHERE existing."account_id" = a."id"
    AND existing."role" = d."role"
    AND existing."permission_key" = d."permission_key"
);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    WITH permission_defaults("role", "permission_key") AS (
      VALUES
        ('admin', 'manage_users'),
        ('admin', 'delete_items'),
        ('admin', 'edit_settings'),
        ('admin', 'view_costs'),
        ('admin', 'view_all_reports'),
        ('admin', 'edit_warehouse'),
        ('admin', 'receive_purchases'),
        ('admin', 'transfer_inventory'),
        ('admin', 'view_warehouse'),
        ('admin', 'edit_store_inventory'),
        ('admin', 'scan_barcodes'),
        ('admin', 'use_voice_mode'),
        ('admin', 'mark_adjustments'),
        ('admin', 'view_all_locations'),
        ('warehouse', 'manage_users'),
        ('warehouse', 'delete_items'),
        ('warehouse', 'edit_settings'),
        ('warehouse', 'view_costs'),
        ('warehouse', 'view_all_reports'),
        ('warehouse', 'edit_warehouse'),
        ('warehouse', 'receive_purchases'),
        ('warehouse', 'transfer_inventory'),
        ('warehouse', 'view_warehouse'),
        ('warehouse', 'edit_store_inventory'),
        ('warehouse', 'scan_barcodes'),
        ('warehouse', 'use_voice_mode'),
        ('warehouse', 'mark_adjustments'),
        ('warehouse', 'view_all_locations'),
        ('stocker', 'manage_users'),
        ('stocker', 'delete_items'),
        ('stocker', 'edit_settings'),
        ('stocker', 'view_costs'),
        ('stocker', 'view_all_reports'),
        ('stocker', 'edit_warehouse'),
        ('stocker', 'receive_purchases'),
        ('stocker', 'transfer_inventory'),
        ('stocker', 'view_warehouse'),
        ('stocker', 'edit_store_inventory'),
        ('stocker', 'scan_barcodes'),
        ('stocker', 'use_voice_mode'),
        ('stocker', 'mark_adjustments'),
        ('stocker', 'view_all_locations')
    )
    SELECT 1
    FROM "accounts" a
    CROSS JOIN permission_defaults d
    WHERE NOT EXISTS (
      SELECT 1
      FROM "role_permissions" rp
      WHERE rp."account_id" = a."id"
        AND rp."role" = d."role"
        AND rp."permission_key" = d."permission_key"
    )
  ) THEN
    RAISE EXCEPTION 'role permission matrix failed: account-scoped role permission rows are incomplete';
  END IF;

  IF EXISTS (
    WITH permission_defaults("role", "permission_key") AS (
      VALUES
        ('admin', 'manage_users'),
        ('admin', 'delete_items'),
        ('admin', 'edit_settings'),
        ('admin', 'view_costs'),
        ('admin', 'view_all_reports'),
        ('admin', 'edit_warehouse'),
        ('admin', 'receive_purchases'),
        ('admin', 'transfer_inventory'),
        ('admin', 'view_warehouse'),
        ('admin', 'edit_store_inventory'),
        ('admin', 'scan_barcodes'),
        ('admin', 'use_voice_mode'),
        ('admin', 'mark_adjustments'),
        ('admin', 'view_all_locations'),
        ('warehouse', 'manage_users'),
        ('warehouse', 'delete_items'),
        ('warehouse', 'edit_settings'),
        ('warehouse', 'view_costs'),
        ('warehouse', 'view_all_reports'),
        ('warehouse', 'edit_warehouse'),
        ('warehouse', 'receive_purchases'),
        ('warehouse', 'transfer_inventory'),
        ('warehouse', 'view_warehouse'),
        ('warehouse', 'edit_store_inventory'),
        ('warehouse', 'scan_barcodes'),
        ('warehouse', 'use_voice_mode'),
        ('warehouse', 'mark_adjustments'),
        ('warehouse', 'view_all_locations'),
        ('stocker', 'manage_users'),
        ('stocker', 'delete_items'),
        ('stocker', 'edit_settings'),
        ('stocker', 'view_costs'),
        ('stocker', 'view_all_reports'),
        ('stocker', 'edit_warehouse'),
        ('stocker', 'receive_purchases'),
        ('stocker', 'transfer_inventory'),
        ('stocker', 'view_warehouse'),
        ('stocker', 'edit_store_inventory'),
        ('stocker', 'scan_barcodes'),
        ('stocker', 'use_voice_mode'),
        ('stocker', 'mark_adjustments'),
        ('stocker', 'view_all_locations')
    )
    SELECT 1
    FROM "account_memberships" am
    JOIN permission_defaults d ON d."role" = am."role"
    WHERE am."active" = true
      AND NOT EXISTS (
        SELECT 1
        FROM "role_permissions" rp
        WHERE rp."account_id" = am."account_id"
          AND rp."role" = am."role"
          AND rp."permission_key" = d."permission_key"
      )
  ) THEN
    RAISE EXCEPTION 'role permission matrix failed: active membership role has incomplete account-scoped permissions';
  END IF;
END $$;
