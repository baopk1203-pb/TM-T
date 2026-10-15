import EmbeddedPostgres from 'embedded-postgres';
import path from 'path';
import fs from 'fs';
import net from 'net';
import { Client } from 'pg';
import { spawn, execSync, ChildProcess } from 'child_process';

const DB_DIR = path.resolve(process.cwd(), 'data', 'local-db');
const PORT = 5432;
const USER = 'postgres';
const PASSWORD = 'postgrespassword';
const DBNAME = 'nong_san_b2b';
export const LOCAL_DATABASE_URL = `postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${DBNAME}?schema=public`;

let activePgInstance: EmbeddedPostgres | null = null;

/**
 * Checks if a TCP port is currently open/listening
 */
function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      resolve(false);
    });
    socket.connect(port, '127.0.0.1');
  });
}

/**
 * Starts local PostgreSQL server if not already running
 */
export async function startLocalPostgres(): Promise<{ pg: EmbeddedPostgres | null; isExisting: boolean; url: string }> {
  const inUse = await isPortInUse(PORT);

  if (inUse) {
    console.log(`[Local DB] PostgreSQL is already running on port ${PORT}.`);
    await ensureDatabaseExists();
    return { pg: null, isExisting: true, url: LOCAL_DATABASE_URL };
  }

  const isInitialized = fs.existsSync(path.join(DB_DIR, 'PG_VERSION'));

  // Ensure parent directory exists
  fs.mkdirSync(path.dirname(DB_DIR), { recursive: true });

  const pg = new EmbeddedPostgres({
    databaseDir: DB_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
    initdbFlags: ['--locale=C'],
  });

  if (!isInitialized) {
    console.log(`[Local DB] Khởi tạo cụm dữ liệu PostgreSQL tại: ${DB_DIR}...`);
    await pg.initialise();
  }

  console.log(`[Local DB] Khởi động PostgreSQL tại 127.0.0.1:${PORT}...`);
  await pg.start();
  activePgInstance = pg;

  await ensureDatabaseExists();
  console.log(`[Local DB] Database sẵn sàng: ${LOCAL_DATABASE_URL}`);
  return { pg, isExisting: false, url: LOCAL_DATABASE_URL };
}

/**
 * Ensures the target database exists in the PostgreSQL cluster
 */
async function ensureDatabaseExists(): Promise<void> {
  const client = new Client({
    host: '127.0.0.1',
    port: PORT,
    user: USER,
    password: PASSWORD,
    database: 'postgres',
  });

  try {
    await client.connect();
    const res = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [DBNAME]);
    if (res.rows.length === 0) {
      console.log(`[Local DB] Tạo cơ sở dữ liệu "${DBNAME}"...`);
      await client.query(`CREATE DATABASE "${DBNAME}"`);
      console.log(`[Local DB] Đã tạo thành công database "${DBNAME}".`);
    }
  } catch (err) {
    console.error('[Local DB] Lỗi kiểm tra database:', err);
    throw err;
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Checks if the database has tables; if empty, syncs schema and seeds data
 */
export async function ensureSchemaAndSeed(): Promise<void> {
  const client = new Client({
    connectionString: LOCAL_DATABASE_URL,
  });

  let tableCount = 0;
  try {
    await client.connect();
    const res = await client.query(
      `SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'User'`
    );
    tableCount = parseInt(res.rows[0]?.count || '0', 10);
  } catch {
    tableCount = 0;
  } finally {
    await client.end().catch(() => {});
  }

  if (tableCount === 0) {
    console.log('[Local DB] Cơ sở dữ liệu trống. Đang đồng bộ cấu trúc bảng (prisma db push)...');
    execSync('npx.cmd prisma db push --skip-generate', {
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: LOCAL_DATABASE_URL,
      },
    });

    console.log('[Local DB] Đang nạp dữ liệu mẫu ban đầu (seed data)...');
    execSync('npx.cmd tsx prisma/seed.ts', {
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: LOCAL_DATABASE_URL,
      },
    });
    console.log('[Local DB] Hoàn tất nạp dữ liệu mẫu!');
  } else {
    console.log('[Local DB] Dữ liệu cục bộ đã có sẵn (bảng User đã tồn tại). Bỏ qua seed.');
  }
}

/**
 * Stops local PostgreSQL server if managed by this script
 */
export async function stopLocalPostgres(): Promise<void> {
  if (activePgInstance) {
    console.log('[Local DB] Đang dừng PostgreSQL cục bộ...');
    await activePgInstance.stop();
    activePgInstance = null;
    console.log('[Local DB] PostgreSQL đã dừng.');
  }
}

/**
 * Runs Next.js dev server with local offline PostgreSQL
 */
export async function runDevOffline(): Promise<void> {
  console.log('='.repeat(60));
  console.log('🌱 KHỞI CHẠY HỆ THỐNG NÔNG SẢN B2B - CHẾ ĐỘ 100% OFFLINE');
  console.log('='.repeat(60));

  const { pg, isExisting } = await startLocalPostgres();
  await ensureSchemaAndSeed();

  console.log('\n🚀 Đang khởi động Next.js dev server...');
  console.log(`🌐 Ứng dụng: http://localhost:3000`);
  console.log(`💾 Dữ liệu lưu tại: ${DB_DIR}\n`);

  const nextProcess: ChildProcess = spawn('npx.cmd', ['next', 'dev'], {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      DATABASE_URL: LOCAL_DATABASE_URL,
    },
  });

  const cleanup = async () => {
    console.log('\n[Local DB] Đang tắt hệ thống...');
    if (nextProcess && !nextProcess.killed) {
      nextProcess.kill('SIGTERM');
    }
    if (pg && !isExisting) {
      await stopLocalPostgres();
    }
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  nextProcess.on('exit', async (code) => {
    if (pg && !isExisting) {
      await stopLocalPostgres();
    }
    process.exit(code ?? 0);
  });
}

// CLI handler
const command = process.argv[2];

if (command === 'start') {
  startLocalPostgres().then(async () => {
    console.log('[Local DB] PostgreSQL đang chạy nền. Nhấn Ctrl+C để dừng.');
    // Keep alive
    setInterval(() => {}, 10000);
  });
} else if (command === 'push') {
  startLocalPostgres().then(async ({ pg, isExisting }) => {
    try {
      execSync('npx.cmd prisma db push --skip-generate', {
        stdio: 'inherit',
        env: { ...process.env, DATABASE_URL: LOCAL_DATABASE_URL },
      });
    } finally {
      if (pg && !isExisting) await stopLocalPostgres();
    }
  });
} else if (command === 'seed') {
  startLocalPostgres().then(async ({ pg, isExisting }) => {
    try {
      execSync('npx.cmd tsx prisma/seed.ts', {
        stdio: 'inherit',
        env: { ...process.env, DATABASE_URL: LOCAL_DATABASE_URL },
      });
    } finally {
      if (pg && !isExisting) await stopLocalPostgres();
    }
  });
} else if (command === 'dev') {
  runDevOffline().catch((err) => {
    console.error('Lỗi khởi động offline:', err);
    process.exit(1);
  });
}
