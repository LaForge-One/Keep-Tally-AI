import { Router, type IRouter, type Request } from "express";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { db, historyTable } from "@workspace/db";
import { ListHistoryQueryParams } from "@workspace/api-zod";
import { canViewAllLocations, requireAccount, requireActiveMembership } from "../middleware/auth";

const router: IRouter = Router();

router.use(requireAccount, requireActiveMembership);

function allowedLocationIds(req: Request): number[] {
  return req.allowedLocationIds ?? [];
}

router.get("/history", async (req, res) => {
  const parsed = ListHistoryQueryParams.safeParse({
    itemId: req.query.itemId !== undefined ? Number(req.query.itemId) : undefined,
    limit: req.query.limit !== undefined ? Number(req.query.limit) : undefined,
  });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const limit = parsed.data.limit ?? 100;

  const permittedLocationIds = allowedLocationIds(req);
  const assignedLocations = req.authUser?.assignedLocations ?? [];
  const itemFilter = parsed.data.itemId !== undefined ? eq(historyTable.itemId, parsed.data.itemId) : undefined;

  if (!canViewAllLocations(req) && permittedLocationIds.length === 0 && assignedLocations.length === 0) {
    res.json([]);
    return;
  }

  const locationFilter = canViewAllLocations(req)
    ? undefined
    : or(
        inArray(historyTable.locationId, permittedLocationIds),
        inArray(historyTable.location, assignedLocations),
      );

  const filters = [
    eq(historyTable.accountId, req.account!.id),
    itemFilter,
    locationFilter,
  ].filter((filter) => filter !== undefined);

  const rows = await db
    .select()
    .from(historyTable)
    .where(and(...filters))
    .orderBy(desc(historyTable.createdAt))
    .limit(limit);

  res.json(
    rows.map((row) => ({
      id: row.id,
      itemId: row.itemId,
      itemName: row.itemName,
      action: row.action,
      field: row.field,
      previousValue: row.previousValue,
      newValue: row.newValue,
      note: row.note,
      source: row.source,
      performedBy: row.performedBy,
      performedByRole: row.performedByRole,
      location: row.location,
      createdAt: row.createdAt.toISOString(),
    })),
  );
});

export default router;
