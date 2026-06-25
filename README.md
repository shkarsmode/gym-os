# GymOS Frontend

Vanilla HTML/CSS/JavaScript frontend для GymOS.

## Запуск

Відкрий `index.html` напряму в браузері.

Застосунок стартує в локальному деморежимі через IndexedDB/localStorage. Режим бекенду можна увімкнути в `Налаштуваннях` після запуску NestJS API у `D:\Features\gymos\gym-os-back`.

## Режим бекенду

Базовий URL API налаштований в `index.html`:

```js
window.FORGE_CONFIG.apiBaseUrl = "http://localhost:3000";
```

У `Налаштуваннях` перемкни `Режим даних` між `Локальний` і `Бекенд API`, потім натисни `Перевірити підключення`.
