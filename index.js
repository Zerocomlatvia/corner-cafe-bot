require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Events,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
  SlashCommandBuilder,
  InteractionContextType,
} = require('discord.js');
const { data, save } = require('./store');
const CHANGELOG = require('./changelog');
const { SIZES, BEIGE, PINK } = require('./menu');

console.log('🔄 TEST START');

const token = (process.env.DISCORD_TOKEN || '').trim();
console.log('✅ Token:', token ? 'yes' : 'no');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
console.log('✅ Client created');

const line = (size = SeparatorSpacingSize.Small) =>
  new SeparatorBuilder().setDivider(true).setSpacing(size);
const text = (content) => new TextDisplayBuilder().setContent(content);

const COLORS = {
  mint: 0xb5ead7,
};

function containerHeader(title, subtitle, color) {
  const c = new ContainerBuilder().setAccentColor(color);
  c.addTextDisplayComponents(text('# ' + title + (subtitle ? '\n-# ' + subtitle : '')));
  c.addSeparatorComponents(line(SeparatorSpacingSize.Large));
  return c;
}

function buildStatusContainer(kind, details) {
  const c = containerHeader('🟢 Администратор в сети', '', COLORS.mint);
  const desc = 'Кафе открыто! Команды: **/меню** и **/отзыв** ☕';
  c.addTextDisplayComponents(text(desc));
  c.addSeparatorComponents(line(SeparatorSpacingSize.Large));
  c.addTextDisplayComponents(text('-# Corner Café • ' + new Date().toLocaleString('ru-RU')));
  return c;
}

async function sendStatus(client, kind) {
  const channelId = '1556045836939558952';
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) return;
    const message = await channel.send({
      components: [buildStatusContainer(kind)],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });
    console.log('Status sent!');
  } catch (err) {
    console.error('Send status error:', err.message);
  }
}

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
    .addStringOption((o) =>
      o.setName('напиток').setDescription('Напиток из меню').setRequired(false).setAutocomplete(true)
    ),
  new SlashCommandBuilder()
    .setName('настроить')
    .setDescription('Панель настроек кафе (для администраторов и выбранных ролей)')
    .setContexts(InteractionContextType.Guild),
].map((c) => c.toJSON());

client.once('ready', async (c) => {
  console.log('🚀 READY:', c.user.tag);
  
  await sendStatus(c, 'online');
  console.log('✅ sendStatus done');
  
  // Test command registration
  try {
    console.log('🔧 Clearing global commands...');
    await c.application.commands.set([]);
    console.log('✅ Global commands cleared');
  } catch (err) {
    console.error('❌ Clear global commands failed:', err.message);
  }

  for (const guild of c.guilds.cache.values()) {
    try {
      console.log(`🔧 Setting commands for guild: ${guild.name}`);
      const done = [...(await guild.commands.set(commands)).values()];
      console.log(`✅ Commands set for ${guild.name}:`, done.map(x => x.name).join(', '));
    } catch (err) {
      console.error(`❌ Failed to set commands for ${guild.name}:`, err.message);
    }
  }
  
  console.log('✅ All done!');
  process.exit(0);
});

client.on('error', e => console.error('Client error:', e));

console.log('Logging in...');
client.login(process.env.DISCORD_TOKEN).catch(e => {
  console.error('Login failed:', e);
  process.exit(1);
});

console.log('Login called');
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 30000);