import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import locationsRouter from "./locations";
import itemsRouter from "./items";
import historyRouter from "./history";
import dashboardRouter from "./dashboard";
import commandRouter from "./command";
import restockRouter from "./restock";
import ordersRouter from "./orders";
import routeSheetsRouter from "./route-sheets";
import importRouter from "./import";
import scanRouter from "./scan";
import warehouseWriteFixesRouter from "./warehouse-write-fixes";
import warehouseRouter from "./warehouse";
import voiceRouter from "./voice";
import agentsRouter from "./agents";
import notificationsRouter from "./notifications";
import { requireAuth, requirePermission } from "../middleware/auth";
import { commandRateLimit, voiceRateLimit, loginRateLimit } from "../middlewares/rateLimit";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth/login", loginRateLimit);
router.use(authRouter);

router.use(requireAuth);

router.use(usersRouter);
router.use(locationsRouter);
router.use(itemsRouter);
router.use(historyRouter);
router.use(dashboardRouter);
router.use("/command", commandRateLimit);
router.use(commandRouter);
router.use(restockRouter);
router.use(requirePermission("edit_store_inventory"), ordersRouter);
router.use(requirePermission("edit_store_inventory"), routeSheetsRouter);
router.use(requirePermission("edit_store_inventory"), importRouter);
router.use(requirePermission("scan_barcodes"), scanRouter);
router.use(warehouseWriteFixesRouter);
router.use(warehouseRouter);
router.use(requirePermission("use_voice_mode"), voiceRateLimit, voiceRouter);
router.use(agentsRouter);
router.use(notificationsRouter);

export default router;

