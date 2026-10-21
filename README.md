# Чат Telegram на GREEN-API

Веб-чат для отправки и получения текстовых сообщений в Telegram через [GREEN-API](https://green-api.com/en/telegram/docs/api/sending/SendMessage/). Внешний вид берётся с [web.max.ru](https://web.max.ru/).

Стек: Vite, React, TypeScript. Запросы идут из браузера напрямую в GREEN-API, отдельного сервера нет.

## Локальный запуск

```bash
npm install
cp .env.example .env
npm run dev
```

В `.env` в переменную `VITE_GREEN_API_URL` вставьте `apiUrl` своего инстанса из [личного кабинета GREEN-API](https://console.green-api.com/). После правки файла перезапустите `npm run dev`.

`idInstance` и `apiTokenInstance` тоже берутся в кабинете и вводятся на экране входа.

Чтобы входящие сообщения приходили в браузер, поле `webhookUrl` в настройках инстанса должно быть пустым. Если оно заполнено, откройте настройки и очистите его: иначе приём по HTTP API недоступен.
