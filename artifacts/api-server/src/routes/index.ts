import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import showroomRouter from "./showroom";
import messagesRouter from "./messages";
import twitterRouter from "./twitter";
import businessRouter from "./business";
import manufactureRouter from "./manufacture";
import houseRouter from "./house";
import marketplaceRouter from "./marketplace";
import gangsRouter from "./gangs";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(showroomRouter);
router.use(messagesRouter);
router.use(twitterRouter);
router.use(businessRouter);
router.use(manufactureRouter);
router.use(houseRouter);
router.use(marketplaceRouter);
router.use(gangsRouter);
router.use(adminRouter);

export default router;
