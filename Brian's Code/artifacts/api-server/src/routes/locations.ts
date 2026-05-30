import { Router, type IRouter } from "express";
import { asc, and, eq, inArray } from "drizzle-orm";
import { db, locationsTable } from "@workspace/db";
import { canViewAllLocations, requireAccount, requireActiveMembership } from "../middleware/auth";

const router: IRouter = Router();

router.use(requireAccount, requireActiveMembership);

router.get("/locations", async (req, res) => {
  const baseWhere = and(
    eq(locationsTable.accountId, req.account!.id),
    eq(locationsTable.status, "active"),
  );

  if (canViewAllLocations(req)) {
    const rows = await db
      .select({
        id: locationsTable.id,
        name: locationsTable.name,
        slug: locationsTable.slug,
      })
      .from(locationsTable)
      .where(baseWhere)
      .orderBy(asc(locationsTable.name));

    res.json(rows);
    return;
  }

  const allowedLocationIds = req.allowedLocationIds ?? [];
  if (allowedLocationIds.length > 0) {
    const rows = await db
      .select({
        id: locationsTable.id,
        name: locationsTable.name,
        slug: locationsTable.slug,
      })
      .from(locationsTable)
      .where(and(baseWhere, inArray(locationsTable.id, allowedLocationIds)))
      .orderBy(asc(locationsTable.name));

    res.json(rows);
    return;
  }

  const legacyLocations = req.authUser?.assignedLocations ?? [];
  if (legacyLocations.length > 0) {
    const rows = await db
      .select({
        id: locationsTable.id,
        name: locationsTable.name,
        slug: locationsTable.slug,
      })
      .from(locationsTable)
      .where(and(baseWhere, inArray(locationsTable.name, legacyLocations)))
      .orderBy(asc(locationsTable.name));

    res.json(rows);
    return;
  }

  res.json([]);
});

export default router;
