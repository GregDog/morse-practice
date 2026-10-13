const http = require('http');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT || 10002);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const RPC = {
  mp_get_stats: {
    args: []
  },

  mp_sync_visitor: {
    args: [
      'p_visitor_id',
      'p_usage_seconds',
      'p_country',
      'p_practice_seconds',
      'p_qso_count',
      'p_racer_count',
      'p_duel_count',
      'p_liked',
      'p_skcc',
      'p_licw'
    ]
  },

  mp_record_event: {
    args: [
      'p_visitor_id',
      'p_callsign',
      'p_country',
      'p_activity',
      'p_event_type',
      'p_meta'
    ]
  },

  mp_record_game_result: {
    args: [
      'p_result_id',
      'p_visitor_id',
      'p_callsign',
      'p_country',
      'p_game',
      'p_bucket',
      'p_metric',
      'p_value',
      'p_week',
      'p_meta'
    ]
  },

  mp_record_visit: {
    args: [
      'p_visitor_id',
      'p_country'
    ]
  }
};

function send(res, status, body) {
  const json = JSON.stringify(body);

  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store'
  });

  res.end(json);
}

async function rpc(name, body) {
  const spec = RPC[name];

  if (!spec) {
    const e = new Error('RPC not allowed');
    e.status = 404;
    throw e;
  }

  const supplied = body && typeof body === 'object' ? body : {};

  const names = spec.args.filter(
    key => Object.prototype.hasOwnProperty.call(supplied, key)
  );

  let sql;
  let values;

  if (!names.length) {
    sql = `SELECT public.${name}() AS result`;
    values = [];
  } else {
    const named = names.map(
      (key, i) => `${key} => $${i + 1}`
    );

    sql = `SELECT public.${name}(${named.join(', ')}) AS result`;
    values = names.map(key => supplied[key]);
  }

  const result = await pool.query(sql, values);

  return result.rows[0]?.result ?? null;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
      });
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/api/health') {
      const q = await pool.query(
        'SELECT current_database() db, current_user usr, now() ts'
      );

      send(res, 200, {
        ok: true,
        service: 'morse-practice',
        database: q.rows[0].db,
        user: q.rows[0].usr,
        time: q.rows[0].ts
      });
      return;
    }

    const match = req.url.match(/^\/rest\/v1\/rpc\/([a-zA-Z0-9_]+)$/);

    if (req.method === 'POST' && match) {
      let raw = '';

      for await (const chunk of req) {
        raw += chunk;

        if (raw.length > 1024 * 1024) {
          send(res, 413, { error: 'body too large' });
          return;
        }
      }

      let body = {};

      if (raw.trim()) {
        try {
          body = JSON.parse(raw);
        } catch {
          send(res, 400, { error: 'invalid json' });
          return;
        }
      }

      const result = await rpc(match[1], body);
      send(res, 200, result);
      return;
    }

    send(res, 404, { error: 'not found' });

  } catch (err) {
    console.error(err);
    send(res, err.status || 500, {
      error: err.message || 'internal error'
    });
  }
});

pool.query('SELECT 1')
  .then(() => {
    server.listen(PORT, '127.0.0.1', () => {
      console.log(`Morse Practice API listening on 127.0.0.1:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Database connection failed:', err);
    process.exitCode = 1;
  });
