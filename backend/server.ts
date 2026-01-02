import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { promisify } from 'util';
import axios from 'axios';
import { DeleteObjectCommand, PutObjectCommand, S3Client, type PutObjectCommandInput } from '@aws-sdk/client-s3';

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json());

const getTrimmedEnv = (key: string) => {
    const raw = process.env[key];
    if (typeof raw !== 'string') return null;
    let value = raw.trim();
    if (value.length >= 2) {
        const first = value[0];
        const last = value[value.length - 1];
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
            value = value.slice(1, -1).trim();
        }
    }
    return value ? value : null;
};

const joinUrl = (base: string, pathPart: string) => {
    const normalizedBase = base.replace(/\/+$/, '');
    const normalizedPath = pathPart.replace(/^\/+/, '');
    return `${normalizedBase}/${normalizedPath}`;
};

const isHttpUrl = (value: string) => value.startsWith('http://') || value.startsWith('https://');

const R2_ENDPOINT = getTrimmedEnv('R2_ENDPOINT');
const R2_ACCESS_KEY_ID = getTrimmedEnv('R2_ACCESS_KEY_ID');
const R2_SECRET_ACCESS_KEY = getTrimmedEnv('R2_SECRET_ACCESS_KEY');
const R2_BUCKET = getTrimmedEnv('R2_BUCKET');
const R2_PUBLIC_BASE_URL = getTrimmedEnv('R2_PUBLIC_BASE_URL');
const R2_PREFIX = getTrimmedEnv('R2_PREFIX');
const DEBUG_ERRORS_ENABLED = ['1', 'true', 'yes'].includes((getTrimmedEnv('DEBUG_ERRORS') || '').toLowerCase());

const R2_ENABLED = Boolean(R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET && R2_PUBLIC_BASE_URL);

const r2Client = R2_ENABLED
    ? new S3Client({
          region: 'auto',
          endpoint: R2_ENDPOINT!,
          credentials: { accessKeyId: R2_ACCESS_KEY_ID!, secretAccessKey: R2_SECRET_ACCESS_KEY! },
          forcePathStyle: true,
      })
    : null;

const buildR2ObjectKey = (key: string) => {
    const normalizedKey = key.replace(/^\/+/, '');
    if (!R2_PREFIX) return normalizedKey;
    return `${R2_PREFIX.replace(/\/+$/, '')}/${normalizedKey}`;
};

const buildR2PublicUrl = (objectKey: string) => joinUrl(R2_PUBLIC_BASE_URL!, objectKey);

const putObjectToR2 = async (params: {
    objectKey: string;
    body: PutObjectCommandInput['Body'];
    contentType?: string;
    contentLength?: number;
    cacheControl?: string;
}) => {
    if (!R2_ENABLED || !r2Client) throw new Error('R2 is not configured');
    await r2Client.send(
        new PutObjectCommand({
            Bucket: R2_BUCKET!,
            Key: params.objectKey,
            Body: params.body,
            ContentType: params.contentType,
            ContentLength: params.contentLength,
            CacheControl: params.cacheControl,
        })
    );
};

const deleteObjectFromR2 = async (objectKey: string) => {
    if (!R2_ENABLED || !r2Client) return;
    await r2Client.send(
        new DeleteObjectCommand({
            Bucket: R2_BUCKET!,
            Key: objectKey,
        })
    );
};

const getErrorInfo = (err: unknown) => {
    if (err instanceof Error) {
        const info: Record<string, unknown> = { name: err.name, message: err.message };
        const anyErr = err as unknown as Record<string, unknown>;
        const code = typeof anyErr.code === 'string' ? anyErr.code : typeof anyErr.Code === 'string' ? anyErr.Code : null;
        if (code) info.code = code;
        const metadata = anyErr.$metadata as unknown;
        if (metadata && typeof metadata === 'object') {
            const m = metadata as Record<string, unknown>;
            if (typeof m.httpStatusCode === 'number') info.httpStatusCode = m.httpStatusCode;
            if (typeof m.requestId === 'string') info.requestId = m.requestId;
        }
        return info;
    }
    return { message: String(err) };
};

const pool = new Pool({
    user: process.env.POSTGRES_USER || 'postgres',
    host: process.env.POSTGRES_HOST || 'localhost',
    database: process.env.POSTGRES_DB || 'audioprojects',
    password: process.env.POSTGRES_PASSWORD || 'password',
    port: parseInt(process.env.POSTGRES_PORT || '5455'),
});

const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const coversDir = path.join(uploadsDir, 'covers');
fs.mkdirSync(coversDir, { recursive: true });

app.use('/uploads', express.static(uploadsDir));

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (_req, file, cb) => {
        cb(null, `${Date.now()}-${path.basename(file.originalname)}`);
    },
});

const upload = multer({ storage });

type UserRole = 'user' | 'admin';

type AuthUser = {
    id: number;
    username: string;
    role: UserRole;
};

type ProjectRow = {
    id: number;
    name: string;
    audio_url: string;
    audio_object_key?: string | null;
    transcription: string | null;
    emotional_analysis: string | null;
    cover_url: string | null;
    cover_object_key?: string | null;
    created_at: string;
    user_id: number | null;
    owner_username?: string | null;
};

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            user?: AuthUser;
            sessionToken?: string;
        }
    }
}

const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS) || 30;

const scryptAsync = promisify(crypto.scrypt);

const hashPassword = async (password: string) => {
    const salt = crypto.randomBytes(16);
    const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
    return `scrypt$${salt.toString('base64')}$${derivedKey.toString('base64')}`;
};

const verifyPassword = async (password: string, storedHash: string) => {
    const parts = storedHash.split('$');
    if (parts.length !== 3) return false;
    const [algo, saltB64, keyB64] = parts;
    if (algo !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(keyB64, 'base64');
    const actual = (await scryptAsync(password, salt, expected.length)) as Buffer;
    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(expected, actual);
};

const generateSessionToken = () => crypto.randomBytes(32).toString('base64url');
const hashSessionToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

const getAuthTokenFromRequest = (req: express.Request) => {
    const header = req.header('authorization');
    if (!header) return null;
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) return null;
    return token;
};

const authMiddleware: express.RequestHandler = async (req, _res, next) => {
    try {
        const token = getAuthTokenFromRequest(req);
        if (!token) {
            next();
            return;
        }

        const tokenHash = hashSessionToken(token);
        const result = await pool.query(
            `
            SELECT u.id, u.username, u.role
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = $1 AND s.expires_at > NOW()
            `,
            [tokenHash]
        );

        if (result.rows.length > 0) {
            const row = result.rows[0] as AuthUser;
            req.user = { id: row.id, username: row.username, role: row.role };
            req.sessionToken = token;
        }

        next();
    } catch (err) {
        next(err);
    }
};

app.use(authMiddleware);

const requireAuth: express.RequestHandler = (req, res, next) => {
    if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }
    next();
};

const normalizeUsername = (username: unknown) => {
    if (typeof username !== 'string') return null;
    const normalized = username.trim().toLowerCase();
    if (normalized.length < 3 || normalized.length > 64) return null;
    return normalized;
};

const validatePassword = (password: unknown) => {
    if (typeof password !== 'string') return null;
    if (password.length < 6 || password.length > 200) return null;
    return password;
};

const resolveUploadsPath = (uploadsUrl: string) => {
    if (!uploadsUrl.startsWith('/uploads/')) {
        throw new Error('Invalid uploads URL');
    }
    const relativePath = uploadsUrl.slice('/uploads/'.length);
    const fullPath = path.resolve(uploadsDir, relativePath);
    const uploadsRoot = path.resolve(uploadsDir) + path.sep;
    if (!fullPath.startsWith(uploadsRoot)) {
        throw new Error('Invalid uploads path');
    }
    return fullPath;
};

const requireProjectWriteAccess = async (projectId: string, user: AuthUser) => {
    const result = await pool.query<ProjectRow>('SELECT * FROM projects WHERE id = $1', [projectId]);
    if (result.rows.length === 0) return { ok: false as const, status: 404 as const, error: 'Project not found' };
    const project = result.rows[0] as ProjectRow;
    if (user.role !== 'admin' && project.user_id !== user.id) {
        return { ok: false as const, status: 403 as const, error: 'Forbidden' };
    }
    return { ok: true as const, project };
};

const getProjectWithOwner = async (projectId: number | string) => {
    const result = await pool.query<ProjectRow>(
        `
        SELECT p.*, u.username AS owner_username
        FROM projects p
        LEFT JOIN users u ON u.id = p.user_id
        WHERE p.id = $1
        `,
        [projectId]
    );
    if (result.rows.length === 0) return null;
    return result.rows[0] as ProjectRow;
};

const getSafeFileExtension = (filename: string) => {
    const ext = path.extname(filename).toLowerCase();
    if (!ext) return '';
    if (!/^\.[a-z0-9]{1,10}$/.test(ext)) return '';
    return ext;
};

const mimeTypeToImageExtension = (mimeType: string) => {
    const normalized = mimeType.split(';')[0]?.trim().toLowerCase();
    if (normalized === 'image/png') return 'png';
    if (normalized === 'image/jpeg') return 'jpg';
    if (normalized === 'image/webp') return 'webp';
    if (normalized === 'image/gif') return 'gif';
    return 'png';
};

const downloadCoverToStorage = async (sourceUrl: string, projectId: string) => {
    try {
        let coverBuffer: Buffer;
        let mimeType: string;

        if (sourceUrl.startsWith('data:image/')) {
            const match = sourceUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
            if (!match) return null;
            const [, dataMimeType, b64] = match;
            coverBuffer = Buffer.from(b64, 'base64');
            mimeType = dataMimeType;
        } else {
            const response = await axios.get<ArrayBuffer>(sourceUrl, { responseType: 'arraybuffer' });
            coverBuffer = Buffer.from(response.data);
            mimeType = String(response.headers['content-type'] || 'image/png');
        }

        const normalizedMimeType = mimeType.split(';')[0]?.trim() || 'image/png';
        const extension = mimeTypeToImageExtension(normalizedMimeType);
        const filename = `${Date.now()}-project-${projectId}-${crypto.randomBytes(8).toString('hex')}.${extension}`;

        if (R2_ENABLED) {
            const objectKey = buildR2ObjectKey(`covers/project-${projectId}/${filename}`);
            await putObjectToR2({
                objectKey,
                body: coverBuffer,
                contentType: normalizedMimeType,
                contentLength: coverBuffer.length,
                cacheControl: 'public, max-age=31536000, immutable',
            });
            return { url: buildR2PublicUrl(objectKey), objectKey };
        }

        const filePath = path.join(coversDir, filename);
        fs.writeFileSync(filePath, coverBuffer);
        return { url: `/uploads/covers/${filename}`, objectKey: null };
    } catch (err) {
        console.error('Failed to store cover:', err);
        return null;
    }
};

const initDb = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(64) UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role VARCHAR(16) NOT NULL DEFAULT 'user',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS projects (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                audio_url TEXT NOT NULL,
                audio_object_key TEXT,
                transcription TEXT,
                emotional_analysis TEXT,
                cover_url TEXT,
                cover_object_key TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS sessions (
                id SERIAL PRIMARY KEY,
                token_hash TEXT UNIQUE NOT NULL,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP NOT NULL
            )
        `);

        await pool.query(`
            ALTER TABLE projects
            ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
        `);

        await pool.query(`
            ALTER TABLE projects
            ADD COLUMN IF NOT EXISTS audio_object_key TEXT,
            ADD COLUMN IF NOT EXISTS cover_object_key TEXT
        `);

        const adminUsername = normalizeUsername(process.env.ADMIN_USERNAME);
        const adminPassword = validatePassword(process.env.ADMIN_PASSWORD);
        if (adminUsername && adminPassword) {
            const existingAdmin = await pool.query('SELECT id, role FROM users WHERE username = $1', [adminUsername]);
            if (existingAdmin.rows.length === 0) {
                const passwordHash = await hashPassword(adminPassword);
                await pool.query(
                    'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)',
                    [adminUsername, passwordHash, 'admin']
                );
                console.log(`Admin user created: ${adminUsername}`);
            } else if (existingAdmin.rows[0]?.role !== 'admin') {
                await pool.query('UPDATE users SET role = $1 WHERE username = $2', ['admin', adminUsername]);
                console.log(`User promoted to admin: ${adminUsername}`);
            }
        }

        await pool.query('DELETE FROM sessions WHERE expires_at <= NOW()');

        console.log('Database initialized successfully');
    } catch (err) {
        console.error('Error initializing database:', err);
    }
};

void initDb();

// Auth
app.post('/api/auth/register', async (req, res) => {
    try {
        const username = normalizeUsername(req.body?.username);
        const password = validatePassword(req.body?.password);
        if (!username || !password) {
            res.status(400).json({ error: 'Invalid username or password' });
            return;
        }

        const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
        if (existing.rows.length > 0) {
            res.status(409).json({ error: 'Username already taken' });
            return;
        }

        const passwordHash = await hashPassword(password);
        const insertResult = await pool.query<AuthUser>(
            'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, role',
            [username, passwordHash]
        );

        const user = insertResult.rows[0] as AuthUser;
        const token = generateSessionToken();
        const tokenHash = hashSessionToken(token);
        const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
        await pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
            tokenHash,
            user.id,
            expiresAt,
        ]);

        res.json({ token, user });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to register' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const username = normalizeUsername(req.body?.username);
        const password = validatePassword(req.body?.password);
        if (!username || !password) {
            res.status(400).json({ error: 'Invalid username or password' });
            return;
        }

        const result = await pool.query<{ id: number; username: string; role: UserRole; password_hash: string }>(
            'SELECT id, username, role, password_hash FROM users WHERE username = $1',
            [username]
        );
        if (result.rows.length === 0) {
            res.status(401).json({ error: 'Invalid username or password' });
            return;
        }

        const row = result.rows[0];
        const ok = await verifyPassword(password, row.password_hash);
        if (!ok) {
            res.status(401).json({ error: 'Invalid username or password' });
            return;
        }

        const token = generateSessionToken();
        const tokenHash = hashSessionToken(token);
        const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
        await pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
            tokenHash,
            row.id,
            expiresAt,
        ]);

        const user: AuthUser = { id: row.id, username: row.username, role: row.role };
        res.json({ token, user });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to login' });
    }
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
    try {
        const token = req.sessionToken;
        if (token) {
            await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashSessionToken(token)]);
        }
        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to logout' });
    }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
    res.json({ user: req.user });
});

// Projects
app.post('/api/projects', requireAuth, upload.single('audio'), async (req, res) => {
    let uploadedObjectKey: string | null = null;
    try {
        const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        const file = req.file;

        if (!file) {
            res.status(400).json({ error: 'Audio file is required' });
            return;
        }

        let audioUrlToStore = `/uploads/${file.filename}`;
        let audioObjectKeyToStore: string | null = null;

        if (R2_ENABLED) {
            const ext = getSafeFileExtension(file.originalname);
            const objectKey = buildR2ObjectKey(`audio/${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
            await putObjectToR2({
                objectKey,
                body: fs.createReadStream(file.path),
                contentType: file.mimetype,
                contentLength: file.size,
                cacheControl: 'public, max-age=31536000, immutable',
            });
            uploadedObjectKey = objectKey;
            audioObjectKeyToStore = objectKey;
            audioUrlToStore = buildR2PublicUrl(objectKey);
        }

        const insertResult = await pool.query<{ id: number }>(
            'INSERT INTO projects (name, audio_url, audio_object_key, user_id) VALUES ($1, $2, $3, $4) RETURNING id',
            [name || 'Untitled Project', audioUrlToStore, audioObjectKeyToStore, req.user!.id]
        );
        const project = await getProjectWithOwner(insertResult.rows[0].id);
        res.json(project);
    } catch (err) {
        console.error('Failed to create project:', getErrorInfo(err));
        if (uploadedObjectKey) {
            try {
                await deleteObjectFromR2(uploadedObjectKey);
            } catch (cleanupErr) {
                console.error('Failed to cleanup R2 audio object:', cleanupErr);
            }
        }
        if (DEBUG_ERRORS_ENABLED) {
            res.status(500).json({ error: 'Failed to create project', details: getErrorInfo(err) });
            return;
        }
        res.status(500).json({ error: 'Failed to create project' });
    } finally {
        if (R2_ENABLED && req.file?.path) {
            try {
                fs.unlinkSync(req.file.path);
            } catch {
                // ignore
            }
        }
    }
});

app.get('/api/projects', async (_req, res) => {
    try {
        const result = await pool.query<ProjectRow>(
            `
            SELECT p.*, u.username AS owner_username
            FROM projects p
            LEFT JOIN users u ON u.id = p.user_id
            ORDER BY p.created_at DESC
            `
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch projects' });
    }
});

app.get('/api/projects/:id', async (req, res) => {
    try {
        const project = await getProjectWithOwner(req.params.id);
        if (!project) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }
        res.json(project);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch project' });
    }
});

app.put('/api/projects/:id', requireAuth, async (req, res) => {
    try {
        const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        if (!name) {
            res.status(400).json({ error: 'Name is required' });
            return;
        }

        const access = await requireProjectWriteAccess(req.params.id, req.user!);
        if (!access.ok) {
            res.status(access.status).json({ error: access.error });
            return;
        }

        await pool.query('UPDATE projects SET name = $1 WHERE id = $2', [name, req.params.id]);
        const updated = await getProjectWithOwner(req.params.id);
        res.json(updated);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update project' });
    }
});

app.delete('/api/projects/:id', requireAuth, async (req, res) => {
    try {
        const access = await requireProjectWriteAccess(req.params.id, req.user!);
        if (!access.ok) {
            res.status(access.status).json({ error: access.error });
            return;
        }

        const project = access.project;
        await pool.query('DELETE FROM projects WHERE id = $1', [req.params.id]);

        if (project.audio_object_key) {
            try {
                await deleteObjectFromR2(project.audio_object_key);
            } catch (err) {
                console.error('Failed to delete R2 audio object:', err);
            }
        }

        if (project.cover_object_key) {
            try {
                await deleteObjectFromR2(project.cover_object_key);
            } catch (err) {
                console.error('Failed to delete R2 cover object:', err);
            }
        }

        try {
            if (project.audio_url.startsWith('/uploads/')) {
                const audioPath = resolveUploadsPath(project.audio_url);
                if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
            }
        } catch {
            // ignore
        }

        if (project.cover_url?.startsWith('/uploads/covers/')) {
            try {
                const coverPath = resolveUploadsPath(project.cover_url);
                if (fs.existsSync(coverPath)) fs.unlinkSync(coverPath);
            } catch {
                // ignore
            }
        }

        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete project' });
    }
});

// AI Processing
app.post('/api/transcribe/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    try {
        const access = await requireProjectWriteAccess(id, req.user!);
        if (!access.ok) {
            res.status(access.status).json({ error: access.error });
            return;
        }
        const project = access.project;

        const audioMimeTypeFromExt = (ext: string) => {
            const normalized = ext.toLowerCase();
            if (normalized === '.mp3') return 'audio/mpeg';
            if (normalized === '.webm') return 'audio/webm';
            if (normalized === '.ogg') return 'audio/ogg';
            if (normalized === '.m4a') return 'audio/mp4';
            if (normalized === '.flac') return 'audio/flac';
            if (normalized === '.wav') return 'audio/wav';
            return 'audio/wav';
        };

        let audioBuffer: Buffer;
        let audioFilename: string;
        let mimeType = 'audio/wav';

        if (project.audio_url.startsWith('/uploads/')) {
            const audioPath = resolveUploadsPath(project.audio_url);
            if (!fs.existsSync(audioPath)) {
                res.status(400).json({ error: 'Audio file not found on server' });
                return;
            }
            audioBuffer = fs.readFileSync(audioPath);
            audioFilename = path.basename(audioPath);
            mimeType = audioMimeTypeFromExt(path.extname(audioPath));
        } else if (isHttpUrl(project.audio_url)) {
            const response = await axios.get<ArrayBuffer>(project.audio_url, { responseType: 'arraybuffer' });
            audioBuffer = Buffer.from(response.data);

            const headerMime = String(response.headers['content-type'] || '').split(';')[0]?.trim();
            if (headerMime) {
                mimeType = headerMime;
            } else {
                try {
                    const urlPath = new URL(project.audio_url).pathname;
                    mimeType = audioMimeTypeFromExt(path.extname(urlPath));
                } catch {
                    // ignore
                }
            }

            try {
                const urlPath = new URL(project.audio_url).pathname;
                audioFilename = path.basename(urlPath) || `project-${id}.wav`;
            } catch {
                audioFilename = `project-${id}.wav`;
            }
        } else {
            res.status(400).json({ error: 'Invalid audio URL' });
            return;
        }

        const audioBase64 = audioBuffer.toString('base64');

        const emotionalPrompt = `Ты — искусствовед. Прослушай аудио и напиши краткий анализ:

1. ТЕКСТ (1 абзац): О чём поётся/говорится?

2. ВИЗУАЛЬНЫЙ ОБРАЗ (2-3 абзаца): Опиши конкретные визуальные образы для обложки альбома. Какие сцены, персонажи, объекты, пейзажи, цвета передадут настроение этого трека? Будь конкретным: не "грусть", а "одинокая фигура на пустом пирсе в тумане".

Пиши ёмко и образно!`;

        if (!process.env.OPENROUTER_API_KEY) {
            const mockAnalysis = `ТРАНСКРИПЦИЯ: This is a mock transcription.

ЭМОЦИОНАЛЬНАЯ ПАЛИТРА: Энергичность, драйв, позитив

ВАЙБ: Современный, молодежный, динамичный

СТИЛЬ: Electronic/Pop

ВИЗУАЛЬНЫЕ АССОЦИАЦИИ: Неоновые огни, ночной город, движение

КОММЕРЧЕСКИЙ ПОТЕНЦИАЛ: Хит в стиле современной электронной музыки`;
            await pool.query('UPDATE projects SET transcription = $1, emotional_analysis = $1 WHERE id = $2', [
                mockAnalysis,
                id,
            ]);
            const updated = await getProjectWithOwner(id);
            res.json(updated);
            return;
        }

        const response = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                model: 'google/gemini-2.5-flash',
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: emotionalPrompt },
                            {
                                type: 'file',
                                file: {
                                    filename: audioFilename,
                                    file_data: `data:${mimeType};base64,${audioBase64}`,
                                },
                            },
                        ],
                    },
                ],
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'http://localhost:3000',
                    'X-Title': 'Audio Analysis App',
                },
            }
        );

        const analysis = response.data.choices[0].message.content;
        await pool.query('UPDATE projects SET transcription = $1, emotional_analysis = $1 WHERE id = $2', [analysis, id]);
        const updated = await getProjectWithOwner(id);
        res.json(updated);
    } catch (err: any) {
        console.error('Transcription Error:', err.response?.data || err.message);
        if (err.response?.status === 401 || err.response?.status === 404) {
            const mockAnalysis = `ТРАНСКРИПЦИЯ: This is a mock transcription.

ЭМОЦИОНАЛЬНАЯ ПАЛИТРА: Энергичность, драйв, позитив

ВАЙБ: Современный, молодежный, динамичный

СТИЛЬ: Electronic/Pop

ВИЗУАЛЬНЫЕ АССОЦИАЦИИ: Неоновые огни, ночной город, движение

КОММЕРЧЕСКИЙ ПОТЕНЦИАЛ: Хит в стиле современной электронной музыки`;
            await pool.query('UPDATE projects SET transcription = $1, emotional_analysis = $1 WHERE id = $2', [
                mockAnalysis,
                id,
            ]);
            const updated = await getProjectWithOwner(id);
            res.json(updated);
            return;
        }
        res.status(500).json({ error: 'Failed to transcribe' });
    }
});

app.post('/api/generate-cover/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    try {
        const access = await requireProjectWriteAccess(id, req.user!);
        if (!access.ok) {
            res.status(access.status).json({ error: access.error });
            return;
        }
        const project = access.project;

        const analysisText = project.emotional_analysis || project.transcription;
        if (!analysisText) {
            res.status(400).json({ error: 'Audio analysis required for cover generation' });
            return;
        }

        const shortPrompt = `Vinyl record cardboard sleeve cover art. Square format, just the cover filling the entire frame, no background, no borders. The artwork shows a vivid scene that captures the song's emotion and style. NO TEXT, NO LETTERS, NO WORDS on the cover. Visual imagery based on: ${analysisText.substring(0, 300)}`;

        let coverSourceUrl = '';
        if (process.env.OPENROUTER_API_KEY) {
            try {
                const imageResponse = await axios.post(
                    'https://openrouter.ai/api/v1/chat/completions',
                    {
                        model: 'google/gemini-3-pro-image-preview',
                        modalities: ['text', 'image'],
                        messages: [
                            {
                                role: 'user',
                                content: [{ type: 'text', text: shortPrompt }],
                            },
                        ],
                    },
                    {
                        headers: {
                            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
                            'Content-Type': 'application/json',
                            'HTTP-Referer': 'http://localhost:3000',
                            'X-Title': 'Audio Analysis App',
                        },
                    }
                );

                const message = imageResponse.data.choices[0].message;

                if (message.images && message.images.length > 0) {
                    coverSourceUrl = message.images[0].image_url.url;
                } else if (message.content && Array.isArray(message.content)) {
                    for (const part of message.content) {
                        if (part.type === 'image_url' && part.image_url?.url) {
                            coverSourceUrl = part.image_url.url;
                            break;
                        }
                    }
                }
            } catch (err: any) {
                console.error('Gemini cover error:', err.response?.data || err.message);
            }
        }

        if (!coverSourceUrl) {
            const seed = crypto.randomBytes(8).toString('hex');
            coverSourceUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(shortPrompt)}?width=1024&height=1024&seed=${seed}&nologo=true`;
        }

        const storedCover = await downloadCoverToStorage(coverSourceUrl, id);
        if (R2_ENABLED && !storedCover) {
            res.status(500).json({ error: 'Failed to store cover' });
            return;
        }
        const coverUrlToStore = storedCover ? storedCover.url : coverSourceUrl;
        const coverObjectKeyToStore = storedCover ? storedCover.objectKey : null;

        const previousCoverUrl = project.cover_url;
        const previousCoverObjectKey = project.cover_object_key;
        await pool.query('UPDATE projects SET cover_url = $1, cover_object_key = $2 WHERE id = $3', [
            coverUrlToStore,
            coverObjectKeyToStore,
            id,
        ]);

        if (previousCoverObjectKey && coverObjectKeyToStore && previousCoverObjectKey !== coverObjectKeyToStore) {
            try {
                await deleteObjectFromR2(previousCoverObjectKey);
            } catch (err) {
                console.error('Failed to delete previous R2 cover:', err);
            }
        }

        if (
            previousCoverUrl &&
            previousCoverUrl.startsWith('/uploads/covers/') &&
            previousCoverUrl !== coverUrlToStore
        ) {
            try {
                const previousPath = resolveUploadsPath(previousCoverUrl);
                if (fs.existsSync(previousPath)) fs.unlinkSync(previousPath);
            } catch {
                // ignore
            }
        }

        const updated = await getProjectWithOwner(id);
        res.json(updated);
    } catch (err: any) {
        console.error('Cover Gen Error:', err.response?.data || err.message);
        res.status(500).json({ error: 'Failed to generate cover' });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
