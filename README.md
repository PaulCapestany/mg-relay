# mg-relay

A tiny Memgraph relay that exposes a single `/query` endpoint for the
[`landing-page`](https://github.com/PaulCapestany/landing-page) project (see the
`feat/mg-orb-viewer` branch). The relay accepts a Cypher statement, runs it
against Memgraph/Neo4j, and returns graph data in a shape that the mg-orb viewer
understands.

## Environment

Supply connection details through environment variables. Either set `MG_URI` to
an entire Bolt URI, or provide host components individually.

| Variable       | Required | Description                                                   |
| -------------- | -------- | ------------------------------------------------------------- |
| `MG_URI`       | optional | Full URI such as `bolt+ssc://my-host:7687`. Overrides host pieces below. |
| `MG_HOST`      | optional | Hostname/IP for Memgraph. Used with `MG_SCHEME`/`MG_PORT`.     |
| `MG_PORT`      | optional | Defaults to `7687`.                                           |
| `MG_SCHEME`    | optional | Defaults to `bolt+ssc`.                                       |
| `MG_USER`      | yes      | Memgraph login (use a read-only role for safety).             |
| `MG_PASS`      | yes      | Password for `MG_USER`.                                       |
| `MG_DATABASE`  | optional | Specific database name, if your Memgraph installation uses multiple. |
| `MG_TRUST`     | optional | Neo4j driver's `trust` option (defaults to `TRUST_ALL_CERTIFICATES` when using `+ssc`). |
| `ALLOW_ORIGINS`| optional | Comma-separated list of allowed origins for CORS. Leave unset to allow any origin (useful for testing). |
| `REQUEST_LIMIT`| optional | Body size limit for JSON payloads (default `256kb`).          |

At minimum you must supply credentials and either `MG_URI` or
`MG_HOST`/`MG_PORT`.

### Local run

```bash
npm install
export MG_URI="bolt+ssc://your-cloud-host:7687"
export MG_USER="readonly"
export MG_PASS="super-secret"
npm start
```

The service listens on `:${PORT}` (defaults to `8080`). A health probe is
available at `/healthz`, while `/` responds with a short JSON banner. The
frontend posts to `/query`.

### Deploying on Render.com

Render can build this repository directly:

- **Environment**: Node
- **Build command**: `npm install`
- **Start command**: `npm start`
- **Environment variables**: supply `MG_URI` (or host pieces), `MG_USER`, `MG_PASS`, and optionally `MG_DATABASE`, `ALLOW_ORIGINS`, etc.

A convenience `render.yaml` blueprint is included. You can import it and fill in
secrets within the Render dashboard:

```yaml
services:
  - type: web
    name: mg-relay
    env: node
    plan: free
    buildCommand: npm install
    startCommand: npm start
    envVars:
      - key: MG_URI
        sync: false
      - key: MG_USER
        sync: false
      - key: MG_PASS
        sync: false
      - key: MG_DATABASE
        sync: false
      - key: ALLOW_ORIGINS
        sync: false
```

Once deployed, point the mg-orb viewer at `https://<your-render-subdomain>/query`
when the browser prompts for a relay URL.

## API

`POST /query`

Request body:

```json
{
  "cypher": "MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 100",
  "params": { "limit": 100 }
}
```

Response structure:

```json
{
  "nodes": [{ "id": "0", "label": "Artist", "data": { "name": "..." } }],
  "edges": [{ "id": "1", "source": "0", "target": "2", "label": "KNOWS" }]
}
```

Errors are returned as JSON in the form `{ "error": "..." }` with the
appropriate HTTP status code.
