import { Pool, type PoolClient } from "pg";

process.env.DATABASE_URL ??= "postgresql://la-forge.fox@localhost:5432/keep_tally_brian_code";

const databaseUrl = process.env.DATABASE_URL;
const dryRun = process.env.ARCHIVE_DRY_RUN !== "false";
const batchSize = positiveInt(process.env.ARCHIVE_BATCH_SIZE, 5000);
const historyRetentionDays = positiveInt(process.env.ARCHIVE_HISTORY_DAYS, 90);
const countSessionRetentionDays = positiveInt(process.env.ARCHIVE_COUNT_SESSION_DAYS, 90);
const stockoutResolvedRetentionDays = positiveInt(process.env.ARCHIVE_STOCKOUT_RESOLVED_DAYS, 180);

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function countRows(client: PoolClient, sql: string, params: unknown[]) {
  const result = await client.query<{ count: string }>(sql, params);
  return Number(result.rows[0]?.count ?? 0);
}

async function moveHistory(client: PoolClient) {
  const params = [historyRetentionDays, batchSize];
  const eligible = await countRows(
    client,
    `
      select count(*)::int as count
      from history
      where created_at < now() - ($1::int * interval '1 day')
    `,
    [historyRetentionDays],
  );

  if (dryRun) return { eligible, moved: 0 };

  const moved = await client.query<{ id: number }>(
    `
      with moved as (
        delete from history
        where id in (
          select id
          from history
          where created_at < now() - ($1::int * interval '1 day')
          order by id
          limit $2::int
        )
        returning *
      )
      insert into history_archive (
        id,
        account_id,
        location_id,
        item_id,
        item_name,
        action,
        field,
        previous_value,
        new_value,
        note,
        source,
        performed_by,
        performed_by_role,
        location,
        created_at
      )
      select
        id,
        account_id,
        location_id,
        item_id,
        item_name,
        action,
        field,
        previous_value,
        new_value,
        note,
        source,
        performed_by,
        performed_by_role,
        location,
        created_at
      from moved
      on conflict (id) do nothing
      returning id
    `,
    params,
  );

  return { eligible, moved: moved.rowCount ?? 0 };
}

async function moveCountSessions(client: PoolClient) {
  const params = [countSessionRetentionDays, batchSize];
  const eligible = await countRows(
    client,
    `
      select count(*)::int as count
      from count_sessions
      where status <> 'active'
        and coalesce(completed_at, updated_at, started_at) < now() - ($1::int * interval '1 day')
    `,
    [countSessionRetentionDays],
  );

  if (dryRun) return { eligible, movedSessions: 0, movedEvents: 0 };

  const eventResult = await client.query<{ id: number }>(
    `
      with target_sessions as (
        select id
        from count_sessions
        where status <> 'active'
          and coalesce(completed_at, updated_at, started_at) < now() - ($1::int * interval '1 day')
        order by id
        limit $2::int
      ),
      moved as (
        delete from count_session_events
        where session_id in (select id from target_sessions)
        returning *
      )
      insert into count_session_events_archive (
        id,
        account_id,
        session_id,
        user_id,
        location_id,
        item_id,
        item_name,
        event_type,
        action,
        status,
        expected_quantity,
        counted_quantity,
        reason,
        transcript,
        confidence,
        message,
        metadata,
        created_at
      )
      select
        id,
        account_id,
        session_id,
        user_id,
        location_id,
        item_id,
        item_name,
        event_type,
        action,
        status,
        expected_quantity,
        counted_quantity,
        reason,
        transcript,
        confidence,
        message,
        metadata,
        created_at
      from moved
      on conflict (id) do nothing
      returning id
    `,
    params,
  );

  const sessionResult = await client.query<{ id: number }>(
    `
      with moved as (
        delete from count_sessions
        where id in (
          select id
          from count_sessions
          where status <> 'active'
            and coalesce(completed_at, updated_at, started_at) < now() - ($1::int * interval '1 day')
          order by id
          limit $2::int
        )
        returning *
      )
      insert into count_sessions_archive (
        id,
        account_id,
        user_id,
        location_id,
        location_name,
        mode,
        source,
        status,
        item_count,
        verified_count,
        updated_count,
        skipped_count,
        no_response_count,
        metadata,
        started_at,
        completed_at,
        created_at,
        updated_at
      )
      select
        id,
        account_id,
        user_id,
        location_id,
        location_name,
        mode,
        source,
        status,
        item_count,
        verified_count,
        updated_count,
        skipped_count,
        no_response_count,
        metadata,
        started_at,
        completed_at,
        created_at,
        updated_at
      from moved
      on conflict (id) do nothing
      returning id
    `,
    params,
  );

  return {
    eligible,
    movedSessions: sessionResult.rowCount ?? 0,
    movedEvents: eventResult.rowCount ?? 0,
  };
}

async function moveResolvedStockouts(client: PoolClient) {
  const params = [stockoutResolvedRetentionDays, batchSize];
  const eligible = await countRows(
    client,
    `
      select count(*)::int as count
      from stockout_events
      where status = 'resolved'
        and resolved_at is not null
        and resolved_at < now() - ($1::int * interval '1 day')
    `,
    [stockoutResolvedRetentionDays],
  );

  if (dryRun) return { eligible, moved: 0 };

  const moved = await client.query<{ id: number }>(
    `
      with moved as (
        delete from stockout_events
        where id in (
          select id
          from stockout_events
          where status = 'resolved'
            and resolved_at is not null
            and resolved_at < now() - ($1::int * interval '1 day')
          order by id
          limit $2::int
        )
        returning *
      )
      insert into stockout_events_archive (
        id,
        account_id,
        item_id,
        location_id,
        item_name,
        location_name,
        category,
        status,
        quantity_at_open,
        min_quantity,
        max_quantity,
        opened_at,
        resolved_at,
        resolution_quantity,
        source,
        evidence,
        metadata,
        created_at,
        updated_at
      )
      select
        id,
        account_id,
        item_id,
        location_id,
        item_name,
        location_name,
        category,
        status,
        quantity_at_open,
        min_quantity,
        max_quantity,
        opened_at,
        resolved_at,
        resolution_quantity,
        source,
        evidence,
        metadata,
        created_at,
        updated_at
      from moved
      on conflict (id) do nothing
      returning id
    `,
    params,
  );

  return { eligible, moved: moved.rowCount ?? 0 };
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();

try {
  await client.query("begin");
  const history = await moveHistory(client);
  const countSessions = await moveCountSessions(client);
  const stockouts = await moveResolvedStockouts(client);

  if (dryRun) {
    await client.query("rollback");
  } else {
    await client.query("commit");
  }

  console.log(JSON.stringify({
    ok: true,
    dryRun,
    batchSize,
    retentionDays: {
      history: historyRetentionDays,
      countSessions: countSessionRetentionDays,
      resolvedStockouts: stockoutResolvedRetentionDays,
    },
    history,
    countSessions,
    stockouts,
  }, null, 2));
} catch (err) {
  await client.query("rollback").catch(() => undefined);
  throw err;
} finally {
  client.release();
  await pool.end();
}
