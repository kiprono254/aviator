// Add this to the very top of your bot.js file
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Promise Rejection at:', promise, 'reason:', reason);
});

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const OWNER_NUMBER = '254713083698';

const basicLogger = {
  level: 'silent',
  info: (...args) => console.log('[INFO]', ...args),
  debug: (...args) => console.log('[DEBUG]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
  child: () => basicLogger
};

const client = new Client({
  authStrategy: new LocalAuth(),
  webVersionCache: {
    type: 'remote',
    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
  },
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ]
  },
  logger: basicLogger
});

const userOffenses = new Map();
let groupSettings = {};
const OFFENSE_WINDOW = 6 * 60 * 60 * 1000;

const defaultMessages = {
  welcome: "🎉 Welcome @user to the group! Feel free to introduce yourself.",
  goodbye: "👋 @user has left the group. We'll miss you!",
  left: "👋 @user has left the group. See you next time!"
};

const defaultForbiddenWords = ['fuck', 'bingwa', 'bingwa sokoni'];

try {
  if (fs.existsSync('group-settings.json')) {
    groupSettings = JSON.parse(fs.readFileSync('group-settings.json', 'utf8'));
  }
  if (fs.existsSync('user-offenses.json')) {
    const offensesData = JSON.parse(fs.readFileSync('user-offenses.json', 'utf8'));
    for (const [userId, data] of Object.entries(offensesData)) {
      userOffenses.set(userId, data);
    }
  }
} catch (error) {
  console.log('Error loading data files:', error);
}

function saveData() {
  try {
    fs.writeFileSync('group-settings.json', JSON.stringify(groupSettings, null, 2));
    const offensesObj = Object.fromEntries(userOffenses);
    fs.writeFileSync('user-offenses.json', JSON.stringify(offensesObj, null, 2));
  } catch (error) {
    console.log('Error saving data:', error);
  }
}

function getGroupSettings(groupId) {
  if (!groupSettings[groupId]) {
    groupSettings[groupId] = {
      forbiddenWords: [...defaultForbiddenWords],
      welcome: defaultMessages.welcome,
      goodbye: defaultMessages.goodbye,
      left: defaultMessages.left
    };
  }
  return groupSettings[groupId];
}

async function isOwner(message) {
  try {
    const contact = await message.getContact();
    const cleanContactNumber = contact.number.replace(/\D/g, '');
    const cleanOwnerNumber = OWNER_NUMBER.replace(/\D/g, '');
    
    if (cleanContactNumber.endsWith(cleanOwnerNumber)) {
      return true;
    }
    
    if (contact.id._serialized.includes(cleanOwnerNumber)) {
      return true;
    }
    
    return false;
  } catch (error) {
    console.log('Error checking owner status:', error);
    return false;
  }
}

async function isUserAdmin(chat, contactId) {
  try {
    if (!chat.isGroup) return false;
    
    await chat.fetchParticipants();
    const participants = chat.participants;
    
    const userParticipant = participants.find(p => {
      const matches = 
        p.id._serialized === contactId ||
        p.id.user === contactId.split('@')[0] ||
        p.id._serialized.includes(contactId.split('@')[0]);
      return matches;
    });
    
    return !!(userParticipant && userParticipant.isAdmin);
  } catch (error) {
    console.log('Error checking admin status:', error);
    return false;
  }
}

async function isOwnerOrAdmin(message) {
  try {
    const chat = await message.getChat();
    const isUserOwner = await isOwner(message);
    
    if (isUserOwner) return true;
    
    if (chat.isGroup) {
      const contact = await message.getContact();
      const isAdmin = await isUserAdmin(chat, contact.id._serialized);
      return isAdmin;
    }
    
    return false;
  } catch (error) {
    console.log('Error checking owner/admin status:', error);
    return false;
  }
}

function checkDependencies() {
  return new Promise((resolve) => {
    exec('which yt-dlp', (error) => {
      if (error) {
        console.log('❌ yt-dlp not installed. Download features will not work.');
      } else {
        console.log('✅ yt-dlp found - Download features ready!');
      }
      resolve();
    });
  });
}

function cleanOldOffenses(userId) {
  const now = Date.now();
  const userData = userOffenses.get(userId);
  if (userData && userData.timestamps) {
    userData.timestamps = userData.timestamps.filter(ts => now - ts < OFFENSE_WINDOW);
    userData.count = userData.timestamps.length;
    if (userData.count === 0) {
      userOffenses.delete(userId);
    } else {
      userOffenses.set(userId, userData);
    }
  }
}

// FIXED: Improved function to get random giveaway winner
async function getRandomGiveawayWinner(chat) {
  try {
    console.log('🔍 Fetching participants for giveaway...');
    
    // Ensure we have fresh participant data
    await chat.fetchParticipants();
    const participants = chat.participants;
    
    console.log(`📊 Total participants found: ${participants ? participants.length : 0}`);
    
    if (!participants || participants.length === 0) {
      console.log('❌ No participants found in chat.participants');
      return null;
    }

    // Filter out any invalid participants and the bot itself
    const eligibleParticipants = participants.filter(participant => {
      // Check if participant has valid ID structure
      if (!participant.id || !participant.id._serialized) {
        console.log('⚠️ Filtered participant with invalid ID:', participant);
        return false;
      }
      
      // Make sure it's a regular user (not a broadcast or other type)
      const isRegularUser = participant.id._serialized.includes('@c.us');
      
      if (!isRegularUser) {
        console.log('⚠️ Filtered non-regular user:', participant.id._serialized);
      }
      
      return isRegularUser;
    });

    console.log(`✅ Eligible participants after filtering: ${eligibleParticipants.length}`);
    
    if (eligibleParticipants.length === 0) {
      console.log('❌ No eligible participants after filtering');
      return null;
    }
    
    // Select random winner
    const randomIndex = Math.floor(Math.random() * eligibleParticipants.length);
    const winner = eligibleParticipants[randomIndex];
    
    console.log(`🎉 Selected winner: ${winner.id._serialized}`);
    return winner;
    
  } catch (error) {
    console.log('❌ Error in getRandomGiveawayWinner:', error);
    return null;
  }
}

client.on('qr', (qr) => {
  qrcode.generate(qr, { small: true });
  console.log('Scan QR code with WhatsApp > Linked Devices');
});

client.on('ready', async () => {
  console.log('✅ Bot is ready!');
  console.log('👤 Owner number configured:', OWNER_NUMBER);
  await checkDependencies();
  console.log('\n🤖 AVAILABLE COMMANDS:');
  console.log('👑 OWNER & ADMIN COMMANDS:');
  console.log('   .addword [word] - Add bad word to this group');
  console.log('   .removeword [word] - Remove bad word from this group');
  console.log('   .listwords - Show all bad words for this group');
  console.log('   .remove @mention - Remove user from group');
  console.log('   .setwelcome [message] - Set welcome message');
  console.log('   .setgoodbye [message] - Set goodbye message');
  console.log('   .setleft [message] - Set left message');
  console.log('   .checkoffenses @mention - Check user offenses');
  console.log('   .resetoffenses @mention - Reset user offenses');
  console.log('   .groupinfo - Show group settings');
  console.log('   .tagall - Tag all group members');
  console.log('   .giveaway - Pick a random member for giveaway');
  console.log('\n📥 PUBLIC DOWNLOAD COMMANDS:');
  console.log('   .yt [url] - Download YouTube video');
  console.log('   .fb [url] - Download Facebook video');
  console.log('   .tt [url] - Download TikTok video');
  console.log('   .audio [url] - Download audio from video');
  console.log('   .song [name] - Search and download song');
  console.log('   .video [name] - Search and download video');
  console.log('   .help - Show all commands');
});

client.on('group_join', async (notification) => {
  try {
    const chat = await notification.getChat();
    const contact = await notification.getContact();
    const settings = getGroupSettings(chat.id._serialized);
    const welcomeMessage = settings.welcome.replace('@user', `@${contact.number}`);
    await chat.sendMessage(welcomeMessage, { mentions: [contact] });
  } catch (error) {
    console.log('Error sending welcome message:', error);
  }
});

client.on('group_leave', async (notification) => {
  try {
    const chat = await notification.getChat();
    const contact = await notification.getContact();
    const settings = getGroupSettings(chat.id._serialized);
    const leaveMessage = settings.left.replace('@user', `@${contact.number}`);
    await chat.sendMessage(leaveMessage, { mentions: [contact] });
  } catch (error) {
    console.log('Error sending leave message:', error);
  }
});

async function downloadMedia(url, type = 'video') {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync('./downloads')) {
      fs.mkdirSync('./downloads');
    }
    const timestamp = Date.now();
    const outputPath = `./downloads/${timestamp}_%(title)s.%(ext)s`;
    let command;
    if (type === 'audio') {
      command = `yt-dlp -x --audio-format mp3 -o "${outputPath}" "${url}"`;
    } else {
      command = `yt-dlp -f "best[height<=720]" -o "${outputPath}" "${url}"`;
    }

    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(`Download failed: ${error.message}`);
        return;
      }
      const lines = stdout.split('\n');
      const downloadLine = lines.find(line => line.includes('[download] Destination:'));
      let filePath = '';
      if (downloadLine) {
        filePath = downloadLine.split('[download] Destination:')[1].trim();
      } else {
        const finishLine = lines.find(line => line.includes('[download]') && line.includes('has already been downloaded'));
        if (finishLine) {
          filePath = finishLine.split('[download]')[1].split('has already been downloaded')[0].trim();
        }
      }
      if (filePath && fs.existsSync(filePath)) {
        resolve(filePath);
      } else {
        reject('Could not find downloaded file');
      }
    });
  });
}

client.on('message', async (message) => {
  try {
    const chat = await message.getChat();
    const contact = await message.getContact();
    const isUserOwner = await isOwner(message);
    const isUserAdminOrOwner = await isOwnerOrAdmin(message);

    if (message.body === '.help') {
      const helpMessage = `📱 *BOT COMMANDS*

📥 *DOWNLOAD COMMANDS:*
• .yt [url] - Download YouTube video
• .fb [url] - Download Facebook video  
• .tt [url] - Download TikTok video
• .audio [url] - Extract audio from video
• .song [name] - Search and download song
• .video [name] - Search and download video

👑 *ADMIN COMMANDS (Group Only):*
• .tagall - Mention all group members
• .giveaway - Pick random member for giveaway
• .addword [word] - Add bad word
• .removeword [word] - Remove bad word
• .listwords - Show bad words
• .remove @user - Remove user
• .setwelcome [msg] - Set welcome message
• .setgoodbye [msg] - Set goodbye message  
• .setleft [msg] - Set left message
• .checkoffenses @user - Check offenses
• .resetoffenses @user - Reset offenses
• .groupinfo - Show group settings

⚙️ *OWNER ONLY (Anywhere):*
• All admin commands work everywhere

🔗 *Supported:* YouTube, Facebook, TikTok, Instagram, Twitter and 1000+ sites`;

      await message.reply(helpMessage);
      return;
    }

    if (message.body === '.test') {
      const statusMessage = `🔍 *Permission Test*

📞 Your number: ${contact.number}
👑 Owner status: ${isUserOwner ? '✅ YES' : '❌ NO'}
👑 Admin status: ${isUserAdminOrOwner ? '✅ YES' : '❌ NO'}
💬 Group chat: ${chat.isGroup ? '✅ YES' : '❌ NO'}

Owner number configured: ${OWNER_NUMBER}`;
      await message.reply(statusMessage);
      return;
    }

    if (isUserAdminOrOwner) {
      // FIXED: Giveaway command with better error handling
      if (message.body === '.giveaway') {
        if (chat.isGroup) {
          try {
            await message.reply('🎉 Starting giveaway selection...');
            
            const winner = await getRandomGiveawayWinner(chat);
            
            if (winner) {
              const giveawayMessages = [
                `🎊 *GIVEAWAY TIME!* 🎊\n\n🎉 Congratulations @${winner.id.user}! You are the lucky winner! 🎉\n\nPlease contact the admin to claim your prize! 🏆`,
                `🎁 *GIVEAWAY RESULT* 🎁\n\n✨ And the winner is... @${winner.id.user}! ✨\n\nCongratulations! 🥳 Claim your prize now!`,
                `🎯 *RANDOM SELECTION* 🎯\n\n🏆 Winner: @${winner.id.user}! 🏆\n\nYou've been selected randomly! Congratulations! 🎊`
              ];
              
              const randomMessage = giveawayMessages[Math.floor(Math.random() * giveawayMessages.length)];
              
              await chat.sendMessage(randomMessage, {
                mentions: [winner]
              });
            } else {
              await message.reply('❌ Could not find any eligible participants for the giveaway. Make sure there are members in the group.');
            }
          } catch (error) {
            console.log('Error in giveaway command:', error);
            await message.reply('❌ Error executing giveaway command: ' + error.message);
          }
        } else {
          await message.reply('❌ This command only works in groups.');
        }
        return;
      }

      // FIXED: Tagall command with better participant handling
      if (message.body === '.tagall') {
        if (chat.isGroup) {
          try {
            console.log('🔍 Starting tagall command...');
            
            // Refresh participants list
            await chat.fetchParticipants();
            const participants = chat.participants;
            
            console.log(`📊 Found ${participants.length} participants for tagall`);
            
            if (!participants || participants.length === 0) {
              await message.reply('❌ No participants found in this group.');
              return;
            }

            // Create mentions array properly
            const mentions = [];
            let mentionText = '';
            
            for (const participant of participants) {
              if (participant.id && participant.id._serialized) {
                mentionText += `@${participant.id.user} `;
                mentions.push(participant);
              }
            }

            if (mentions.length === 0) {
              await message.reply('❌ No valid participants to tag.');
              return;
            }

            console.log(`✅ Tagging ${mentions.length} participants`);
            
            await chat.sendMessage(`📢 Attention all members! ${mentionText}`, {
              mentions: mentions
            });
            
          } catch (error) {
            console.log('Error in tagall command:', error);
            await message.reply('❌ Error tagging members: ' + error.message);
          }
        } else {
          await message.reply('❌ This command only works in groups.');
        }
        return;
      }

      if (message.body === '.groupinfo') {
        if (chat.isGroup) {
          const settings = getGroupSettings(chat.id._serialized);
          const groupInfo = `🏷️ *Group Settings*

📝 *Bad Words:* ${settings.forbiddenWords.length} words
💬 *Welcome:* ${settings.welcome.substring(0, 50)}...
👋 *Goodbye:* ${settings.goodbye.substring(0, 50)}...
🚪 *Left:* ${settings.left.substring(0, 50)}...

Use .listwords to see all forbidden words`;
          await message.reply(groupInfo);
        } else {
          await message.reply('ℹ️ This command only works in groups.');
        }
        return;
      }

      if (message.body.startsWith('.addword ')) {
        if (chat.isGroup) {
          const newWord = message.body.split('.addword ')[1].toLowerCase().trim();
          const settings = getGroupSettings(chat.id._serialized);
          
          if (newWord && !settings.forbiddenWords.includes(newWord)) {
            settings.forbiddenWords.push(newWord);
            saveData();
            await message.reply(`✅ Added "${newWord}" to this group's forbidden words list.`);
          }
        } else {
          await message.reply('❌ This command only works in groups.');
        }
        return;
      }

      if (message.body.startsWith('.removeword ')) {
        if (chat.isGroup) {
          const wordToRemove = message.body.split('.removeword ')[1].toLowerCase().trim();
          const settings = getGroupSettings(chat.id._serialized);
          const index = settings.forbiddenWords.indexOf(wordToRemove);
          
          if (index > -1) {
            settings.forbiddenWords.splice(index, 1);
            saveData();
            await message.reply(`✅ Removed "${wordToRemove}" from this group's forbidden words list.`);
          } else {
            await message.reply(`❌ "${wordToRemove}" not found in this group's forbidden words list.`);
          }
        } else {
          await message.reply('❌ This command only works in groups.');
        }
        return;
      }

      if (message.body === '.listwords') {
        if (chat.isGroup) {
          const settings = getGroupSettings(chat.id._serialized);
          const wordList = settings.forbiddenWords.length > 0 
            ? `📝 *This group's forbidden words:*\n${settings.forbiddenWords.map(word => `• ${word}`).join('\n')}`
            : '📝 No forbidden words set for this group.';
          await message.reply(wordList);
        } else {
          await message.reply('❌ This command only works in groups.');
        }
        return;
      }

      if (message.body.startsWith('.remove ') && message.mentionedIds.length > 0) {
        if (chat.isGroup) {
          try {
            const userToRemove = message.mentionedIds[0];
            await chat.removeParticipants([userToRemove]);
            await message.reply('🚫 User removed by admin.');
          } catch (error) {
            await message.reply('❌ Failed to remove user. Make sure I have admin permissions.');
          }
        } else {
          await message.reply('❌ This command only works in groups.');
        }
        return;
      }

      if (message.body.startsWith('.checkoffenses ') && message.mentionedIds.length > 0) {
        const userId = message.mentionedIds[0];
        cleanOldOffenses(userId);
        const userData = userOffenses.get(userId);
        const offenseCount = userData ? userData.count : 0;
        await message.reply(`⚠️ User has ${offenseCount} offense(s) in the last 6 hours.`);
        return;
      }

      if (message.body.startsWith('.resetoffenses ') && message.mentionedIds.length > 0) {
        const userId = message.mentionedIds[0];
        userOffenses.delete(userId);
        saveData();
        await message.reply('✅ User offenses reset to 0.');
        return;
      }

      if (message.body.startsWith('.setwelcome ')) {
        if (chat.isGroup) {
          const newMessage = message.body.split('.setwelcome ')[1].trim();
          const settings = getGroupSettings(chat.id._serialized);
          settings.welcome = newMessage;
          saveData();
          await message.reply('✅ Welcome message updated for this group!');
        } else {
          await message.reply('❌ This command only works in groups.');
        }
        return;
      }

      if (message.body.startsWith('.setgoodbye ')) {
        if (chat.isGroup) {
          const newMessage = message.body.split('.setgoodbye ')[1].trim();
          const settings = getGroupSettings(chat.id._serialized);
          settings.goodbye = newMessage;
          saveData();
          await message.reply('✅ Goodbye message updated for this group!');
        } else {
          await message.reply('❌ This command only works in groups.');
        }
        return;
      }

      if (message.body.startsWith('.setleft ')) {
        if (chat.isGroup) {
          const newMessage = message.body.split('.setleft ')[1].trim();
          const settings = getGroupSettings(chat.id._serialized);
          settings.left = newMessage;
          saveData();
          await message.reply('✅ Left message updated for this group!');
        } else {
          await message.reply('❌ This command only works in groups.');
        }
        return;
      }
    } else {
      const adminCommands = ['.addword', '.removeword', '.listwords', '.remove', '.setwelcome', '.setgoodbye', '.setleft', '.checkoffenses', '.resetoffenses', '.groupinfo', '.tagall', '.giveaway'];
      const isAdminCommand = adminCommands.some(cmd => message.body.startsWith(cmd));
      
      if (isAdminCommand) {
        await message.reply('❌ This command is only available to group admins or the bot owner.');
        return;
      }
    }

    if (message.body.startsWith('.yt ') || message.body.startsWith('.youtube ')) {
      const url = message.body.split(' ')[1];
      if (!url) {
        await message.reply('❌ Please provide a URL. Example: .yt https://youtube.com/watch?v=xxx');
        return;
      }
      await message.reply('📥 Downloading YouTube video... Please wait ⏳');
      try {
        const filePath = await downloadMedia(url, 'video');
        const media = MessageMedia.fromFilePath(filePath);
        await message.reply(media);
        fs.unlinkSync(filePath);
      } catch (error) {
        await message.reply(`❌ Download failed: ${error}`);
      }
      return;
    }

    if (message.body.startsWith('.fb ') || message.body.startsWith('.facebook ')) {
      const url = message.body.split(' ')[1];
      if (!url) {
        await message.reply('❌ Please provide a URL. Example: .fb https://facebook.com/watch/xxx');
        return;
      }
      await message.reply('📥 Downloading Facebook video... Please wait ⏳');
      try {
        const filePath = await downloadMedia(url, 'video');
        const media = MessageMedia.fromFilePath(filePath);
        await message.reply(media);
        fs.unlinkSync(filePath);
      } catch (error) {
        await message.reply(`❌ Download failed: ${error}`);
      }
      return;
    }

    if (message.body.startsWith('.tt ') || message.body.startsWith('.tiktok ')) {
      const url = message.body.split(' ')[1];
      if (!url) {
        await message.reply('❌ Please provide a URL. Example: .tt https://tiktok.com/@user/video/xxx');
        return;
      }
      await message.reply('📥 Downloading TikTok video... Please wait ⏳');
      try {
        const filePath = await downloadMedia(url, 'video');
        const media = MessageMedia.fromFilePath(filePath);
        await message.reply(media);
        fs.unlinkSync(filePath);
      } catch (error) {
        await message.reply(`❌ Download failed: ${error}`);
      }
      return;
    }

    if (message.body.startsWith('.audio ')) {
      const url = message.body.split('.audio ')[1].trim();
      if (!url) {
        await message.reply('❌ Please provide a URL. Example: .audio https://youtube.com/watch?v=xxx');
        return;
      }
      await message.reply('🎵 Extracting audio... Please wait ⏳');
      try {
        const filePath = await downloadMedia(url, 'audio');
        const media = MessageMedia.fromFilePath(filePath);
        await message.reply(media);
        fs.unlinkSync(filePath);
      } catch (error) {
        await message.reply(`❌ Audio extraction failed: ${error}`);
      }
      return;
    }

    if (message.body.startsWith('.song ')) {
      const query = message.body.split('.song ')[1].trim();
      if (!query) {
        await message.reply('❌ Please provide a song name. Example: .song love me like you do');
        return;
      }
      await message.reply(`🎵 Searching for "${query}"... Please wait ⏳`);
      try {
        const searchUrl = `ytsearch1:${query}`;
        const filePath = await downloadMedia(searchUrl, 'audio');
        const media = MessageMedia.fromFilePath(filePath);
        await message.reply(media);
        fs.unlinkSync(filePath);
      } catch (error) {
        await message.reply(`❌ Song download failed: ${error}`);
      }
      return;
    }

    if (message.body.startsWith('.video ')) {
      const query = message.body.split('.video ')[1].trim();
      if (!query) {
        await message.reply('❌ Please provide a video name. Example: .video funny cats');
        return;
      }
      await message.reply(`🎥 Searching for "${query}"... Please wait ⏳`);
      try {
        const searchUrl = `ytsearch1:${query}`;
        const filePath = await downloadMedia(searchUrl, 'video');
        const media = MessageMedia.fromFilePath(filePath);
        await message.reply(media);
        fs.unlinkSync(filePath);
      } catch (error) {
        await message.reply(`❌ Video download failed: ${error}`);
      }
      return;
    }

    if (chat.isGroup) {
      const messageText = message.body.toLowerCase();
      const settings = getGroupSettings(chat.id._serialized);
      const hasForbiddenWord = settings.forbiddenWords.some(word => messageText.includes(word));
      
      if (hasForbiddenWord) {
        const userId = contact.id._serialized;
        const now = Date.now();
        cleanOldOffenses(userId);
        let userData = userOffenses.get(userId) || { count: 0, timestamps: [] };
        userData.timestamps.push(now);
        userData.count = userData.timestamps.length;
        userOffenses.set(userId, userData);
        saveData();
        
        if (userData.count === 1) {
          console.log(`User ${contact.number} - 1st offense (silent)`);
        } else if (userData.count === 2) {
          await message.reply(`⚠️ *First Warning!* Please avoid using inappropriate language. Next violation within 6 hours will result in removal.`);
        } else if (userData.count >= 3) {
          try {
            await chat.removeParticipants([userId]);
            await message.reply(`🚫 User @${contact.number} has been removed for multiple violations within 6 hours.`);
            userOffenses.delete(userId);
            saveData();
          } catch (removeError) {
            await message.reply('❌ I need admin privileges to remove users.');
          }
        }
      }
    }
  } catch (error) {
    console.error('Error:', error);
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [userId, userData] of userOffenses.entries()) {
    const validTimestamps = userData.timestamps.filter(ts => now - ts < OFFENSE_WINDOW);
    if (validTimestamps.length === 0) {
      userOffenses.delete(userId);
    } else if (validTimestamps.length !== userData.timestamps.length) {
      userData.timestamps = validTimestamps;
      userData.count = validTimestamps.length;
      userOffenses.set(userId, userData);
    }
  }
  saveData();
}, 30 * 60 * 1000);

client.initialize();
