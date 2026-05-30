import { pool } from "@workspace/db";

type Check = {
  label: string;
  sql: string;
  severity: "blocker" | "warning";
};

const ROLE_PERMISSION_MATRIX = `
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
`;

const checks: Check[] = [
  {
    label: "users without account_id",
    severity: "blocker",
    sql: `SELECT count(*)::int AS count FROM users WHERE account_id IS NULL`,
  },
  {
    label: "active users without active account membership",
    severity: "blocker",
    sql: `
      SELECT count(*)::int AS count
      FROM users u
      WHERE u.active = true
        AND NOT EXISTS (
          SELECT 1
          FROM account_memberships am
          WHERE am.user_id = u.id
            AND am.account_id = u.account_id
            AND am.active = true
        )
    `,
  },
  {
    label: "assigned legacy user locations without assignment rows",
    severity: "blocker",
    sql: `
      SELECT count(*)::int AS count
      FROM users u
      CROSS JOIN LATERAL unnest(u.assigned_locations) AS assigned_location(name)
      WHERE u.account_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM user_location_assignments ula
          JOIN locations l ON l.id = ula.location_id
          WHERE ula.account_id = u.account_id
            AND ula.user_id = u.id
            AND l.name = assigned_location.name
        )
    `,
  },
  {
    label: "items without account_id",
    severity: "blocker",
    sql: `SELECT count(*)::int AS count FROM items WHERE account_id IS NULL`,
  },
  {
    label: "items without location_id",
    severity: "blocker",
    sql: `SELECT count(*)::int AS count FROM items WHERE location_id IS NULL`,
  },
  {
    label: "items whose location_id belongs to another account",
    severity: "blocker",
    sql: `
      SELECT count(*)::int AS count
      FROM items i
      JOIN locations l ON l.id = i.location_id
      WHERE i.account_id IS DISTINCT FROM l.account_id
    `,
  },
  {
    label: "orders without account_id",
    severity: "blocker",
    sql: `SELECT count(*)::int AS count FROM orders WHERE account_id IS NULL`,
  },
  {
    label: "orders without location_id",
    severity: "blocker",
    sql: `SELECT count(*)::int AS count FROM orders WHERE location_id IS NULL`,
  },
  {
    label: "orders whose location_id belongs to another account",
    severity: "blocker",
    sql: `
      SELECT count(*)::int AS count
      FROM orders o
      JOIN locations l ON l.id = o.location_id
      WHERE o.account_id IS DISTINCT FROM l.account_id
    `,
  },
  {
    label: "order_items without account_id",
    severity: "blocker",
    sql: `SELECT count(*)::int AS count FROM order_items WHERE account_id IS NULL`,
  },
  {
    label: "order_items whose account_id differs from order account_id",
    severity: "blocker",
    sql: `
      SELECT count(*)::int AS count
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE oi.account_id IS DISTINCT FROM o.account_id
    `,
  },
  {
    label: "history rows without account_id",
    severity: "blocker",
    sql: `SELECT count(*)::int AS count FROM history WHERE account_id IS NULL`,
  },
  {
    label: "history rows with legacy location but no location_id",
    severity: "warning",
    sql: `SELECT count(*)::int AS count FROM history WHERE location IS NOT NULL AND location_id IS NULL`,
  },
  {
    label: "scan_log rows without account_id",
    severity: "blocker",
    sql: `SELECT count(*)::int AS count FROM scan_log WHERE account_id IS NULL`,
  },
  {
    label: "scan_log rows with legacy location but no location_id",
    severity: "warning",
    sql: `SELECT count(*)::int AS count FROM scan_log WHERE location IS NOT NULL AND location_id IS NULL`,
  },
  {
    label: "warehouse_items without account_id",
    severity: "blocker",
    sql: `SELECT count(*)::int AS count FROM warehouse_items WHERE account_id IS NULL`,
  },
  {
    label: "warehouse_items without warehouse_id",
    severity: "warning",
    sql: `SELECT count(*)::int AS count FROM warehouse_items WHERE warehouse_id IS NULL`,
  },
  {
    label: "warehouse_purchases without account_id",
    severity: "blocker",
    sql: `SELECT count(*)::int AS count FROM warehouse_purchases WHERE account_id IS NULL`,
  },
  {
    label: "warehouse_purchases without warehouse_id",
    severity: "warning",
    sql: `SELECT count(*)::int AS count FROM warehouse_purchases WHERE warehouse_id IS NULL`,
  },
  {
    label: "warehouse_transfers without account_id",
    severity: "blocker",
    sql: `SELECT count(*)::int AS count FROM warehouse_transfers WHERE account_id IS NULL`,
  },
  {
    label: "warehouse_transfers without store_location_id",
    severity: "warning",
    sql: `SELECT count(*)::int AS count FROM warehouse_transfers WHERE store_location_id IS NULL`,
  },
  {
    label: "account-scoped role_permissions missing account_id",
    severity: "warning",
    sql: `SELECT count(*)::int AS count FROM role_permissions WHERE account_id IS NULL`,
  },
  {
    label: "account-scoped role permission matrix gaps",
    severity: "blocker",
    sql: `
      WITH permission_matrix("role", "permission_key") AS (
        VALUES
${ROLE_PERMISSION_MATRIX}
      )
      SELECT count(*)::int AS count
      FROM accounts a
      CROSS JOIN permission_matrix m
      WHERE NOT EXISTS (
        SELECT 1
        FROM role_permissions rp
        WHERE rp.account_id = a.id
          AND rp.role = m."role"
          AND rp.permission_key = m."permission_key"
      )
    `,
  },
  {
    label: "duplicate account-scoped role permission rows",
    severity: "blocker",
    sql: `
      SELECT count(*)::int AS count
      FROM (
        SELECT account_id, role, permission_key
        FROM role_permissions
        WHERE account_id IS NOT NULL
        GROUP BY account_id, role, permission_key
        HAVING count(*) > 1
      ) duplicates
    `,
  },
  {
    label: "active memberships with unsupported role",
    severity: "blocker",
    sql: `
      SELECT count(*)::int AS count
      FROM account_memberships
      WHERE active = true
        AND role NOT IN ('admin', 'warehouse', 'stocker')
    `,
  },
];

async function main() {
  let blockerCount = 0;
  let warningCount = 0;

  console.log("KeepTally tenant/location link report");
  console.log("Read-only checks for future NOT NULL cleanup.\n");

  for (const check of checks) {
    const result = await pool.query<{ count: number }>(check.sql);
    const count = result.rows[0]?.count ?? 0;
    const status = count === 0 ? "ok" : check.severity;

    if (count > 0 && check.severity === "blocker") blockerCount += 1;
    if (count > 0 && check.severity === "warning") warningCount += 1;

    console.log(`${status.padEnd(7)} ${String(count).padStart(5)} ${check.label}`);
  }

  await pool.end();

  if (blockerCount > 0) {
    console.error(`\n${blockerCount} blocker check(s) failed. Do not enforce NOT NULL yet.`);
    process.exit(1);
  }

  if (warningCount > 0) {
    console.warn(`\n${warningCount} warning check(s) found legacy nullable links to review before final cleanup.`);
  } else {
    console.log("\nNo blocker or warning rows found.");
  }
}

main().catch(async (err: unknown) => {
  await pool.end();
  console.error(err);
  process.exit(1);
});
