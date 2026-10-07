require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  InteractionContextType,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  Events,
} = require('discord.js');
const { SIZES, BEIGE, PINK } = require('./menu');
const { data, save } = require('./store');
const CHANGELOG = require('./changelog');

// ───────────── Проверка токена ─────────────
const token = (process.env.DISCORD_TOKEN || '').trim();
if (!token || token.startsWith('сюда')) {
  console.error('❌ В файле .env не указан токен.');
  console.error('   Откройте .env, впишите DISCORD_TOKEN=ваш_токен и сохраните (Ctrl+S).');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const MAX_ITEMS = 15; // больше напитков в одну карточку меню не помещается
const STATS_INTERVAL = 10 * 60 * 1000; // Discord разрешает переименовывать канал ~2 раза в 10 минут

// ───────────── Слэш-команды ─────────────
// Поле «напиток» с подсказками из текущего меню (список меняется без перезапуска)
const drinkOption = (o, required = true, description = 'Напиток из меню') =>
  o.setName('напиток').setDescription(description).setRequired(required).setAutocomplete(true);

const commands = [
  new SlashCommandBuilder().setName('меню').setDescription('Показать меню кафе'),

  new SlashCommandBuilder()
    .setName('отзыв')
    .setDescription('Оставить отзыв о кафе')
    .addIntegerOption((o) =>
      o
        .setName('оценка')
        .setDescription('Сколько звёзд поставите')
        .setRequired(true)
        .addChoices(
          { name: '⭐⭐⭐⭐⭐ — отлично', value: 5 },
          { name: '⭐⭐⭐⭐ — хорошо', value: 4 },
          { name: '⭐⭐⭐ — нормально', value: 3 },
          { name: '⭐⭐ — так себе', value: 2 },
          { name: '⭐ — плохо', value: 1 }
        )
    )
    .addStringOption((o) =>
      o
        .setName('текст')
        .setDescription('Расскажите, как всё прошло')
        .setRequired(true)
        .setMaxLength(500)
    )
    .addStringOption((o) => drinkOption(o, false, 'Что пробовали (необязательно)')),

  // Видна всем, а доступ проверяется внутри: администраторы + выбранные роли
  new SlashCommandBuilder()
    .setName('настроить')
    .setDescription('Панель настроек кафе (для администраторов и выбранных ролей)')
    .setContexts(InteractionContextType.Guild),
].map((c) => c.toJSON());

// Тестовые команды (добавляем в массив команд)
const testCommands = [
  new SlashCommandBuilder()
    .setName('тест-патч')
    .setDescription('🔧 Превью обычного патча (только вам)')
    .addStringOption(o => o.setName('версия').setDescription('Версия для превью').setRequired(false))
    .addStringOption(o => o.setName('название').setDescription('Заголовок патча').setRequired(false))
    .addStringOption(o => o.setName('изменения').setDescription('Список через ;').setRequired(false)),
  new SlashCommandBuilder()
    .setName('тест-мини')
    .setDescription('🔧 Превью мини-патча (только вам)')
    .addStringOption(o => o.setName('версия').setDescription('Версия для превью').setRequired(false))
    .addStringOption(o => o.setName('название').setDescription('Заголовок мини-патча').setRequired(false))
    .addStringOption(o => o.setName('изменения').setDescription('Список через ;').setRequired(false)),
];



commands.push(...testCommands.map(c => c.toJSON()));

// ───────────── Вспомогательное ─────────────
const findDrink = (name) =>
  Object.keys(data.menu).find((k) => k.toLowerCase() === String(name ?? '').trim().toLowerCase());

const sortedSizes = (item) =>
  Object.keys(item.prices)
    .map(Number)
    .sort((a, b) => a - b);

// Канал для отзывов / статуса / патчей: сначала из панели /настроить, потом из .env
const ENV_CHANNELS = {
  reviews: 'REVIEWS_CHANNEL_ID',
  status: 'STATUS_CHANNEL_ID',
  patches: 'PATCHES_CHANNEL_ID',
  menu: 'MENU_CHANNEL_ID',
};
function getChannelId(kind, guildId) {
  return (
    data.settings.channels[guildId]?.[kind] ||
    (process.env[ENV_CHANNELS[kind]] || '').trim() ||
    null
  );
}

// ───────────── Права на /настроить ─────────────
const isAdmin = (i) => Boolean(i.memberPermissions?.has(PermissionFlagsBits.ManageGuild));

function memberRoleIds(i) {
  const roles = i.member?.roles;
  if (Array.isArray(roles)) return roles;
  if (roles?.cache) return [...roles.cache.keys()];
  return [];
}

function canUseSettings(i) {
  if (!i.inGuild()) return false;
  if (isAdmin(i)) return true;
  const allowed = data.settings.access[i.guildId] ?? [];
  const mine = memberRoleIds(i);
  return allowed.some((id) => mine.includes(id));
}

// ───────────── Права на команды ─────────────
function canUseCommand(i, commandName) {
  if (!i.inGuild()) return false;
  if (isAdmin(i)) return true;
  const perms = data.settings.commandPermissions[i.guildId]?.[commandName];
  if (!perms || perms.length === 0) return true; // если не настроено — доступно всем
  const mine = memberRoleIds(i);
  return perms.some((id) => mine.includes(id));
}

// ───────────── Красивые карточки ─────────────
const line = (size = SeparatorSpacingSize.Small) =>
  new SeparatorBuilder().setDivider(true).setSpacing(size);

const text = (content) => new TextDisplayBuilder().setContent(content);

// Цветовая схема
const COLORS = {
  beige: 0xe8d5c0,    // меню, настройки
  pink: 0xf4c2c2,     // отзывы, патчи
  peach: 0xffdac1,    // мини-патчи, ошибки
  mint: 0xb5ead7,     // онлайн
  rose: 0xff9aa2,     // оффлайн
  gold: 0xf7dc6f,     // предупреждения/важно
};

const DEFAULT_STYLE = {
  title: '☕ Corner Café',
  subtitle: 'Меню · цены указаны в рублях',
  footer: 'Понравилось? Оставьте отзыв командой {отзыв} 💗',
};
const menuStyle = (guildId) => ({ ...DEFAULT_STYLE, ...(data.settings.menuStyle[guildId] ?? {}) });

// Кликабельные ссылки на команды (</отзыв:id>). Номера команд бот узнаёт при запуске.
const commandIds = {}; // сервер → { имя команды: id }
const cmdLink = (name, guildId) =>
  commandIds[guildId]?.[name] ? `</${name}:${commandIds[guildId][name]}>` : `**/${name}**`;
const fillLinks = (t, guildId) =>
  t.replaceAll('{отзыв}', cmdLink('отзыв', guildId)).replaceAll('{меню}', cmdLink('меню', guildId));

// ───────────── Утилиты для контейнеров ─────────────
function containerHeader(title, subtitle, color = COLORS.beige) {
  const c = new ContainerBuilder().setAccentColor(color);
  c.addTextDisplayComponents(text(`# ${title}` + (subtitle ? `\n-# ${subtitle}` : '')));
  c.addSeparatorComponents(line(SeparatorSpacingSize.Large));
  return c;
}

function containerSection(c, content, divider = true) {
  if (divider) c.addSeparatorComponents(line());
  c.addTextDisplayComponents(text(content));
  return c;
}

function containerFooter(c, content, color = COLORS.beige, large = true) {
  c.addSeparatorComponents(line(large ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small));
  c.addTextDisplayComponents(text(`-# ${content}`));
  return c;
}

function buildMenuContainer(guildId) {
  const st = menuStyle(guildId);
  const c = containerHeader(st.title || DEFAULT_STYLE.title, st.subtitle, COLORS.beige);

  const drinks = Object.entries(data.menu);
  if (drinks.length === 0) {
    containerSection(c, 'Меню пока пусто — загляните позже 💗', false);
  } else {
    drinks.forEach(([name, item], i) => {
      const sizes = sortedSizes(item)
        .map((size) => `\`${size} мл\` **${item.prices[size]} ₽**`)
        .join('  ·  ');
      containerSection(c, `### ${item.emoji ?? '☕'} ${name}\n${sizes}`, i > 0);
    });
  }

  if (st.footer?.trim()) {
    containerFooter(c, fillLinks(st.footer, guildId), COLORS.beige);
  }
  return c;
}

function buildReviewContainer({ rating, review, drink, author }) {
  const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
  const quote = review.split('\n').map((l) => `> ${l}`).join('\n');
  const drinkLine = drink ? `\n\n${data.menu[drink]?.emoji ?? '☕'} **${drink}**` : '';

  const c = containerHeader('💬 Новый отзыв', `${stars}`, COLORS.pink);
  containerSection(c, quote + drinkLine, false);
  containerFooter(c, `${author} · ${new Date().toLocaleDateString('ru-RU')}`, COLORS.pink);
  return c;
}

// ───────────── Меню обычным сообщением в канале ─────────────
// Такое сообщение видно всем, даже когда бот выключен. Бот сам обновляет его при смене цен.
async function publishMenu(guildId) {
  const channelId = getChannelId('menu', guildId);
  if (!channelId) return { status: 'no-channel' };

  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased()) throw new Error('это не текстовый канал');

  const payload = {
    components: [buildMenuContainer(guildId)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
  const saved = data.settings.menuMessages[guildId];

  if (saved && saved.channelId === channelId) {
    try {
      const edited = await channel.messages.edit(saved.messageId, payload);
      return { status: 'updated', url: edited.url };
    } catch (err) {
      if (err.code !== 10008) throw err; // 10008 — сообщение удалили, публикуем заново
    }
  }

  const message = await channel.send(payload);
  if (saved && saved.channelId !== channelId) {
    // канал сменили — убираем старое сообщение
    const oldChannel = await client.channels.fetch(saved.channelId).catch(() => null);
    await oldChannel?.messages?.delete(saved.messageId).catch(() => {});
  }
  data.settings.menuMessages[guildId] = { channelId, messageId: message.id };
  save();
  return { status: 'posted', url: message.url };
}

// Обновить сообщение с меню в фоне (ошибки — только в консоль)
function refreshMenu(guildId) {
  if (!getChannelId('menu', guildId)) return;
  publishMenu(guildId).catch((err) =>
    console.error(`Не удалось обновить сообщение с меню: ${err.message}`)
  );
}

const syncNote = (guildId) =>
  getChannelId('menu', guildId) ? '\n-# 📌 Сообщение с меню в канале обновляется' : '';

const menuResultText = (r) =>
  r.status === 'posted'
    ? `📌 Меню опубликовано: ${r.url}`
    : r.status === 'updated'
      ? `📌 Сообщение с меню обновлено: ${r.url}`
      : '⚠️ Сначала выберите канал: «Каналы → Меню-сообщение».';

// ───────────── Статистика: канал «Участники: N» ─────────────
async function updateStats(guildId, channelId) {
  const guild = await client.guilds.fetch({ guild: guildId, force: true });
  const count = guild.approximateMemberCount ?? guild.memberCount;
  const channel = await guild.channels.fetch(channelId);
  if (!channel) throw new Error('канал не найден');
  const name = `Участники: ${count}`;
  if (channel.name !== name) await channel.setName(name, 'Обновление статистики');
  return name;
}

async function runStatsUpdate() {
  for (const [guildId, channelId] of Object.entries(data.settings.stats)) {
    try {
      await updateStats(guildId, channelId);
    } catch (err) {
      console.error(`Не удалось обновить статистику (сервер ${guildId}): ${err.message}`);
      console.error('   Проверьте, что у бота есть право «Управлять каналами» в этом канале.');
    }
  }
}

// ═════════════ ПАНЕЛЬ /настроить ═════════════
// Все экраны — карточки (контейнеры), которые видит только тот, кто открыл панель.

const screen = (container) => ({ components: [container], flags: MessageFlags.IsComponentsV2 });

const backRow = (id = 'cfg:back', label = 'Назад') =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(id).setLabel(label).setEmoji('◀️').setStyle(ButtonStyle.Secondary)
  );

function panel(title, subtitle, notice, color = COLORS.beige) {
  const c = containerHeader(title, subtitle, color);
  if (notice) containerSection(c, notice, false);
  return c;
}

function panelSimple(title, subtitle, notice) {
  return panel(title, subtitle, notice, COLORS.beige);
}

function panelWarning(title, subtitle, notice) {
  return panel(title, subtitle, notice, COLORS.gold);
}

function panelDanger(title, subtitle, notice) {
  return panel(title, subtitle, notice, COLORS.rose);
}

function panelInfo(title, subtitle, notice) {
  return panel(title, subtitle, notice, COLORS.mint);
}

// ── Главный экран ──
function homeScreen(i, notice) {
  const g = i.guildId;
  const statsCh = data.settings.stats[g];
  const roles = data.settings.access[g] ?? [];
  const summary = [
    `🍽️ Напитков в меню: **${Object.keys(data.menu).length}**`,
    `📊 Счётчик участников: ${statsCh ? `<#${statsCh}>` : 'выключен'}`,
    `🔐 Доступ к настройкам: ${
      roles.length ? roles.map((r) => `<@&${r}>`).join(' ') + ' и администраторы' : 'только администраторы'
    }`,
  ].join('\n');

  const options = [
    new StringSelectMenuOptionBuilder()
      .setLabel('Меню и цены')
      .setDescription('Добавить, изменить или убрать напиток')
      .setValue('menu')
      .setEmoji('🍽️'),
    new StringSelectMenuOptionBuilder()
      .setLabel('Счётчик участников')
      .setDescription('Голосовой канал «Участники: N»')
      .setValue('stats')
      .setEmoji('📊'),
    new StringSelectMenuOptionBuilder()
      .setLabel('Каналы')
      .setDescription('Отзывы, статус бота и патчи')
      .setValue('channels')
      .setEmoji('📢'),
    new StringSelectMenuOptionBuilder()
      .setLabel('Написать от имени бота')
      .setDescription('Отправить сообщение в любой канал')
      .setValue('say')
      .setEmoji('✍️'),
  ];
  if (isAdmin(i)) {
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel('Доступ')
        .setDescription('Какие роли могут открывать эти настройки')
        .setValue('access')
        .setEmoji('🔐'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Права на команды')
        .setDescription('Кто может использовать /меню, /отзыв')
        .setValue('cmdperms')
        .setEmoji('🛡️')
    );
  }

  return screen(
    panelSimple('⚙️ Настройки кафе', 'Выберите, что хотите настроить', notice)
      .addTextDisplayComponents(text(summary))
      .addSeparatorComponents(line())
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('cfg:home')
            .setPlaceholder('Что хотите настроить?')
            .addOptions(options)
        )
      )
  );
}

// ── Меню и цены ──
function menuScreen(notice) {
  const drinks = Object.entries(data.menu);
  const list =
    drinks
      .map(
        ([n, it]) =>
          `${it.emoji ?? '☕'} **${n}** — ${sortedSizes(it)
            .map((s) => `${s} мл ${it.prices[s]} ₽`)
            .join(' · ')}`
      )
      .join('\n') || 'Меню пока пусто.';

  const c = panelSimple('🍽️ Меню и цены', 'Выберите напиток, чтобы изменить или удалить его', notice)
    .addTextDisplayComponents(text(list));
  c.addSeparatorComponents(line());

  if (drinks.length > 0) {
    c.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('cfg:menu:pick')
          .setPlaceholder('Выберите напиток для правки')
          .addOptions(
            drinks
              .slice(0, 25)
              .map(([n, it]) =>
                new StringSelectMenuOptionBuilder()
                  .setLabel(`${it.emoji ?? '☕'} ${n}`.slice(0, 100))
                  .setValue(n)
              )
          )
      )
    );
  }
  c.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('cfg:menu:add')
        .setLabel('Добавить напиток')
        .setEmoji('➕')
        .setStyle(ButtonStyle.Success)
        .setDisabled(drinks.length >= MAX_ITEMS),
      new ButtonBuilder().setCustomId('cfg:menu:style').setLabel('Оформление').setEmoji('🎨').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('cfg:menu:push').setLabel('Обновить в канале').setEmoji('📌').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('cfg:back').setLabel('Назад').setEmoji('◀️').setStyle(ButtonStyle.Secondary)
    )
  );
  return screen(c);
}

function drinkScreen(name, notice) {
  const item = data.menu[name];
  if (!item) return menuScreen('⚠️ Такого напитка уже нет в меню.');
  const prices = sortedSizes(item)
    .map((s) => `\`${s} мл\` **${item.prices[s]} ₽**`)
    .join('  ·  ');

  return screen(
    panelSimple(`${item.emoji ?? '☕'} ${name}`, 'Что сделать с этим напитком?', notice)
      .addTextDisplayComponents(text(prices))
      .addSeparatorComponents(line())
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`cfg:drink:edit:${name}`)
            .setLabel('Изменить')
            .setEmoji('✏️')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`cfg:drink:del:${name}`)
            .setLabel('Удалить')
            .setEmoji('🗑️')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('cfg:menu:open').setLabel('К меню').setEmoji('◀️').setStyle(ButtonStyle.Secondary)
        )
      )
  );
}

function confirmDeleteScreen(name) {
  return screen(
    panelDanger('🗑️ Удалить напиток?', 'Это действие нельзя отменить', `Убрать **${name}** из меню?`)
      .addSeparatorComponents(line())
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`cfg:drink:delok:${name}`)
            .setLabel('Да, удалить')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId(`cfg:drink:view:${name}`)
            .setLabel('Отмена')
            .setStyle(ButtonStyle.Secondary)
        )
      )
  );
}

// ── Модальные окна для напитков ──
const field = (id, label, { value, placeholder, required = false, max = 40 } = {}) => {
  const input = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(TextInputStyle.Short)
    .setRequired(required)
    .setMaxLength(max);
  if (placeholder) input.setPlaceholder(placeholder);
  if (value !== undefined && value !== null && value !== '') input.setValue(String(value));
  return new ActionRowBuilder().addComponents(input);
};

function addDrinkModal() {
  return new ModalBuilder()
    .setCustomId('cfg:modal:add')
    .setTitle('Новый напиток')
    .addComponents(
      field('name', 'Название', { required: true, placeholder: 'Например: Матча' }),
      field('emoji', 'Эмодзи (необязательно)', { placeholder: '☕', max: 60 }),
      ...SIZES.map((s) => field(`p${s}`, `Цена за ${s} мл, ₽`, { placeholder: 'Пусто — такого объёма нет', max: 6 }))
    );
}

function editDrinkModal(name) {
  const item = data.menu[name];
  return new ModalBuilder()
    .setCustomId(`cfg:modal:edit:${name}`)
    .setTitle(`Изменить: ${name}`.slice(0, 45))
    .addComponents(
      field('emoji', 'Эмодзи', { value: item.emoji ?? '☕', max: 60 }),
      ...SIZES.map((s) =>
        field(`p${s}`, `Цена за ${s} мл, ₽`, { value: item.prices[s], placeholder: 'Пусто — убрать этот объём', max: 6 })
      )
    );
}

// Цена из поля: '' → null (не задана), иначе число 1…100000 или NaN, если неверно
function parsePrice(raw) {
  const s = String(raw ?? '').replace(/\s|₽/g, '');
  if (s === '') return null;
  if (!/^\d{1,6}$/.test(s)) return NaN;
  const n = Number(s);
  return n >= 1 && n <= 100000 ? n : NaN;
}

function readPrices(fields) {
  const prices = {};
  for (const s of SIZES) {
    const p = parsePrice(fields.getTextInputValue(`p${s}`));
    if (Number.isNaN(p)) return { error: `Цена за ${s} мл должна быть целым числом от 1 до 100000.` };
    if (p !== null) prices[s] = p;
  }
  if (Object.keys(prices).length === 0) return { error: 'Укажите хотя бы одну цену.' };
  return { prices };
}

// ── Счётчик участников ──
function statsScreen(guild, notice) {
  const g = guild.id;
  const current = data.settings.stats[g];
  const select = new ChannelSelectMenuBuilder()
    .setCustomId('cfg:stats:set')
    .setPlaceholder('Выберите голосовой канал')
    .setChannelTypes(ChannelType.GuildVoice)
    .setMinValues(1)
    .setMaxValues(1);
  if (current && guild.channels?.cache?.has(current)) select.setDefaultChannels(current);

  return screen(
    panelSimple('📊 Счётчик участников', 'Бот будет называть канал «Участники: N» и обновлять его раз в 10 минут', notice)
      .addTextDisplayComponents(
        text(
          `Сейчас: ${current ? `<#${current}>` : '**выключен**'}\n` +
            '-# Боту нужно право «Управлять каналами» в этом канале. ' +
            'Чтобы в него нельзя было заходить, запретите роли @everyone право «Подключаться».'
        )
      )
      .addSeparatorComponents(line())
      .addActionRowComponents(new ActionRowBuilder().addComponents(select))
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('cfg:stats:off')
            .setLabel('Выключить счётчик')
            .setEmoji('⛔')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(!current),
          new ButtonBuilder().setCustomId('cfg:back').setLabel('Назад').setEmoji('◀️').setStyle(ButtonStyle.Secondary)
        )
      )
  );
}

// ── Каналы отзывов / статуса / патчей ──
const CHANNEL_KINDS = [
  {
    kind: 'menu',
    title: '🍽️ Меню-сообщение',
    hint: 'Бот публикует сюда меню обычным сообщением — оно видно, даже когда бот выключен. Цены в нём обновляются сами',
  },
  { kind: 'reviews', title: '💬 Отзывы', hint: 'Сюда публикуются отзывы гостей' },
  { kind: 'status', title: '📡 Статус бота', hint: 'Сообщения «в сети» и «ушёл на перерыв». Старые удаляются, остаётся последнее' },
  { kind: 'patches', title: '📜 Патчи', hint: 'Сюда бот сам публикует список изменений после обновления' },
];

function channelsScreen(guild, notice) {
  const saved = data.settings.channels[guild.id] ?? {};
  const c = panelSimple('📢 Каналы', 'Выберите текстовые каналы. Чтобы сбросить, уберите выбор', notice);

  for (const { kind, title, hint } of CHANNEL_KINDS) {
    const fromEnv = !saved[kind] && (process.env[ENV_CHANNELS[kind]] || '').trim();
    const select = new ChannelSelectMenuBuilder()
      .setCustomId(`cfg:ch:${kind}`)
      .setPlaceholder('Выберите канал')
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(0)
      .setMaxValues(1);
    if (saved[kind] && guild.channels?.cache?.has(saved[kind])) select.setDefaultChannels(saved[kind]);

    const now = saved[kind] ? `<#${saved[kind]}>` : fromEnv ? `<#${fromEnv}> (из .env)` : '**не выбран**';
    c.addTextDisplayComponents(text(`### ${title}\n${hint}\nСейчас: ${now}`));
    c.addActionRowComponents(new ActionRowBuilder().addComponents(select));
  }
  c.addActionRowComponents(backRow());
  return screen(c);
}

// ── Доступ по ролям ──
function accessScreen(guild, notice) {
  const roles = (data.settings.access[guild.id] ?? []).filter((id) => guild.roles?.cache?.has(id));
  const select = new RoleSelectMenuBuilder()
    .setCustomId('cfg:access:roles')
    .setPlaceholder('Выберите роли')
    .setMinValues(0)
    .setMaxValues(10);
  if (roles.length) select.setDefaultRoles(...roles);

  return screen(
    panelSimple('🔐 Доступ к настройкам', 'Кто, кроме администраторов, может открывать /настроить', notice)
      .addTextDisplayComponents(
        text(
          `Сейчас: ${roles.length ? roles.map((r) => `<@&${r}>`).join(' ') : '**только администраторы**'}\n` +
            '-# Администраторами считаются те, у кого есть право «Управлять сервером». ' +
            'Участники с выбранными ролями смогут менять меню, каналы, счётчик и писать от имени бота, но не этот раздел.'
        )
      )
      .addSeparatorComponents(line())
      .addActionRowComponents(new ActionRowBuilder().addComponents(select))
      .addActionRowComponents(backRow())
  );
}

// ── Права на команды ──
function commandPermsScreen(guild, notice) {
  const perms = data.settings.commandPermissions[guild.id] ?? {};
  const commandNames = ['меню', 'отзыв'];
  const c = panelSimple('🛡️ Права на команды', 'Какие роли могут использовать команды. Пусто = доступно всем', notice);

  for (const cmd of commandNames) {
    const roles = (perms[cmd] ?? []).filter((id) => guild.roles?.cache?.has(id));
    const select = new RoleSelectMenuBuilder()
      .setCustomId(`cfg:cmdperm:${cmd}`)
      .setPlaceholder('Выберите роли')
      .setMinValues(0)
      .setMaxValues(10);
    if (roles.length) select.setDefaultRoles(...roles);

    const now = roles.length ? roles.map((r) => `<@&${r}>`).join(' ') : '**всем**';
    c.addTextDisplayComponents(text(`### /${cmd}\nСейчас: ${now}`));
    c.addActionRowComponents(new ActionRowBuilder().addComponents(select));
  }
  c.addActionRowComponents(backRow());
  return screen(c);
}

function styleModal(guildId) {
  const st = menuStyle(guildId);
  return new ModalBuilder()
    .setCustomId('cfg:modal:style')
    .setTitle('Оформление меню')
    .addComponents(
      field('title', 'Заголовок', { value: st.title, required: true, max: 100 }),
      field('subtitle', 'Подзаголовок (можно оставить пустым)', { value: st.subtitle, max: 100 }),
      field('footer', 'Подпись внизу (можно пустой)', {
        value: st.footer,
        placeholder: 'Ссылка на команду: {отзыв}',
        max: 300,
      })
    );
}

// ── Написать от имени бота ──
function sayScreen(guild, channelId, notice) {
  const select = new ChannelSelectMenuBuilder()
    .setCustomId('cfg:say:pick')
    .setPlaceholder('Куда отправить сообщение')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(1)
    .setMaxValues(1);
  if (channelId && guild.channels?.cache?.has(channelId)) select.setDefaultChannels(channelId);

  return screen(
    panelSimple('✍️ Сообщение от имени бота', 'Выберите канал и напишите текст — бот отправит его сам', notice)
      .addTextDisplayComponents(
        text(
          (channelId ? `Канал: <#${channelId}>` : 'Сначала выберите канал.') +
            '\n-# Текст поддерживает **markdown**. Если заполнить заголовок, сообщение придёт красивой карточкой. ' +
            'Упоминания (@everyone, роли) не пингуют.'
        )
      )
      .addSeparatorComponents(line())
      .addActionRowComponents(new ActionRowBuilder().addComponents(select))
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`cfg:say:write:${channelId ?? 'none'}`)
            .setLabel('Написать сообщение')
            .setEmoji('✍️')
            .setStyle(ButtonStyle.Success)
            .setDisabled(!channelId),
          new ButtonBuilder().setCustomId('cfg:back').setLabel('Назад').setEmoji('◀️').setStyle(ButtonStyle.Secondary)
        )
      )
  );
}

function sayModal(channelId) {
  return new ModalBuilder()
    .setCustomId(`cfg:modal:say:${channelId}`)
    .setTitle('Сообщение от имени бота')
    .addComponents(
      field('title', 'Заголовок (необязательно)', {
        placeholder: 'Если заполнить — сообщение будет карточкой',
        max: 100,
      }),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('body')
          .setLabel('Текст сообщения')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(2000)
          .setPlaceholder('Можно использовать **markdown**')
      )
    );
}

// ── Обработка нажатий в панели ──
async function handleConfig(i) {
  const deny = (msg = 'У вас нет доступа к настройкам 🔒') =>
    i.reply({ content: msg, flags: MessageFlags.Ephemeral });

  if (!canUseSettings(i)) return deny();

  const [, area, action, ...rest] = i.customId.split(':');
  const arg = rest.join(':');
  const guild = i.guild ?? { id: i.guildId };
  const reply = (msg) => i.reply({ content: msg, flags: MessageFlags.Ephemeral });

  // Окна с формами (добавить / изменить напиток)
  if (i.isModalSubmit()) {
    const show = (s) => (i.isFromMessage() ? i.update(s) : i.reply({ ...s, flags: s.flags | MessageFlags.Ephemeral }));

    if (area === 'modal' && action === 'add') {
      const name = i.fields.getTextInputValue('name').trim();
      const emoji = i.fields.getTextInputValue('emoji').trim() || '☕';
      if (!name) return reply('Название не может быть пустым.');
      if (findDrink(name)) return reply(`«${findDrink(name)}» уже есть в меню. Выберите его в списке и нажмите «Изменить».`);
      if (Object.keys(data.menu).length >= MAX_ITEMS) return reply(`В меню уже ${MAX_ITEMS} напитков — это максимум.`);
      const { prices, error } = readPrices(i.fields);
      if (error) return reply(`⚠️ ${error}`);
      data.menu[name] = { emoji, prices };
      save();
      refreshMenu(i.guildId);
      return show(menuScreen(`✅ Добавлено: ${emoji} **${name}**${syncNote(i.guildId)}`));
    }

    if (area === 'modal' && action === 'say') {
      const title = i.fields.getTextInputValue('title').trim();
      const body = i.fields.getTextInputValue('body').trim();
      if (!body) return reply('Текст сообщения не может быть пустым.');
      try {
        const channel = await client.channels.fetch(arg);
        if (!channel?.isTextBased()) return reply('В этот канал нельзя отправить сообщение.');
const payload = title
          ? {
              components: [
                containerHeader(title, '', COLORS.beige)
                  .addTextDisplayComponents(text(body)),
              ],
              flags: MessageFlags.IsComponentsV2,
              allowedMentions: { parse: [] },
            }
          : { content: body, allowedMentions: { parse: [] } };
        const message = await channel.send(payload);
        console.log(`✍️ ${i.user.username} написал от имени бота в #${channel.name ?? arg}`);
        return show(sayScreen(guild, arg, `✅ Отправлено: ${message.url}`));
      } catch (err) {
        console.error('Не удалось отправить сообщение от бота:', err.message);
        return reply('⚠️ Не получилось отправить. Проверьте, что у бота есть право писать в этом канале.');
      }
    }

    if (area === 'modal' && action === 'style') {
      const title = i.fields.getTextInputValue('title').trim();
      if (!title) return reply('Заголовок не может быть пустым.');
      data.settings.menuStyle[i.guildId] = {
        title,
        subtitle: i.fields.getTextInputValue('subtitle').trim(),
        footer: i.fields.getTextInputValue('footer').trim(),
      };
      save();
      refreshMenu(i.guildId);
      return show(menuScreen(`✅ Оформление сохранено${syncNote(i.guildId)}`));
    }

    if (area === 'modal' && action === 'edit') {
      const name = findDrink(arg);
      if (!name) return reply('Такого напитка уже нет в меню.');
      const emoji = i.fields.getTextInputValue('emoji').trim() || '☕';
      const { prices, error } = readPrices(i.fields);
      if (error) return reply(`⚠️ ${error}`);
      data.menu[name] = { emoji, prices };
      save();
      refreshMenu(i.guildId);
      return show(drinkScreen(name, `✅ Сохранено${syncNote(i.guildId)}`));
    }
    return;
  }

  // Главный экран и навигация
  if (area === 'back') return i.update(homeScreen(i));

  if (area === 'home') {
    const choice = i.values[0];
    if (choice === 'menu') return i.update(menuScreen());
    if (choice === 'stats') return i.update(statsScreen(guild));
    if (choice === 'channels') return i.update(channelsScreen(guild));
    if (choice === 'say') return i.update(sayScreen(guild));
    if (choice === 'access') {
      if (!isAdmin(i)) return deny('Этот раздел доступен только администраторам 🔒');
      return i.update(accessScreen(guild));
    }
    if (choice === 'cmdperms') {
      if (!isAdmin(i)) return deny('Этот раздел доступен только администраторам 🔒');
      return i.update(commandPermsScreen(guild));
    }
    return;
  }

  // Меню и цены
  if (area === 'menu') {
    if (action === 'open') return i.update(menuScreen());
    if (action === 'pick') return i.update(drinkScreen(i.values[0]));
    if (action === 'style') return i.showModal(styleModal(i.guildId));
    if (action === 'push') {
      await i.deferUpdate();
      let notice;
      try {
        notice = menuResultText(await publishMenu(i.guildId));
      } catch (err) {
        console.error('Не удалось опубликовать меню:', err.message);
        notice = '⚠️ Не получилось опубликовать меню. Проверьте, что у бота есть право писать в этом канале.';
      }
      return i.editReply(menuScreen(notice));
    }
    if (action === 'add') {
      if (Object.keys(data.menu).length >= MAX_ITEMS) return reply(`В меню уже ${MAX_ITEMS} напитков — это максимум.`);
      return i.showModal(addDrinkModal());
    }
    return;
  }

  if (area === 'drink') {
    if (!data.menu[arg]) return i.update(menuScreen('⚠️ Такого напитка уже нет в меню.'));
    if (action === 'view') return i.update(drinkScreen(arg));
    if (action === 'edit') return i.showModal(editDrinkModal(arg));
    if (action === 'del') return i.update(confirmDeleteScreen(arg));
    if (action === 'delok') {
      delete data.menu[arg];
      save();
      refreshMenu(i.guildId);
      return i.update(menuScreen(`🗑️ **${arg}** убран из меню.${syncNote(i.guildId)}`));
    }
    return;
  }

  // Счётчик участников
  if (area === 'stats') {
    if (action === 'off') {
      delete data.settings.stats[i.guildId];
      save();
      return i.update(statsScreen(guild, '✅ Счётчик выключен. Сам канал остался, его можно удалить вручную.'));
    }
    if (action === 'set') {
      const channelId = i.values[0];
      await i.deferUpdate();
      data.settings.stats[i.guildId] = channelId;
      save();
      let notice;
      try {
        const name = await updateStats(i.guildId, channelId);
        notice = `✅ Готово! Канал теперь называется «${name}».`;
      } catch (err) {
        console.error('Не удалось обновить канал статистики:', err.message);
        notice =
          '⚠️ Канал выбран, но переименовать его не получилось. Дайте боту право «Управлять каналами» ' +
          'в этом канале (Настройки канала → Права доступа) и выберите канал ещё раз.';
      }
      return i.editReply(statsScreen(guild, notice));
    }
    return;
  }

  // Написать от имени бота
  if (area === 'say') {
    if (action === 'pick') return i.update(sayScreen(guild, i.values[0]));
    if (action === 'write') {
      if (!arg || arg === 'none') return reply('Сначала выберите канал.');
      return i.showModal(sayModal(arg));
    }
    return;
  }

  // Каналы отзывов / статуса / патчей
  if (area === 'ch') {
    const known = CHANNEL_KINDS.find((k) => k.kind === action);
    if (!known) return;
    const chosen = i.values[0];
    data.settings.channels[i.guildId] = data.settings.channels[i.guildId] ?? {};
    if (chosen) data.settings.channels[i.guildId][action] = chosen;
    else delete data.settings.channels[i.guildId][action];
    save();
    if (action === 'menu' && chosen) {
      await i.deferUpdate();
      let notice;
      try {
        notice = `✅ ${known.title}: <#${chosen}>\n${menuResultText(await publishMenu(i.guildId))}`;
      } catch (err) {
        console.error('Не удалось опубликовать меню:', err.message);
        notice = `⚠️ Канал выбран, но опубликовать меню не получилось. Проверьте, что у бота есть право писать в <#${chosen}>.`;
      }
      return i.editReply(channelsScreen(guild, notice));
    }
    return i.update(
      channelsScreen(
        guild,
        chosen
          ? `✅ ${known.title}: <#${chosen}>`
          : `✅ ${known.title}: выбор сброшен${action === 'menu' ? '. Старое сообщение осталось в канале, но больше не обновляется' : ''}`
      )
    );
  }

  // Доступ по ролям
  if (area === 'access') {
    if (!isAdmin(i)) return deny('Этот раздел доступен только администраторам 🔒');
    data.settings.access[i.guildId] = [...i.values];
    save();
    return i.update(
      accessScreen(guild, i.values.length ? '✅ Доступ обновлён' : '✅ Теперь настройки открывают только администраторы')
    );
  }

  // Права на команды
  if (area === 'cmdperm') {
    if (!isAdmin(i)) return deny('Этот раздел доступен только администраторам 🔒');
    const cmd = action;
    data.settings.commandPermissions[i.guildId] = data.settings.commandPermissions[i.guildId] ?? {};
    data.settings.commandPermissions[i.guildId][cmd] = [...i.values];
    save();

    // Синхронизация с Discord API
    try {
      const guildCmds = await i.guild.commands.fetch();
      const targetCmd = guildCmds.find(c => c.name === cmd);
      if (targetCmd) {
        const roleIds = data.settings.commandPermissions[i.guildId][cmd] ?? [];
        const permissions = roleIds.map(id => ({ id, type: 1, permission: true })); // 1 = ROLE
        await i.guild.commands.permissions.set({ fullPermissions: permissions, commandId: targetCmd.id });
      }
    } catch (err) {
      console.error('Не удалось синхронизировать права с Discord:', err.message);
    }

    return i.update(
      commandPermsScreen(guild, i.values.length ? `✅ Права для /${cmd} обновлены (синхронизировано с Discord)` : `✅ /${cmd} доступно всем (синхронизировано с Discord)`)
    );
  }
}

// ───────────── Статус бота (сообщения в канал) ─────────────
const STATUS_PRESETS = {
  online: {
    color: COLORS.mint,
    title: '🟢 Администратор в сети',
    description: 'Кафе открыто! Команды: **/меню** и **/отзыв** ☕',
  },
  offline: {
    color: COLORS.rose,
    title: '🔴 Администратор ушёл на перерыв',
    description: 'Бот остановлен, команды пока не работают.',
  },
  updating: {
    color: COLORS.gold,
    title: '🟡 Бот обновляется',
    description: 'Применяются изменения, скоро вернёмся! ⚙️',
  },
  error: {
    color: COLORS.peach,
    title: '⚠️ Что-то пошло не так',
    description: 'У бота возникла ошибка.',
  },
};

let lastErrorStatusAt = 0;

// Все каналы статуса: выбранные в панели + из .env (без повторов)
function statusChannelIds() {
  const ids = new Set();
  const fromEnv = (process.env.STATUS_CHANNEL_ID || '').trim();
  if (fromEnv) ids.add(fromEnv);
  for (const ch of Object.values(data.settings.channels)) if (ch?.status) ids.add(ch.status);
  return [...ids];
}

// Это сообщение — статус, который отправил сам бот?
const isStatusMessage = (m) =>
  m.author?.id === client.user?.id &&
  m.components?.[0]?.type === 17 && // Container
  m.components[0].components?.some(c =>
    c.type === 10 && // TextDisplay
    c.data?.content?.includes?.('Corner Café')
  );

// Оставляем в канале только свежий статус: прошлые сообщения бота удаляем
async function cleanOldStatuses(channel, keepId) {
  for (const id of data.settings.statusMessages[channel.id] ?? []) {
    if (id !== keepId) await channel.messages.delete(id).catch(() => {});
  }
  try {
    const recent = await channel.messages.fetch({ limit: 50 });
    for (const m of recent.values()) {
      if (m.id !== keepId && isStatusMessage(m)) await m.delete().catch(() => {});
    }
  } catch {
    // нет права читать историю — хватит сохранённых id
  }
}

function buildStatusContainer(kind, details = '') {
  const preset = STATUS_PRESETS[kind];
  const c = containerHeader(preset.title, '', preset.color);
  const desc = details ? `${preset.description}\n\`\`\`${details.slice(0, 300)}\`\`\`` : preset.description;
  containerSection(c, desc, false);
  containerFooter(c, `Corner Café • ${new Date().toLocaleString('ru-RU')}`, preset.color);
  return c;
}

async function sendStatus(kind, details = '') {
  if (!client.isReady()) return;

  for (const channelId of statusChannelIds()) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isTextBased()) continue;
      const message = await channel.send({
        components: [buildStatusContainer(kind, details)],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      });
      await cleanOldStatuses(channel, message.id);
      data.settings.statusMessages[channelId] = [message.id];
      save();
    } catch (err) {
      console.error('Не удалось отправить статус в канал:', err.message);
      console.error('   Проверьте канал статуса и права бота в нём.');
    }
  }
}

// Аккуратное выключение: сначала сообщаем «ушёл на перерыв», потом выходим
let shuttingDown = false;
let isContainerRestart = false; // флаг для игнора SIGTERM при рестарте контейнера
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\nОстанавливаю бота (${signal})...`);
  // Не шлём статус offline при рестарте контейнера (Railway SIGTERM)
  if (!isContainerRestart) {
    await Promise.race([sendStatus('offline'), new Promise((r) => setTimeout(r, 4000))]);
  }
  client.destroy();
  process.exit(0);
}
// Railway шлёт SIGTERM перед рестартом — помечаем как рестарт контейнера
process.on('SIGTERM', () => {
  isContainerRestart = true;
  shutdown('SIGTERM');
});
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGHUP', () => shutdown('SIGHUP'));
process.on('SIGBREAK', () => shutdown('SIGBREAK'));

// Неожиданные ошибки — тоже в канал статуса (не чаще раза в минуту)
async function reportError(err) {
  console.error('Необработанная ошибка:', err);
  if (shuttingDown || Date.now() - lastErrorStatusAt < 60000) return;
  lastErrorStatusAt = Date.now();
  await sendStatus('error', String(err?.message ?? err));
}
process.on('unhandledRejection', reportError);
process.on('uncaughtException', async (err) => {
  await reportError(err);
  process.exit(1);
});

// ───────────── Патчи: бот сам публикует список изменений ─────────────
const cmpVer = (a, b) => {
  const A = String(a).split('.').map(Number);
  const B = String(b).split('.').map(Number);
  for (let k = 0; k < 3; k++) {
    const d = (A[k] || 0) - (B[k] || 0);
    if (d) return d;
  }
  return 0;
};
const versionsOldestFirst = [...CHANGELOG].sort((a, b) => cmpVer(a.version, b.version));
const LATEST = versionsOldestFirst[versionsOldestFirst.length - 1];

function patchCard(entry) {
  const date = new Date(`${entry.date}T12:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return new ContainerBuilder()
    .setAccentColor(PINK)
    .addTextDisplayComponents(text(`# 📜 Обновление ${entry.version}\n-# ${date}`))
    .addSeparatorComponents(line(SeparatorSpacingSize.Large))
    .addTextDisplayComponents(text(`## ${entry.title}`))
    .addSeparatorComponents(line())
    .addTextDisplayComponents(
      text(entry.changes.map((c) => `▸ ${c}`).join('\n'))
    )
    .addSeparatorComponents(line(SeparatorSpacingSize.Large))
    .addTextDisplayComponents(text(`-# Corner Café • ${entry.version}`));
}

function miniPatchCard(entry) {
  const date = new Date(`${entry.date}T12:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return new ContainerBuilder()
    .setAccentColor(0xffdac1)
    .addTextDisplayComponents(text(`## 📦 Мини-патч ${entry.version}\n-# ${date}`))
    .addSeparatorComponents(line())
    .addTextDisplayComponents(text(`### ${entry.title}`))
    .addSeparatorComponents(line(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      text(entry.changes.map((c) => `▸ ${c}`).join('\n'))
    )
    .addSeparatorComponents(line(SeparatorSpacingSize.Large))
    .addTextDisplayComponents(text(`-# Corner Café`));
}

const MINI_PATCH_CHANNEL_ID = '1556757280752410734';

async function announceMiniPatches(c) {
  try {
    const channel = await client.channels.fetch(MINI_PATCH_CHANNEL_ID);
    if (!channel?.isTextBased()) return;

    // Мини-патчи имеют свою нумерацию: 1.1, 1.2, 1.3...
    const lastMini = data.settings.announcedMini ?? '1.0';
    const [major, minor] = lastMini.split('.').map(Number);
    const nextMini = `${major}.${minor + 1}`;

    // Создаём запись для мини-патча
    const entry = {
      version: nextMini,
      date: new Date().toISOString().slice(0, 10),
      title: 'Обновление',
      changes: [
        '✅ Меню больше не дублируется при перезапуске бота',
        '🛠 Исправлены перезапуски — бот теперь стабильно работает 24/7',
      ],
    };

    await channel.send({
      components: [miniPatchCard(entry)],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });
    data.settings.announcedMini = nextMini;
    save();
    console.log(`📦 Мини-патч ${nextMini} отправлен`);
  } catch (err) {
    console.error('Не удалось отправить мини-патч:', err.message);
  }
}

async function announcePatches(c) {
  if (!LATEST) return;
  for (const guild of c.guilds.cache.values()) {
    const channelId = getChannelId('patches', guild.id);
    if (!channelId) continue;

    // Первый раз публикуем только последнюю запись, дальше — все новые (не больше трёх)
    const last = data.settings.announced[guild.id];
    const pending = (last ? versionsOldestFirst.filter((e) => cmpVer(e.version, last) > 0) : [LATEST]).slice(-3);
    if (pending.length === 0) continue;

    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isTextBased()) continue;
      for (const entry of pending) {
        await channel.send({
          components: [patchCard(entry)],
          flags: MessageFlags.IsComponentsV2,
          allowedMentions: { parse: [] },
        });
        data.settings.announced[guild.id] = entry.version;
        save();
        console.log(`📜 Патч ${entry.version} опубликован на сервере «${guild.name}»`);
      }
    } catch (err) {
      console.error(`Не удалось опубликовать патч на сервере «${guild.name}»: ${err.message}`);
      console.error('   Проверьте канал патчей и права бота в нём.');
    }
  }
}

// ───────────── Запуск ─────────────
client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Бот запущен как ${c.user.tag}`);
  console.log(`📦 Версия бота: ${LATEST?.version ?? '—'}`);

  // Убираем глобальные команды (чтобы не было дублей) и ставим команды
  // на каждый сервер бота — так они появляются сразу.
  try {
    await c.application.commands.set([]);
  } catch (err) {
    console.error('Не удалось очистить глобальные команды:', err.message);
  }

  for (const guild of c.guilds.cache.values()) {
    try {
      const done = [...(await guild.commands.set(commands)).values()];
      commandIds[guild.id] = Object.fromEntries(done.map((x) => [x.name, x.id]));
      console.log(`✅ Команды на сервере «${guild.name}»: ${done.map((x) => x.name).join(', ')}`);
    } catch (err) {
      console.error(`❌ Не удалось поставить команды на сервер «${guild.name}»: ${err.message}`);
      console.error(
        '   Если ошибка про Missing Access — пригласите бота заново со scope applications.commands.'
      );
    }
  }

  if (c.guilds.cache.size === 0) {
    console.log('⚠️ Бот пока не добавлен ни на один сервер — пригласите его по ссылке из OAuth2.');
  }

  await sendStatus('updating');
  await new Promise(r => setTimeout(r, 2000));
  await sendStatus('online');
  // await announcePatches(c); // отключено — пишем обновления вручную
  // await announceMiniPatches(c); // отключено — пишем обновления вручную

  // Меню НЕ публикуем автоматически при старте.
  // Публикуется только: командой /меню или кнопкой «Обновить в канале» в /настроить

  await runStatsUpdate();
  setInterval(runStatsUpdate, STATS_INTERVAL);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // Подсказки напитков при вводе
    if (interaction.isAutocomplete()) {
      const typed = String(interaction.options.getFocused()).toLowerCase();
      const options = Object.entries(data.menu)
        .filter(([name]) => name.toLowerCase().includes(typed))
        .slice(0, 25)
        .map(([name, item]) => ({ name: `${item.emoji ?? '☕'} ${name}`.slice(0, 100), value: name }));
      return await interaction.respond(options);
    }

    // Кнопки, списки и формы из панели /настроить
    if (
      (interaction.isMessageComponent() || interaction.isModalSubmit()) &&
      interaction.customId.startsWith('cfg:')
    ) {
      return await handleConfig(interaction);
    }

    if (!interaction.isChatInputCommand()) return;

    // /меню
    if (interaction.commandName === 'меню') {
      if (!canUseCommand(interaction, 'меню')) {
        return await interaction.reply({ content: 'У вас нет прав для этой команды 🔒', flags: MessageFlags.Ephemeral });
      }
      return await interaction.reply({
        components: [buildMenuContainer(interaction.guildId)],
        flags: MessageFlags.IsComponentsV2,
      });
    }

    // /настроить — панель, которую видите только вы
    if (interaction.commandName === 'настроить') {
      if (!canUseSettings(interaction)) {
        return await interaction.reply({
          content: 'Настройки доступны только администраторам и выбранным ролям 🔒',
          flags: MessageFlags.Ephemeral,
        });
      }
      const home = homeScreen(interaction);
      return await interaction.reply({ ...home, flags: home.flags | MessageFlags.Ephemeral });
    }

    // /тест-патч — превью обычного патча (только админы)
    if (interaction.commandName === 'тест-патч') {
      if (!isAdmin(interaction)) {
        return await interaction.reply({ content: 'Только для администраторов 🔒', flags: MessageFlags.Ephemeral });
      }
      const version = interaction.options.getString('версия') ?? '3.3.0';
      const title = interaction.options.getString('название') ?? 'Тестовый патч';
      const changesStr = interaction.options.getString('изменения') ?? 'Изменение 1;Изменение 2;Исправлена бага';
      const changes = changesStr.split(';').map(s => s.trim()).filter(Boolean);
      const entry = { version, date: new Date().toISOString().slice(0, 10), title, changes };
      return await interaction.reply({
        components: [patchCard(entry)],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    // /тест-мини — превью мини-патча (только админы)
    if (interaction.commandName === 'тест-мини') {
      if (!isAdmin(interaction)) {
        return await interaction.reply({ content: 'Только для администраторов 🔒', flags: MessageFlags.Ephemeral });
      }
      const version = interaction.options.getString('версия') ?? '3.3.0';
      const title = interaction.options.getString('название') ?? 'Тестовый мини-патч';
      const changesStr = interaction.options.getString('изменения') ?? 'Мелкое улучшение;Исправление бага';
      const changes = changesStr.split(';').map(s => s.trim()).filter(Boolean);
      const entry = { version, date: new Date().toISOString().slice(0, 10), title, changes };
      return await interaction.reply({
        components: [miniPatchCard(entry)],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    // /отзыв
    if (interaction.commandName === 'отзыв') {
      if (!canUseCommand(interaction, 'отзыв')) {
        return await interaction.reply({ content: 'У вас нет прав для этой команды 🔒', flags: MessageFlags.Ephemeral });
      }
      // Защита от двойного клика
      const reviewKey = `review:${interaction.user.id}:${Date.now()}`;
      if (global.reviewCooldown?.has(interaction.user.id)) {
        return await interaction.reply({ content: 'Подождите перед отправкой следующего отзыва ⏳', flags: MessageFlags.Ephemeral });
      }
      global.reviewCooldown = global.reviewCooldown ?? new Set();
      global.reviewCooldown.add(interaction.user.id);
      setTimeout(() => global.reviewCooldown.delete(interaction.user.id), 3000);
      const drinkInput = interaction.options.getString('напиток');
      const drink = drinkInput ? findDrink(drinkInput) : null;
      if (drinkInput && !drink) {
        return await interaction.reply({
          content: 'Такого напитка нет в меню. Выберите его из подсказок или оставьте поле пустым.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const container = buildReviewContainer({
        rating: interaction.options.getInteger('оценка'),
        review: interaction.options.getString('текст'),
        drink,
        author: interaction.member?.displayName ?? interaction.user.username,
      });

      const payload = {
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] }, // отзыв никого не пингует
      };

      // Отзывы публикуются только в отдельном канале (/настроить → Каналы → Отзывы)
      const channelId = getChannelId('reviews', interaction.guildId);
      if (!channelId) {
        return await interaction.reply({
          content:
            'Канал для отзывов пока не выбран 😔 Попросите администратора выбрать его: **/настроить → Каналы → Отзывы**.',
          flags: MessageFlags.Ephemeral,
        });
      }
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased()) {
        return await interaction.reply({
          content: 'Не получилось найти канал для отзывов. Сообщите об этом администратору 🙏',
          flags: MessageFlags.Ephemeral,
        });
      }
      try {
        const message = await channel.send(payload);
        return await interaction.reply({
          content: `Спасибо за отзыв! 💗 Он опубликован: ${message.url}`,
          flags: MessageFlags.Ephemeral,
        });
      } catch (err) {
        console.error('Не удалось опубликовать отзыв:', err.message);
        return await interaction.reply({
          content: 'Не получилось опубликовать отзыв: у бота нет права писать в канале отзывов. Сообщите администратору 🙏',
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  } catch (err) {
    console.error('Ошибка при обработке действия:', err);
    if (interaction.isAutocomplete?.()) return;
    const msg = {
      content: 'Что-то пошло не так 😔 Попробуйте ещё раз.',
      flags: MessageFlags.Ephemeral,
    };
    if (interaction.replied || interaction.deferred) await interaction.followUp(msg).catch(() => {});
    else await interaction.reply(msg).catch(() => {});
  }
});

client.on(Events.Error, (err) => console.error('Ошибка клиента:', err));

client.login(token).catch((err) => {
  if (err.code === 'TokenInvalid') {
    console.error('❌ Discord не принял токен.');
    console.error('   Сбросьте токен в Developer Portal (Бот → Сбросить токен),');
    console.error('   вставьте новый в .env после DISCORD_TOKEN= и сохраните файл (Ctrl+S).');
  } else {
    console.error(err);
  }
  process.exit(1);
});
