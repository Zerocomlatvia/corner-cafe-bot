// Хранилище настроек: меню и настройки сервера лежат в файле data.json.
// Пока файла нет, берётся меню по умолчанию из menu.js.
const fs = require('fs');
const path = require('path');
const defaults = require('./menu');

const FILE = path.join(__dirname, 'data.json');

function defaultData() {
  const menu = {};
  for (const [name, prices] of Object.entries(defaults.MENU)) {
    menu[name] = { emoji: defaults.EMOJI[name] ?? '☕', prices: { ...prices } };
  }
  return { menu, settings: { stats: {}, channels: {}, access: {}, statusMessages: {}, announced: {}, menuStyle: {}, menuMessages: {}, messageStats: {}, commandPermissions: {} } };
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (raw && typeof raw.menu === 'object') {
      raw.settings = raw.settings ?? {};
      raw.settings.stats = raw.settings.stats ?? {}; // серверы → голосовой канал-счётчик
      raw.settings.channels = raw.settings.channels ?? {}; // серверы → { orders, reviews, status }
      raw.settings.access = raw.settings.access ?? {}; // серверы → [id ролей с доступом к /настроить]
      raw.settings.statusMessages = raw.settings.statusMessages ?? {}; // канал → [id последнего статуса]
      raw.settings.announced = raw.settings.announced ?? {}; // сервер → последняя объявленная версия
      raw.settings.menuStyle = raw.settings.menuStyle ?? {}; // сервер → { title, subtitle, footer }
      raw.settings.menuMessages = raw.settings.menuMessages ?? {}; // сервер → { channelId, messageId }
      raw.settings.messageStats = raw.settings.messageStats ?? {}; // сервер → { userId: count }
      raw.settings.commandPermissions = raw.settings.commandPermissions ?? {}; // сервер → { commandName: [roleIds] }
      return raw;
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('⚠️ data.json повреждён, использую меню из menu.js:', err.message);
      try {
        fs.copyFileSync(FILE, path.join(__dirname, 'data.broken.json'));
      } catch {}
    }
  }
  return defaultData();
}

const data = load();

// Сохраняем через временный файл, чтобы не потерять данные при сбое
function save() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
}

module.exports = { data, save };
