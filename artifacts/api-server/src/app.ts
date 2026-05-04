import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import router from "./routes";
import { logger } from "./lib/logger";
import { getSession, SESSION_COOKIE_NAME } from "./lib/sessions";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: true, limit: "8mb" }));

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=()");
  next();
});

app.use("/api", router);

const staticDir = path.resolve(__dirname, "../../afmod/dist/public");

// Protected HTML files — require valid session cookie
const PROTECTED_HTML = new Set([
  "manufacture.html","bank.html","barber.html","business.html","cafes.html",
  "cars.html","gas.html","grocery.html","house-manage.html","house-map.html",
  "houses.html","messages.html","ministry.html","my-properties.html",
  "restaurants.html","social.html","stores.html","twitter.html","marketplace.html",
  "app.js","shared.js","cars.js","gas-stations.js","houses.js","styles.css","admin.html",
]);

app.use((req: Request, res: Response, next: NextFunction) => {
  const filename = path.basename(req.path);
  if (!PROTECTED_HTML.has(filename)) return next();
  const cookie = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
  const user = getSession(cookie);
  if (!user) return res.redirect("/");
  next();
});

app.use(express.static(staticDir, {
  setHeaders(res, path: string) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    
    if (path.endsWith('.html') || path.endsWith('.js') || path.endsWith('.css')) {
      res.setHeader("Content-Disposition", "inline; filename*=UTF-8''protected.bin");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-XSS-Protection", "1; mode=block");
    }
  },
}));

app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(staticDir, "index.html"));
});

export default app;
