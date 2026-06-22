import express from 'express';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import {
  getCellNamesForOwner,
  getHeartbeatBalance,
  getNameAvailability,
  network,
  rootName,
  usdcCoinType,
} from './src/sample-sui.js';
import {
  memwalConfig,
  recallCellGrowth,
  rememberCellGrowth,
} from './src/sample-memwal.js';

const appRoot = resolve(import.meta.dirname);
const publicRoot = resolve(appRoot, 'public');
const distRoot = resolve(appRoot, 'dist');
const port = Number(process.env.PORT ?? 3000);

const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    network,
    rootName,
    usdcCoinType,
    memwal: memwalConfig(),
  });
});

app.get('/api/name/:name', async (req, res, next) => {
  try {
    res.json(await getNameAvailability(req.params.name));
  } catch (error) {
    next(error);
  }
});

app.get('/api/owner/:address/cell-names', async (req, res, next) => {
  try {
    res.json(await getCellNamesForOwner(req.params.address));
  } catch (error) {
    next(error);
  }
});

app.get('/api/address/:address/heartbeats', async (req, res, next) => {
  try {
    res.json(await getHeartbeatBalance(req.params.address));
  } catch (error) {
    next(error);
  }
});

app.get('/api/memwal/status', (req, res) => {
  res.json(memwalConfig(req.query.fqdn));
});

app.get('/api/cell/:fqdn/memwal', async (req, res, next) => {
  try {
    res.json({
      fqdn: req.params.fqdn,
      memwal: memwalConfig(req.params.fqdn),
      recall: await recallCellGrowth(req.params.fqdn),
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/cell/:fqdn/memwal', async (req, res, next) => {
  try {
    const jsonl = String(req.body.jsonl ?? '').trim();
    if (!jsonl) {
      const error = new Error('Missing growth jsonl.');
      error.statusCode = 400;
      throw error;
    }

    res.json({
      fqdn: req.params.fqdn,
      memwal: await rememberCellGrowth({
        fqdn: req.params.fqdn,
        generation: Number(req.body.generation ?? 0),
        jsonl,
      }),
    });
  } catch (error) {
    next(error);
  }
});

app.use('/assets', express.static(distRoot));
app.use(express.static(publicRoot));

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function filePathForUrl(url) {
  const pathname = new URL(url, `http://localhost:${port}`).pathname;
  if (pathname.startsWith('/assets/')) {
    return join(distRoot, normalize(pathname.replace('/assets/', '')));
  }
  if (pathname === '/') return join(publicRoot, 'index.html');
  return join(publicRoot, normalize(pathname));
}

app.get(['/', '/new', '/success', '/fail', '/:name'], async (req, res, next) => {
  try {
    let filePath = filePathForUrl(req.url ?? '/');
    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat) filePath = join(publicRoot, 'index.html');
    else if (fileStat.isDirectory()) filePath = join(filePath, 'index.html');

    res.setHeader('Content-Type', contentTypes[extname(filePath)] ?? 'application/octet-stream');
    createReadStream(filePath)
      .on('error', () => {
        res.writeHead(404);
        res.end('Not found');
      })
      .pipe(res);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const status = error.statusCode || 500;
  res.status(status).json({
    error: status >= 500 ? error.message || 'Server error.' : error.message,
  });
});

app.listen(port, () => {
  console.log(`Cell sample running at http://localhost:${port}`);
  console.log(`Sui network: ${network}`);
  console.log(`SuiNS root: ${rootName}`);
});
