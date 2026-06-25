# GymOS Frontend

Vanilla HTML/CSS/JavaScript frontend for GymOS.

## Run

Open `index.html` directly in a browser.

The app starts in local demo mode through IndexedDB/localStorage. Backend mode can be enabled in `Налаштування` after starting the NestJS API in `D:\Features\gymos\gym-os-back`.

## Backend Mode

Default API URL is configured in `index.html`:

```js
window.FORGE_CONFIG.apiBaseUrl = "http://localhost:3000";
```

Use `Налаштування` to switch `Режим даних` between `Локальний` and `Backend API`, then click `Перевірити підключення`.
