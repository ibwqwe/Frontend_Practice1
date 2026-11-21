import express from 'express';
import { randomUUID } from 'node:crypto';
import cors from 'cors';
import bcrypt from 'bcrypt';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import pool from './db/pool.js';
import { requireAuth } from './middleware/requireAuth.js';

const app = express();
const PORT = 3000;

if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET не задан в .env');
}

app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json());

const PgSession = connectPgSimple(session);
app.use(
  session({
    store: new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 1000 * 60 * 60 * 24 * 7 },
  })
);

async function getUserProfile(userId) {
  const result = await pool.query(
    `SELECT u.id, u.name, u.email, u.created_at AS "createdAt", COUNT(t.id)::int AS "taskCount"
     FROM users u LEFT JOIN tasks t ON t.user_id = u.id
     WHERE u.id = $1 GROUP BY u.id`,
    [userId]
  );
  return result.rows[0] || null;
}

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const name = req.body.name?.trim();
    const email = req.body.email?.trim().toLowerCase();
    const password = req.body.password;
    if (!name || name.length < 2) return res.status(400).json({ message: 'Имя должно содержать минимум 2 символа' });
    if (!email || !email.includes('@')) return res.status(400).json({ message: 'Укажите корректный email' });
    if (!password || password.length < 8) return res.status(400).json({ message: 'Пароль должен содержать минимум 8 символов' });
    const passwordHash = await bcrypt.hash(password, 12);
    const userId = randomUUID();
    await pool.query(
      'INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4)',
      [userId, name, email, passwordHash]
    );
    req.session.userId = userId;
    res.status(201).json(await getUserProfile(userId));
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ message: 'Пользователь с таким email уже существует' });
    next(error);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const email = req.body.email?.trim().toLowerCase();
    const password = req.body.password;
    if (!email || !password) return res.status(400).json({ message: 'Укажите email и пароль' });
    const result = await pool.query('SELECT id, name, email, password_hash FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ message: 'Неверный email или пароль' });
    }
    req.session.userId = user.id;
    res.json(await getUserProfile(user.id));
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/logout', (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('connect.sid');
    res.status(204).end();
  });
});

app.get('/api/auth/me', requireAuth, async (req, res, next) => {
  try {
    const user = await getUserProfile(req.session.userId);
    if (!user) return res.status(401).json({ message: 'Сессия пользователя недействительна' });
    res.json(user);
  } catch (error) {
    next(error);
  }
});

const allowedStatuses = ['Нужно сделать', 'В работе', 'Готово'];
const allowedPriorities = ['Низкий', 'Средний', 'Высокий'];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (value) => UUID_PATTERN.test(value);

// Столбцы, которые возвращаются клиенту (snake_case -> camelCase)
const COLUMNS = `id, title, description, project, status, priority,
  due_date::text AS "dueDate", created_at AS "createdAt", updated_at AS "updatedAt"`;

function validateTask(data, partial = false) {
  const errors = [];
  if (!partial || data.title !== undefined) {
    if (typeof data.title !== 'string' || !data.title.trim()) errors.push('Поле title обязательно');
  }
  if (!partial || data.project !== undefined) {
    if (typeof data.project !== 'string' || !data.project.trim()) errors.push('Поле project обязательно');
  }
  if (data.status !== undefined && !allowedStatuses.includes(data.status)) errors.push('Недопустимый status');
  if (data.priority !== undefined && !allowedPriorities.includes(data.priority)) errors.push('Недопустимый priority');
  if (data.description !== undefined && typeof data.description !== 'string') errors.push('Поле description должно быть строкой');
  if (data.dueDate !== undefined && typeof data.dueDate !== 'string') errors.push('Поле dueDate должно быть строкой');
  if (partial && Object.keys(data).length === 0) errors.push('Передайте хотя бы одно поле для изменения');
  return errors;
}

app.get('/api/health', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT NOW() AS db_time');
    res.json({ status: 'ok', database: 'connected', dbTime: result.rows[0].db_time });
  } catch (error) {
    next(error);
  }
});

app.get('/api/stats', requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'В работе')::int AS "inProgress",
         COUNT(*) FILTER (WHERE status = 'Готово')::int AS done
       FROM tasks WHERE user_id = $1`,
      [req.session.userId]
    );
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

app.get('/api/tasks', requireAuth, async (req, res, next) => {
  try {
    const { status, priority, project } = req.query;
    const result = await pool.query(
      `SELECT ${COLUMNS} FROM tasks
       WHERE ($1::text IS NULL OR status = $1)
         AND ($2::text IS NULL OR priority = $2)
         AND ($3::text IS NULL OR project = $3)
         AND user_id = $4
       ORDER BY created_at DESC`,
      [status ?? null, priority ?? null, project ?? null, req.session.userId]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

app.get('/api/tasks/:id', requireAuth, async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) return res.status(400).json({ message: 'Некорректный id задачи' });
    const result = await pool.query(
      `SELECT ${COLUMNS} FROM tasks WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.session.userId]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: 'Задача не найдена' });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

app.post('/api/tasks', requireAuth, async (req, res, next) => {
  try {
    const errors = validateTask(req.body);
    if (errors.length > 0) return res.status(400).json({ errors });
    const result = await pool.query(
      `INSERT INTO tasks (id, user_id, title, description, project, status, priority, due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${COLUMNS}`,
      [
        randomUUID(),
        req.session.userId,
        req.body.title.trim(),
        req.body.description ?? '',
        req.body.project.trim(),
        req.body.status ?? 'Нужно сделать',
        req.body.priority ?? 'Средний',
        req.body.dueDate || null,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/tasks/:id', requireAuth, async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) return res.status(400).json({ message: 'Некорректный id задачи' });
    const errors = validateTask(req.body, true);
    if (errors.length > 0) return res.status(400).json({ errors });

    const currentResult = await pool.query(
      `SELECT ${COLUMNS} FROM tasks WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.session.userId]
    );
    if (currentResult.rowCount === 0) return res.status(404).json({ message: 'Задача не найдена' });
    const current = currentResult.rows[0];

    const title = req.body.title !== undefined ? req.body.title.trim() : current.title;
    const project = req.body.project !== undefined ? req.body.project.trim() : current.project;
    const description = req.body.description ?? current.description;
    const status = req.body.status ?? current.status;
    const priority = req.body.priority ?? current.priority;
    const dueDate = req.body.dueDate !== undefined ? req.body.dueDate || null : current.dueDate;

    const result = await pool.query(
      `UPDATE tasks
       SET title = $1, project = $2, description = $3, status = $4,
           priority = $5, due_date = $6, updated_at = NOW()
       WHERE id = $7 AND user_id = $8
       RETURNING ${COLUMNS}`,
      [title, project, description, status, priority, dueDate, req.params.id, req.session.userId]
    );
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/tasks/:id', requireAuth, async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) return res.status(400).json({ message: 'Некорректный id задачи' });
    const result = await pool.query(
      'DELETE FROM tasks WHERE id = $1 AND user_id = $2',
      [req.params.id, req.session.userId]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: 'Задача не найдена' });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.use((req, res) => {
  res.status(404).json({ message: 'Endpoint не найден' });
});

app.use((error, req, res, next) => {
  console.error(error);
  const badDataCodes = ['22P02', '22007', '22008', '23502', '23514'];
  if (badDataCodes.includes(error.code)) {
    return res.status(400).json({ message: 'База данных отклонила переданные данные' });
  }
  res.status(500).json({ message: 'Внутренняя ошибка сервера' });
});

app.listen(PORT, () => {
  console.log(`TaskFlow API: http://localhost:${PORT}`);
});