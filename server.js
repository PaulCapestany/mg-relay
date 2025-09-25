import express from "express";
import cors from "cors";
import neo4j from "neo4j-driver";

const {
  MG_URI,
  MG_SCHEME = "bolt+ssc",
  MG_HOST,
  MG_PORT = "7687",
  MG_USER,
  MG_PASS,
  MG_DATABASE,
  MG_TRUST,
  ALLOW_ORIGINS,
  REQUEST_LIMIT = "256kb"
} = process.env;

const resolvedUri = (() => {
  if (MG_URI) return MG_URI;
  if (MG_HOST) return `${MG_SCHEME}://${MG_HOST}${MG_PORT ? `:${MG_PORT}` : ""}`;
  return "";
})();

if (!resolvedUri || resolvedUri.includes("YOUR_HOST")) {
  throw new Error("Set MG_URI or MG_HOST/MG_PORT environment variables before starting the relay.");
}
if (!MG_USER) {
  throw new Error("MG_USER environment variable must be provided.");
}
if (!MG_PASS || MG_PASS === "change-me") {
  throw new Error("MG_PASS environment variable must be provided.");
}

const driverConfig = { disableLosslessIntegers: true };
const hasSecureScheme = /\+s/.test(resolvedUri);
if (hasSecureScheme) {
  driverConfig.encrypted = "ENCRYPTION_ON";
}
if (MG_TRUST) {
  driverConfig.trust = MG_TRUST;
} else if (/\+ssc/.test(resolvedUri)) {
  driverConfig.trust = "TRUST_ALL_CERTIFICATES";
}

const driver = neo4j.driver(resolvedUri, neo4j.auth.basic(MG_USER, MG_PASS), driverConfig);

const app = express();

const allowedOrigins = (ALLOW_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  allowedOrigins.length
    ? cors({ origin: allowedOrigins, credentials: true })
    : cors()
);
app.use(express.json({ limit: REQUEST_LIMIT }));

const sessionConfig = MG_DATABASE ? { database: MG_DATABASE } : undefined;

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/", (_req, res) => {
  res.json({
    service: "mg-relay",
    status: "ok",
    message: "POST a Cypher query to /query",
    target: resolvedUri.replace(/^[^/]+:\/\//, "")
  });
});

app.post("/query", async (req, res) => {
  const { cypher, params = {} } = req.body || {};

  if (!cypher || typeof cypher !== "string") {
    return res.status(400).json({ error: "Body must include a 'cypher' string." });
  }
  if (typeof params !== "object" || Array.isArray(params)) {
    return res.status(400).json({ error: "'params' must be an object." });
  }

  const session = driver.session(sessionConfig);

  try {
    const result = await session.run(cypher, params);

    const nodes = new Map();
    const edges = [];

    const rememberNode = (n) => {
      const id = n.identity.toString();
      if (!nodes.has(id)) {
        nodes.set(id, {
          id,
          label: Array.from(n.labels || []).join(","),
          data: n.properties || {}
        });
      }
      return nodes.get(id);
    };

    for (const record of result.records) {
      for (const value of record.values()) {
        if (value && typeof value === "object" && value.start && value.end) {
          edges.push({
            id: value.identity.toString(),
            source: value.start.toString(),
            target: value.end.toString(),
            label: value.type,
            data: value.properties || {}
          });
        } else if (value && value.labels) {
          rememberNode(value);
        }
      }
    }

    res.json({
      nodes: Array.from(nodes.values()),
      edges
    });
  } catch (error) {
    console.error("Memgraph query failed", error);
    res.status(500).json({ error: "Memgraph query failed." });
  } finally {
    await session.close().catch(() => {});
  }
});

const port = Number.parseInt(process.env.PORT ?? "", 10) || 8080;

const start = async () => {
  try {
    await driver.verifyConnectivity();
    app.listen(port, () => {
      console.log(`mg-relay listening on :${port}`);
    });
  } catch (error) {
    console.error("Unable to connect to Memgraph", error);
    process.exit(1);
  }
};

start();

const shutDown = async (signal) => {
  console.info(`Received ${signal}, closing resources...`);
  try {
    await driver.close();
  } catch (error) {
    console.error("Failed to close Memgraph driver", error);
  } finally {
    process.exit(0);
  }
};

process.on("SIGTERM", () => shutDown("SIGTERM"));
process.on("SIGINT", () => shutDown("SIGINT"));
