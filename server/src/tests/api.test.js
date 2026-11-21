import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import app from '../app.js';
import pool from '../db/pool.js';

const agent = request.agent(app);
const testEmail = 'taskflow-test@example.com';

beforeAll(async () => {
  await pool.query('DELETE FROM tasks');
  await pool.query('DELETE FROM users');
});

afterAll(async () => {
  await pool.query('DELETE FROM tasks');
  await pool.query('DELETE FROM users');

  try {
    await pool.query('DELETE FROM user_sessions');
  } catch {
    // Таблица появится после первого использования сессии.
  }

  await pool.end();
});

describe('TaskFlow API', () => {
  test('GET /api/health возвращает ok', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  test('регистрация создает пользователя и сессию', async () => {
    const response = await agent.post('/api/auth/register').send({
      name: 'Test Student',
      email: testEmail,
      password: 'password123',
    });

    expect(response.status).toBe(201);
    expect(response.body.email).toBe(testEmail);
    expect(response.headers['set-cookie']).toBeDefined();
  });

  test('вход работает после выхода', async () => {
    await agent.post('/api/auth/logout').expect(204);

    const response = await agent.post('/api/auth/login').send({
      email: testEmail,
      password: 'password123',
    });

    expect(response.status).toBe(200);
    expect(response.body.email).toBe(testEmail);
  });

  test('авторизованный пользователь получает задачи', async () => {
    const response = await agent.get('/api/tasks');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  test('авторизованный пользователь создает задачу', async () => {
    const response = await agent.post('/api/tasks').send({
      title: 'Проверить тесты',
      project: 'TaskFlow',
      status: 'В работе',
      priority: 'Высокий',
      dueDate: '2026-10-01',
    });

    expect(response.status).toBe(201);
    expect(response.body.title).toBe('Проверить тесты');
  });

  test('неверные данные задачи возвращают 400', async () => {
    const response = await agent.post('/api/tasks').send({
      title: '',
      project: 'TaskFlow',
      status: 'Неизвестно',
      priority: 'Высокий',
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toBeTruthy();
  });

  // Самостоятельное задание: запрет доступа к чужой задаче
  test('чужая задача недоступна другому пользователю (404)', async () => {
    const created = await agent.post('/api/tasks').send({
      title: 'Личная задача',
      project: 'TaskFlow',
    });
    expect(created.status).toBe(201);

    const otherAgent = request.agent(app);
    await otherAgent
      .post('/api/auth/register')
      .send({
        name: 'Other Student',
        email: 'taskflow-other@example.com',
        password: 'password123',
      })
      .expect(201);

    const response = await otherAgent.get(`/api/tasks/${created.body.id}`);

    expect(response.status).toBe(404);
  });
});