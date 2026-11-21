# TaskFlow

TaskFlow - учебный full-stack веб-сервис для управления персональными задачами.

## Возможности

1. Регистрация и вход пользователя.
2. Серверные сессии и cookie.
3. Личный кабинет.
4. Создание, просмотр, изменение и удаление задач.
5. Статусы, приоритеты и сроки.
6. Поиск и фильтрация.
7. Отдельные страницы React Router.
8. Персональные задачи каждого пользователя.
9. PostgreSQL для постоянного хранения.
10. Обработка загрузки и ошибок.
11. Автоматические тесты сервера и React-компонентов.
12. Production-сборка React.

## Стек

1. React.
2. Vite.
3. React Router.
4. Node.js.
5. Express.
6. PostgreSQL.
7. pg.
8. express-session.
9. connect-pg-simple.
10. bcrypt.
11. Vitest.
12. Supertest.
13. React Testing Library.

## Структура

```text
taskflow/
  client/
  server/
  README.md
  .gitignore
```

## Требования

1. Node.js LTS.
2. npm.
3. PostgreSQL.
4. Git.

## Подготовка базы данных

Создайте базу `taskflow` (например, в pgAdmin) и выполните в ней SQL:

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tasks (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  project VARCHAR(120) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'Нужно сделать',
  priority VARCHAR(20) NOT NULL DEFAULT 'Средний',
  due_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tasks_status_check
    CHECK (status IN ('Нужно сделать', 'В работе', 'Готово')),
  CONSTRAINT tasks_priority_check
    CHECK (priority IN ('Низкий', 'Средний', 'Высокий'))
);
```

Таблица сессий `user_sessions` создаётся автоматически при первом запуске сервера.

## Настройка server/.env

Скопируйте `server/.env.example` в `server/.env` и заполните локальные значения:

```env
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=taskflow
DB_USER=postgres
DB_PASSWORD=your_password
SESSION_SECRET=your_long_random_secret
```

Файл `server/.env` не попадает в Git.

## Установка зависимостей

```bash
cd client
npm install
cd ../server
npm install
```

## Запуск в режиме разработки

Терминал 1:

```bash
cd server
npm run dev
```

Терминал 2:

```bash
cd client
npm run dev
```

Клиент: `http://localhost:5173`

API: `http://localhost:3000`

## Тестирование

### Тесты сервера

Перед запуском создайте отдельную базу `taskflow_test` и выполните в ней SQL создания таблиц `users` и `tasks` (файл `server/taskflow_test.sql`). Тесты очищают таблицы, поэтому они работают только с базой `taskflow_test`: имя базы задаётся в команде `npm test`.

```bash
cd server
npm test
```

Тесты проверяют: `GET /api/health`, регистрацию, вход после выхода, получение и создание задач, ошибку 400 при неверных данных и запрет доступа к чужой задаче (404): задачу создаёт один пользователь, а второй зарегистрированный пользователь при запросе по её id получает 404.

### Тесты клиента

```bash
cd client
npm test
```

Проверяются компоненты `TaskCard`, `ProtectedRoute` и `ErrorState`.

## Production build

```bash
cd client
npm run build
cd ../server
npm run start:prod
```

После этого откройте `http://localhost:3000`: Express отдаёт и API, и собранный React-клиент.

## Демонстрационная учетная запись

Зарегистрируйте пользователя через страницу `/register`.