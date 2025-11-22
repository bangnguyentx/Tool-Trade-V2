require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const moment = require('moment-timezone');
const express = require('express');
const { analyzeSymbol } = require('./analysis');

// --- CẤU HÌNH ---
const token = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN_HERE'; 

// --- CẤU HÌNH BOT CHỐNG LỖI POLLING ---
const bot = new TelegramBot(token, { 
    polling: {
        interval: 300,
        autoStart: true,
        params: {
            timeout: 10
        }
    }
});

// Bắt lỗi polling để không bị crash app
bot.on("polling_error", (err) => {
    if (err.code !== 'EFATAL') {
        console.log(`[Polling Error] ${err.code}: ${err.message}`);
    }
});

const app = express();
const PORT = process.env.PORT || 3000;

// TARGET_COINS TỐI ƯU - 60 COIN VOLATILITY CAO
const TARGET_COINS = [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
    'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'TRXUSDT', 'LINKUSDT',
    'MATICUSDT', 'LTCUSDT', 'ATOMUSDT', 'ETCUSDT', 'XLMUSDT',
    'BCHUSDT', 'FILUSDT', 'ALGOUSDT', 'NEARUSDT', 'UNIUSDT',
    'DOGEUSDT', 'ZECUSDT', '1000PEPEUSDT', 'ZENUSDT', 'HYPEUSDT',
    'WIFUSDT', 'MEMEUSDT', 'BOMEUSDT', 'POPCATUSDT', 'MYROUSDT',
    'DOGUSDT', 'TOSHIUSDT', 'MOGUSDT', 'TURBOUSDT', 'NFPUSDT',
    'PEOPLEUSDT', 'ARCUSDT', 'BTCDOMUSDT', 'TRUMPUSDT', 'DASHUSDT',
    'APTUSDT', 'ARBUSDT', 'OPUSDT', 'SUIUSDT', 'SEIUSDT',
    'TIAUSDT', 'INJUSDT', 'RNDRUSDT', 'FETUSDT', 'AGIXUSDT',
    'OCEANUSDT', 'JASMYUSDT', 'GALAUSDT', 'SANDUSDT', 'MANAUSDT',
    'ENJUSDT', 'CHZUSDT', 'APEUSDT', 'GMTUSDT', 'LDOUSDT'
];

// --- HỆ THỐNG ADMIN & KEY ---
const ADMIN_IDS = ['7760459637']; // Thay bằng username admin thực tế
const activationKeys = new Map(); // Lưu trữ keys: {type, created, expires, used, usedBy}
const subscribedUsers = new Map(); // Users đã kích hoạt: {userInfo, activatedAt, keyUsed}

// --- BIẾN TRẠNG THÁI ---
let signalCountToday = 0;
let isAutoAnalysisRunning = false;

// --- SERVER EXPRESS (KEEP-ALIVE) ---
app.get('/', (req, res) => {
    res.json({ 
        status: 'AI Trading Bot V3 is Running...',
        subscribedUsers: subscribedUsers.size,
        lastSignalCount: signalCountToday
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        uptime: process.uptime(),
        users: subscribedUsers.size,
        signals: signalCountToday
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});

// --- CÁC HÀM TIỆN ÍCH ---

// --- CÁC HÀM TIỆN ÍCH ---

function getVietnamTime() {
    return moment().tz("Asia/Ho_Chi_Minh");
}

function isAdmin(user) {
    return ADMIN_IDS.includes(user.id.toString());
}

function generateKey(length = 16) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function calculateKeyExpiry(type) {
    const now = new Date();
    switch (type) {
        case '1week':
            return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        case '1month':
            return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        case '3month':
            return new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
        case 'forever':
            return null;
        default:
            return null;
    }
}

function formatSignalMessage(data, signalIndex, source = 'bot') {
    const icon = data.direction === 'LONG' ? '🟢' : '🔴';
    
    const fmt = (num) => {
        if (num === undefined || num === null) return 'N/A';
        const number = parseFloat(num);
        if (isNaN(number)) return 'N/A';
        return number > 10 ? number.toFixed(2) : number.toFixed(4);
    };

    const baseMessage = `🤖 Tín hiệu [${signalIndex} trong ngày]
#${data.symbol.replace('USDT', '')} – [${data.direction}] 📌

${icon} Entry: ${fmt(data.entry)}
🆗 Take Profit: ${fmt(data.tp)}
🙅‍♂️ Stop-Loss: ${fmt(data.sl)}
🪙 Tỉ lệ RR: ${data.rr} (Conf: ${data.confidence}%)`;

    const riskWarning = `\n\n🧠 By Tool Bot 

⚠️ Nhất định phải tuân thủ quản lý rủi ro – Đi tối đa 2-3% risk, Bot chỉ để tham khảo, win 3 lệnh nên ngưng`;

    return baseMessage + riskWarning;
}

// Hàm broadcast với retry mechanism
async function broadcastToAllUsers(message) {
    let successCount = 0;
    let failCount = 0;
    
    for (const [chatId, userData] of subscribedUsers) {
        let retryCount = 0;
        const maxRetries = 3;
        let sent = false;

        while (retryCount < maxRetries && !sent) {
            try {
                await bot.sendMessage(chatId, message);
                successCount++;
                sent = true;
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (err) {
                retryCount++;
                console.log(`❌ Lỗi gửi cho ${userData.userInfo.username || userData.userInfo.first_name} (lần ${retryCount}):`, err.message);
                
                if (retryCount >= maxRetries) {
                    failCount++;
                    if (err.response && err.response.statusCode === 403) {
                        subscribedUsers.delete(chatId);
                        console.log(`🗑️ Đã xóa user bị chặn: ${userData.userInfo.username || userData.userInfo.first_name}`);
                    }
                } else {
                    await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                }
            }
        }
    }
    
    console.log(`📤 Broadcast: ${successCount} thành công, ${failCount} thất bại`);
    return { success: successCount, fail: failCount };
}

// --- AUTO ANALYSIS ---

async function runAutoAnalysis() {
    if (isAutoAnalysisRunning) {
        console.log('⏳ Auto analysis đang chạy, bỏ qua...');
        return;
    }

    const now = getVietnamTime();
    const currentHour = now.hours();
    const currentMinute = now.minutes();

    if (currentHour < 4 || (currentHour === 23 && currentMinute > 30)) {
        console.log('💤 Out of operating hours (04:00 - 23:30). Sleeping...');
        return;
    }

    if (subscribedUsers.size === 0) {
        console.log('👥 No subscribed users. Skipping auto analysis.');
        return;
    }

    isAutoAnalysisRunning = true;
    console.log(`🔄 Starting Auto Analysis at ${now.format('HH:mm')} - ${subscribedUsers.size} users`);
    
    let signalsFound = 0;
    
    try {
        for (const coin of TARGET_COINS) {
            await new Promise(r => setTimeout(r, 1500));

            try {
                console.log(`🔍 Analyzing ${coin}...`);
                const result = await analyzeSymbol(coin);
                
                if (result && result.direction !== 'NEUTRAL' && result.direction !== 'NO_TRADE') {
                    if (result.confidence >= 60 && result.confidence <= 100) {
                        signalCountToday++;
                        signalsFound++;
                        const msg = formatSignalMessage(result, signalCountToday, 'bot');
                        
                        console.log(`✅ Signal found: ${coin} ${result.direction} (${result.confidence}%)`);
                        await broadcastToAllUsers(msg);
                        
                        await new Promise(r => setTimeout(r, 2000));
                    } else {
                        console.log(`⏭️ Skip ${coin}: Confidence ${result.confidence}% (need 60-100%)`);
                    }
                } else {
                    console.log(`➖ No signal for ${coin}: ${result?.direction}`);
                }
            } catch (coinError) {
                console.error(`❌ Error analyzing ${coin}:`, coinError.message);
                continue;
            }
        }
        
        console.log(`🎯 Auto analysis completed. Found ${signalsFound} signals`);
        
    } catch (error) {
        console.error('💥 Critical error in auto analysis:', error);
    } finally {
        isAutoAnalysisRunning = false;
    }
}

// Gửi lời chào mỗi ngày mới
function checkDailyGreeting() {
    const now = getVietnamTime();
    if (now.hours() === 4 && now.minutes() === 0) {
        signalCountToday = 0;
        const greetingMsg = "🌞 Chào ngày mới các nhà giao dịch! AI Trading Bot V3 đã sẵn sàng săn tìm cơ hội. Chúc mọi người Big Win! 🚀";
        broadcastToAllUsers(greetingMsg);
        console.log('🌞 Đã gửi lời chào buổi sáng');
    }
}

// --- BOT COMMANDS ---

// /start - ĐĂNG KÝ NHẬN TIN NHẮN
// /start - ĐĂNG KÝ NHẬN TIN NHẮN
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const user = msg.from;
    
    const userInfo = {
        id: user.id,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name
    };

    // Kiểm tra nếu là admin
    if (isAdmin(user)) {
        const adminData = {
            userInfo: userInfo,
            activatedAt: new Date(),
            isAdmin: true
        };
        
        subscribedUsers.set(chatId, adminData);
        
        const welcomeMsg = `👋 Chào Admin ${user.first_name || ''}!\n🧠 ĐÂY LÀ TOOL AI TRADING V3.\n\nBạn đã được kích hoạt quyền admin tự động!`;

        const opts = {
            reply_markup: {
                keyboard: [
                    ['📤 Gửi tín hiệu', '🔍 Analyze Symbol'],
                    ['📊 Trạng thái bot', '🔑 Tạo mã code'],
                    ['🔎 Analyze Allcoin']
                ],
                resize_keyboard: true,
                one_time_keyboard: false
            }
        };

        bot.sendMessage(chatId, welcomeMsg, opts);
        console.log(`✅ Admin subscribed: ${user.username || user.first_name} (ID: ${user.id})`);
    } else {
        // User thường - chỉ gửi lời chào
        const welcomeMsg = `👋 Chào ${user.first_name || 'Trader'}!\n🧠 ĐÂY LÀ TOOL AI TRADING V3.\n\n🔐 Bạn cần kích hoạt bằng mã code để sử dụng đầy đủ tính năng.\n\n📝 Sử dụng lệnh: /key <mã_code>`;
        bot.sendMessage(chatId, welcomeMsg);
    }
});

// /key - KÍCH HOẠT USER
bot.onText(/\/key (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const user = msg.from;
    const key = match[1].trim();

    // Kiểm tra key
    const keyInfo = activationKeys.get(key);
    if (!keyInfo) {
        return bot.sendMessage(chatId, '❌ Mã kích hoạt không tồn tại!');
    }

    if (keyInfo.used) {
        return bot.sendMessage(chatId, '❌ Mã kích hoạt đã được sử dụng!');
    }

    // Kiểm tra hạn sử dụng
    if (keyInfo.expires && new Date() > keyInfo.expires) {
        return bot.sendMessage(chatId, '❌ Mã kích hoạt đã hết hạn!');
    }

    // Kích hoạt key
    keyInfo.used = true;
    keyInfo.usedBy = user.id;
    activationKeys.set(key, keyInfo);

    // Thêm user vào danh sách
    const userData = {
        userInfo: {
            id: user.id,
            username: user.username,
            first_name: user.first_name,
            last_name: user.last_name
        },
        activatedAt: new Date(),
        keyUsed: key,
        isAdmin: false
    };
    subscribedUsers.set(chatId, userData);

    const opts = {
        reply_markup: {
            keyboard: [
                ['📤 Gửi tín hiệu'],
                ['🔍 Analyze Symbol']
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    };

    bot.sendMessage(chatId, `✅ Kích hoạt thành công! Chào mừng bạn đến với AI Trading Bot V3.`, opts);
    console.log(`✅ User activated: ${user.username || user.first_name} với key: ${key}`);
});

// /createkey - TẠO MÃ KÍCH HOẠT (ADMIN ONLY)
bot.onText(/\/createkey (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const user = msg.from;

    if (!isAdmin(user)) {
        return bot.sendMessage(chatId, '❌ Bạn không có quyền sử dụng lệnh này!');
    }

    const type = match[1].trim();
    const validTypes = ['1week', '1month', '3month', 'forever'];
    if (!validTypes.includes(type)) {
        return bot.sendMessage(chatId, `❌ Loại key không hợp lệ! Các loại: ${validTypes.join(', ')}`);
    }

    const key = generateKey();
    const expires = calculateKeyExpiry(type);

    activationKeys.set(key, {
        type: type,
        created: new Date(),
        expires: expires,
        used: false,
        usedBy: null
    });

    const expiryText = expires ? moment(expires).format('DD/MM/YYYY HH:mm') : 'Vĩnh viễn';
    
    bot.sendMessage(chatId, 
        `✅ Đã tạo key thành công!\n\n` +
        `🔑 Key: <code>${key}</code>\n` +
        `⏰ Loại: ${type}\n` +
        `📅 Hết hạn: ${expiryText}\n\n` +
        `Gửi key này cho user để họ kích hoạt bằng lệnh: /key ${key}`,
        { parse_mode: 'HTML' }
    );
});

// Xử lý Menu Button
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const userData = subscribedUsers.get(chatId);

    if (!userData) {
        if (text.startsWith('/key')) return;
        return bot.sendMessage(chatId, '🔐 Vui lòng kích hoạt bot bằng lệnh /key <mã_code> trước!');
    }

    const user = userData.userInfo;
    const isAdminUser = userData.isAdmin;

    // Xử lý nút Menu
    if (text === '📤 Gửi tín hiệu') {
        const helpMsg = `Để gửi tín hiệu đến cộng đồng, hãy nhập theo cú pháp:\n\n` +
                       `🔹 <b>Ví dụ 1:</b> <code>/signal BTCUSDT LONG 50000 49000 52000</code>\n` +
                       `🔹 <b>Ví dụ 2:</b> <code>/signal ETHUSDT SHORT 2500 2550 2400</code>\n\n` +
                       `📝 <b>Format:</b> /signal [SYMBOL] [LONG/SHORT] [ENTRY] [STOPLOSS] [TAKEPROFIT]`;
        
        bot.sendMessage(chatId, helpMsg, { parse_mode: 'HTML' });
        
    } else if (text === '🔍 Analyze Symbol') {
        const helpMsg = isAdminUser ? 
            'Để phân tích coin, nhập:\n<code>/analyzesymbol BTCUSDT</code>\n\nHoặc phân tích tất cả coin:\n<code>/analyzesymbol Allcoin</code>' :
            'Để phân tích coin, nhập:\n<code>/analyzesymbol BTCUSDT</code>';
        bot.sendMessage(chatId, helpMsg, { parse_mode: 'HTML' });
        
    } else if (text === '📊 Trạng thái bot' && isAdminUser) {
        const statusMsg = `🤖 <b>TRẠNG THÁI BOT</b>\n\n` +
                         `👥 Users đã kích hoạt: <b>${subscribedUsers.size}</b>\n` +
                         `📈 Tín hiệu hôm nay: <b>${signalCountToday}</b>\n` +
                         `⏰ Giờ hoạt động: <b>04:00 - 23:30</b>\n` +
                         `🔄 Chu kỳ quét: <b>2 giờ/lần</b>\n` +
                         `🎯 Ngưỡng tin cậy: <b>60-100%</b>`;
        
        bot.sendMessage(chatId, statusMsg, { parse_mode: 'HTML' });
        
    } else if (text === '🔑 Tạo mã code' && isAdminUser) {
        const helpMsg = `Để tạo mã kích hoạt, sử dụng lệnh:\n\n` +
                       `<code>/createkey 1week</code>\n` +
                       `<code>/createkey 1month</code>\n` +
                       `<code>/createkey 3month</code>\n` +
                       `<code>/createkey forever</code>`;
        bot.sendMessage(chatId, helpMsg, { parse_mode: 'HTML' });
        
    } else if (text === '🔎 Analyze Allcoin' && isAdminUser) {
        bot.sendMessage(chatId, 'Đang phân tích toàn bộ 60 coin...');
        analyzeAllCoins(chatId);
    }

    // Xử lý lệnh gửi tín hiệu
    if (text.startsWith('/signal')) {
        const parts = text.split(' ');
        if (parts.length < 6) {
            return bot.sendMessage(chatId, 
                '❌ <b>Sai format!</b>\n\n' +
                '✅ <b>Đúng format:</b> <code>/signal SYMBOL LONG/SHORT ENTRY STOPLOSS TAKEPROFIT</code>\n\n' +
                '📝 <b>Ví dụ:</b> <code>/signal BTCUSDT LONG 50000 49000 52000</code>', 
                { parse_mode: 'HTML' }
            );
        }

        const symbol = parts[1].toUpperCase();
        const direction = parts[2].toUpperCase();
        const entry = parts[3];
        const sl = parts[4];
        const tp = parts[5];

        if (!['LONG', 'SHORT'].includes(direction)) {
            return bot.sendMessage(chatId, '❌ Direction phải là LONG hoặc SHORT');
        }

        if (isNaN(entry) || isNaN(sl) || isNaN(tp)) {
            return bot.sendMessage(chatId, '❌ Entry, SL, TP phải là số');
        }

        const rr = (Math.abs(tp - entry) / Math.abs(entry - sl)).toFixed(2);
        const userName = isAdminUser ? 'Admin' : (user.username ? `@${user.username}` : user.first_name);

        signalCountToday++;
        const userSignalMsg = `🤖 Tín hiệu [${signalCountToday} trong ngày]\n` +
                             `#${symbol.replace('USDT', '')} – [${direction}] 📌\n\n` +
                             `🟢 Entry: ${parseFloat(entry).toFixed(2)}\n` +
                             `🆗 Take Profit: ${parseFloat(tp).toFixed(2)}\n` +
                             `🙅‍♂️ Stop-Loss: ${parseFloat(sl).toFixed(2)}\n` +
                             `🪙 Tỉ lệ RR: ${rr}\n\n` +
                             `🧠 Shared by ${userName}\n\n` +
                             `⚠️ Nhất định phải tuân thủ quản lý rủi ro – Đi tối đa 1-2% risk\n🤖 Tín hiệu từ thành viên, tự verify lại`;

        const broadcastResult = await broadcastToAllUsers(userSignalMsg);
        bot.sendMessage(chatId, 
            `✅ Đã gửi tín hiệu đến ${broadcastResult.success} thành viên!\n` +
            `❌ ${broadcastResult.fail} gửi thất bại`
        );
    }
});

// /analyzesymbol [Coin]
bot.onText(/\/analyzesymbol (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userData = subscribedUsers.get(chatId);
    
    if (!userData) {
        return bot.sendMessage(chatId, 'Vui lòng kích hoạt bot trước bằng lệnh /key!');
    }

    let symbol = match[1].toUpperCase().trim();
    
    // Kiểm tra nếu là Allcoin (chỉ admin)
    if (symbol === 'ALLCOIN') {
        if (!userData.isAdmin) {
            return bot.sendMessage(chatId, '❌ Chỉ admin mới có quyền phân tích toàn bộ coin!');
        }
        return analyzeAllCoins(chatId);
    }
    
    // Phân tích coin cụ thể
    if (!symbol.endsWith('USDT')) symbol += 'USDT';

    const processingMsg = await bot.sendMessage(chatId, `⏳ Đang phân tích ${symbol}...\n📊 Loading multi-timeframe analysis`);

    try {
        const result = await analyzeSymbol(symbol);

        if (result && result.direction !== 'NEUTRAL' && result.direction !== 'NO_TRADE') {
            bot.deleteMessage(chatId, processingMsg.message_id);
            
            let advice = "";
            if (result.confidence < 60) {
                advice = "\n\n⚠️ <b>Cảnh báo:</b> Confidence Score thấp (<60%), rủi ro cao - KHÔNG NÊN GIAO DỊCH";
            } else if (result.confidence >= 80) {
                advice = "\n\n✅ <b>Tin cậy cao</b> - Có thể xem xét giao dịch";
            } else {
                advice = "\n\n🟡 <b>Tin cậy trung bình</b> - Cẩn thận quản lý rủi ro";
            }
            
            const msgContent = formatSignalMessage(result, "MANUAL") + advice;
            bot.sendMessage(chatId, msgContent, { parse_mode: 'HTML' });
        } else {
            bot.editMessageText(
                `❌ Không tìm thấy tín hiệu giao dịch cho ${symbol}\n` +
                `📉 Market: ${result?.direction || 'NEUTRAL'}\n` +
                `🎯 Confidence: ${result?.confidence || 0}%`,
                { chat_id: chatId, message_id: processingMsg.message_id }
            );
        }
    } catch (error) {
        bot.editMessageText(
            `❌ Lỗi khi phân tích ${symbol}: ${error.message}`,
            { chat_id: chatId, message_id: processingMsg.message_id }
        );
    }
});

// Hàm phân tích toàn bộ coin (chỉ admin)
async function analyzeAllCoins(chatId) {
    const processingMsg = await bot.sendMessage(chatId, `⏳ Đang phân tích toàn bộ 60 coin...\n📊 This may take 3-5 minutes`);

    let signalsFound = 0;
    let analysisResults = [];

    try {
        for (let i = 0; i < TARGET_COINS.length; i++) {
            const coin = TARGET_COINS[i];
            
            // Update progress
            if (i % 10 === 0) {
                const progress = Math.round((i / TARGET_COINS.length) * 100);
                bot.editMessageText(
                    `⏳ Đang phân tích toàn bộ 60 coin...\n📊 Progress: ${progress}% (${i}/${TARGET_COINS.length})`,
                    { chat_id: chatId, message_id: processingMsg.message_id }
                );
            }

            await new Promise(r => setTimeout(r, 2000)); // Delay 2 giây mỗi coin

            try {
                const result = await analyzeSymbol(coin);
                if (result && result.direction !== 'NEUTRAL' && result.direction !== 'NO_TRADE' && result.confidence >= 60) {
                    signalsFound++;
                    analysisResults.push(result);
                }
            } catch (error) {
                console.error(`Error analyzing ${coin}:`, error.message);
            }
        }

        bot.deleteMessage(chatId, processingMsg.message_id);

        if (analysisResults.length > 0) {
            let response = `🔍 <b>KẾT QUẢ PHÂN TÍCH TOÀN BỘ COIN</b>\n` +
                          `📈 Tìm thấy: <b>${signalsFound}</b> tín hiệu\n\n`;
            
            // Chỉ hiển thị tối đa 10 tín hiệu tốt nhất
            const bestSignals = analysisResults
                .sort((a, b) => b.confidence - a.confidence)
                .slice(0, 10);
            
            for (const result of bestSignals) {
                response += `🎯 <b>${result.symbol.replace('USDT', '')}</b> - ${result.direction} (${result.confidence}%)\n`;
                response += `📍 Entry: ${result.entry} | SL: ${result.sl} | TP: ${result.tp}\n\n`;
            }
            
            if (signalsFound > 10) {
                response += `... và ${signalsFound - 10} tín hiệu khác`;
            }
            
            bot.sendMessage(chatId, response, { parse_mode: 'HTML' });
        } else {
            bot.sendMessage(chatId, '❌ Không tìm thấy tín hiệu nào trong 60 coin (Confidence ≥ 60%).');
        }
    } catch (error) {
        bot.editMessageText(
            `❌ Lỗi khi phân tích toàn bộ coin: ${error.message}`,
            { chat_id: chatId, message_id: processingMsg.message_id }
        );
    }
}

// Lệnh /users để xem số lượng users (chỉ admin)
bot.onText(/\/users/, (msg) => {
    const chatId = msg.chat.id;
    const userData = subscribedUsers.get(chatId);
    
    if (!userData || !userData.isAdmin) {
        return bot.sendMessage(chatId, '❌ Bạn không có quyền sử dụng lệnh này');
    }
    
    let userList = `📊 <b>DANH SÁCH USERS ĐÃ KÍCH HOẠT</b> (${subscribedUsers.size} users)\n\n`;
    subscribedUsers.forEach((userData, id) => {
        const user = userData.userInfo;
        userList += `👤 ${user.username ? `@${user.username}` : user.first_name} - ${moment(userData.activatedAt).format('DD/MM HH:mm')}${userData.isAdmin ? ' 👑' : ''}\n`;
    });
    
    bot.sendMessage(chatId, userList, { parse_mode: 'HTML' });
});

// Thiết lập Interval
const ANALYSIS_INTERVAL = 2 * 60 * 60 * 1000;
setInterval(runAutoAnalysis, ANALYSIS_INTERVAL);
setInterval(checkDailyGreeting, 60 * 1000);
setTimeout(() => { runAutoAnalysis(); }, 10000);

console.log('🤖 Bot is running with improved polling...');
console.log(`⏰ Auto analysis every 2 hours (04:00 - 23:30)`);
console.log(`🎯 Min confidence: 60% | Target coins: ${TARGET_COINS.length}`);
console.log(`👑 Admin: ${ADMIN_IDS.join(', ')}`);
