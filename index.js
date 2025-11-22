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
        interval: 300,      // Chờ 300ms giữa các lần polling để đỡ spam server
        autoStart: true,
        params: {
            timeout: 10     // Timeout ngắn để tránh treo kết nối
        }
    }
});

// Bắt lỗi polling để không bị crash app
bot.on("polling_error", (err) => {
    // Chỉ in ra lỗi nếu không phải lỗi EFATAL (hoặc in rút gọn để đỡ rác log)
    if (err.code !== 'EFATAL') {
        console.log(`[Polling Error] ${err.code}: ${err.message}`);
    } else {
        // Lỗi mạng tạm thời, bỏ qua không làm gì cả
        // console.log("Connection jitter, reconnecting..."); 
    }
});

const app = express();
const PORT = process.env.PORT || 3000;

// TARGET_COINS TỐI ƯU - 60 COIN VOLATILITY CAO
const TARGET_COINS = [
    // === TOP 20 CAP LỚN (Stable) ===
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
    'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'TRXUSDT', 'LINKUSDT',
    'MATICUSDT', 'LTCUSDT', 'ATOMUSDT', 'ETCUSDT', 'XLMUSDT',
    'BCHUSDT', 'FILUSDT', 'ALGOUSDT', 'NEARUSDT', 'UNIUSDT',
    
    // === TOP 20 MEME/VOLATILE (Nhiều tín hiệu) ===
    'DOGEUSDT', 'ZECUSDT', '1000PEPEUSDT', 'ZENUSDT', 'HYPEUSDT',
    'WIFUSDT', 'MEMEUSDT', 'BOMEUSDT', 'POPCATUSDT', 'MYROUSDT',
    'DOGUSDT', 'TOSHIUSDT', 'MOGUSDT', 'TURBOUSDT', 'NFPUSDT',
    ' PEOPLEUSDT', 'ARC', 'BTCDOM', 'TRUMPUSDT', 'DASHUSDT',
    
    // === TOP 20 ALTCOIN TRENDING ===
    'APTUSDT', 'ARBUSDT', 'OPUSDT', 'SUIUSDT', 'SEIUSDT',
    'TIAUSDT', 'INJUSDT', 'RNDRUSDT', 'FETUSDT', 'AGIXUSDT',
    'OCEANUSDT', 'JASMYUSDT', 'GALAUSDT', 'SANDUSDT', 'MANAUSDT',
    'ENJUSDT', 'CHZUSDT', 'APEUSDT', 'GMTUSDT', 'LDOUSDT'
];

// --- BIẾN TRẠNG THÁI ---
// Lưu trữ tất cả users đã ấn start để gửi tin nhắn broadcast
const subscribedUsers = new Map(); // key: chatId, value: userInfo
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

function getVietnamTime() {
    return moment().tz("Asia/Ho_Chi_Minh");
}

function formatSignalMessage(data, signalIndex, source = 'bot') {
    const icon = data.direction === 'LONG' ? '🟢' : '🔴';
    
    // Định dạng số thập phân thông minh (Có xử lý lỗi)
    const fmt = (num) => {
        if (num === undefined || num === null) return 'N/A'; // Bảo vệ chống lỗi
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

// Hàm broadcast tin nhắn đến tất cả users
async function broadcastToAllUsers(message) {
    let successCount = 0;
    let failCount = 0;
    
    for (const [chatId, user] of subscribedUsers) {
        try {
            await bot.sendMessage(chatId, message);
            successCount++;
            // Thêm delay để tránh spam Telegram API
            await new Promise(resolve => setTimeout(resolve, 100));
        } catch (err) {
            console.log(`❌ Lỗi gửi cho ${user.username || user.first_name}:`, err.code, err.message);
            failCount++;
            
            // Xử lý các loại lỗi cụ thể
            if (err.response && err.response.statusCode === 403) {
                subscribedUsers.delete(chatId);
                console.log(`🗑️ Đã xóa user bị chặn: ${user.username || user.first_name}`);
            } else if (err.code === 'EFATAL' || err.code === 'ETELEGRAM') {
                console.log(`📡 Lỗi kết nối Telegram, thử lại sau...`);
                // Có thể thêm logic retry ở đây
            }
        }
    }
    
    console.log(`📤 Broadcast: ${successCount} thành công, ${failCount} thất bại`);
    return { success: successCount, fail: failCount };
}

// --- AUTO REFRESH LOGIC ĐÃ CẢI TIẾN ---

async function runAutoAnalysis() {
    if (isAutoAnalysisRunning) {
        console.log('⏳ Auto analysis đang chạy, bỏ qua...');
        return;
    }

    const now = getVietnamTime();
    const currentHour = now.hours();
    const currentMinute = now.minutes();

    // Chỉ chạy từ 4h đến 23h30
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
            // Delay để tránh spam API Binance
            await new Promise(r => setTimeout(r, 1500)); 

            try {
                console.log(`🔍 Analyzing ${coin}...`);
                const result = await analyzeSymbol(coin);
                
                if (result && result.direction !== 'NEUTRAL' && result.direction !== 'NO_TRADE') {
                    // Điều kiện: Confidence Score từ 60-100%
                    if (result.confidence >= 60 && result.confidence <= 100) {
                        signalCountToday++;
                        signalsFound++;
                        const msg = formatSignalMessage(result, signalCountToday, 'bot');
                        
                        console.log(`✅ Signal found: ${coin} ${result.direction} (${result.confidence}%)`);
                        broadcastToAllUsers(msg);
                        
                        // Delay thêm sau khi gửi tín hiệu
                        await new Promise(r => setTimeout(r, 2000));
                    } else {
                        console.log(`⏭️ Skip ${coin}: Confidence ${result.confidence}% (need 60-100%)`);
                    }
                } else {
                    console.log(`➖ No signal for ${coin}: ${result?.direction}`);
                }
            } catch (coinError) {
                console.error(`❌ Error analyzing ${coin}:`, coinError.message);
                // Tiếp tục với coin tiếp theo
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

// Gửi lời chào mỗi ngày mới (Reset count)
function checkDailyGreeting() {
    const now = getVietnamTime();
    // Kiểm tra nếu là 4:00 AM
    if (now.hours() === 4 && now.minutes() === 0) {
        signalCountToday = 0; // Reset đếm tín hiệu
        const greetingMsg = "🌞 Chào ngày mới các nhà giao dịch! AI Trading Bot V3 đã sẵn sàng săn tìm cơ hội. Chúc mọi người Big Win! 🚀";
        broadcastToAllUsers(greetingMsg);
        console.log('🌞 Đã gửi lời chào buổi sáng');
    }
}

// Thiết lập Interval: 
// 1. Quét tín hiệu 2.5 tiếng/lần (2.5 * 60 * 60 * 1000 ms)
const ANALYSIS_INTERVAL = 2 * 60 * 60 * 1000;
setInterval(runAutoAnalysis, ANALYSIS_INTERVAL);

// 2. Kiểm tra giờ chào mỗi phút
setInterval(checkDailyGreeting, 60 * 1000);

// Chạy phân tích ngay khi khởi động (sau 10s)
setTimeout(() => {
    runAutoAnalysis();
}, 10000);

// --- BOT COMMANDS ĐÃ CẢI TIẾN ---

// /start - ĐĂNG KÝ NHẬN TIN NHẮN
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const user = msg.from;
    
    // Lưu user vào danh sách subscribers
    const userInfo = {
        id: user.id,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        subscribedAt: new Date()
    };
    
    subscribedUsers.set(chatId, userInfo);
    
    const userName = user.first_name || 'Trader';
    const welcomeMsg = `👋 Chào ${userName}!\n🧠 ĐÂY LÀ TOOL AI TRADING V3.\n\n🧠TOOL AI là bản nâng cấp của bản V2, theo AI tối đa 3% risk.\n👑 Bot created by Hoàng Dũng: @HOANGDUNGG789\n\n📢 Bạn đã đăng ký nhận tín hiệu tự động!`;

    const opts = {
        reply_markup: {
            keyboard: [
                ['📤 Gửi tín hiệu'],
                ['🔍 Analyze Symbol'],
                ['📊 Trạng thái bot']
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    };

    bot.sendMessage(chatId, welcomeMsg, opts);
    console.log(`✅ New user subscribed: ${user.username || user.first_name} (Total: ${subscribedUsers.size})`);
});

// Xử lý Menu Button và Lệnh Manual
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const user = subscribedUsers.get(chatId);

    if (!user) {
        // Nếu user chưa đăng ký, yêu cầu ấn /start
        return bot.sendMessage(chatId, 'Vui lòng ấn /start để đăng ký nhận tín hiệu!');
    }

    // Xử lý nút Menu
    if (text === '📤 Gửi tín hiệu') {
        const helpMsg = `Để gửi tín hiệu đến cộng đồng, hãy nhập theo cú pháp:\n\n` +
                       `🔹 <b>Ví dụ 1:</b> <code>/signal BTCUSDT LONG 50000 49000 52000</code>\n` +
                       `🔹 <b>Ví dụ 2:</b> <code>/signal ETHUSDT SHORT 2500 2550 2400</code>\n\n` +
                       `📝 <b>Format:</b> /signal [SYMBOL] [LONG/SHORT] [ENTRY] [STOPLOSS] [TAKEPROFIT]`;
        
        bot.sendMessage(chatId, helpMsg, { parse_mode: 'HTML' });
        
    } else if (text === '🔍 Analyze Symbol') {
        bot.sendMessage(chatId, 'Để phân tích coin cụ thể, hãy nhập lệnh:\n<code>/analyzesymbol BTCUSDT</code>', { parse_mode: 'HTML' });
        
    } else if (text === '📊 Trạng thái bot') {
        const statusMsg = `🤖 <b>TRẠNG THÁI BOT</b>\n\n` +
                         `👥 Users đăng ký: <b>${subscribedUsers.size}</b>\n` +
                         `📈 Tín hiệu hôm nay: <b>${signalCountToday}</b>\n` +
                         `⏰ Giờ hoạt động: <b>04:00 - 23:30</b>\n` +
                         `🔄 Chu kỳ quét: <b>2 giờ/lần</b>\n` +
                         `🎯 Ngưỡng tin cậy: <b>60-100%</b>`;
        
        bot.sendMessage(chatId, statusMsg, { parse_mode: 'HTML' });
    }

    // Xử lý lệnh gửi tín hiệu cộng đồng: /signal SYMBOL DIRECTION ENTRY SL TP
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

        // Validate input
        if (!['LONG', 'SHORT'].includes(direction)) {
            return bot.sendMessage(chatId, '❌ Direction phải là LONG hoặc SHORT');
        }

        if (isNaN(entry) || isNaN(sl) || isNaN(tp)) {
            return bot.sendMessage(chatId, '❌ Entry, SL, TP phải là số');
        }

        const rr = (Math.abs(tp - entry) / Math.abs(entry - sl)).toFixed(2);
        const userName = user.username ? `@${user.username}` : user.first_name;

        signalCountToday++;
        const userSignalMsg = `🤖 Tín hiệu [${signalCountToday} trong ngày]\n` +
                             `#${symbol.replace('USDT', '')} – [${direction}] 📌\n\n` +
                             `🟢 Entry: ${parseFloat(entry).toFixed(2)}\n` +
                             `🆗 Take Profit: ${parseFloat(tp).toFixed(2)}\n` +
                             `🙅‍♂️ Stop-Loss: ${parseFloat(sl).toFixed(2)}\n` +
                             `🪙 Tỉ lệ RR: ${rr}\n\n` +
                             `🧠 Shared by ${userName}\n\n` +
                             `⚠️ Nhất định phải tuân thủ quản lý rủi ro – Đi tối đa 1-2% risk\n🤖 Tín hiệu từ thành viên, tự verify lại`;

        // Gửi đến tất cả users đã đăng ký
        const broadcastResult = broadcastToAllUsers(userSignalMsg);
        bot.sendMessage(chatId, 
            `✅ Đã gửi tín hiệu đến ${broadcastResult.success} thành viên!\n` +
            `❌ ${broadcastResult.fail} gửi thất bại`
        );
    }
});

// /analyzesymbol [Coin]
bot.onText(/\/analyzesymbol (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    
    if (!subscribedUsers.has(chatId)) {
        return bot.sendMessage(chatId, 'Vui lòng ấn /start trước để sử dụng bot!');
    }

    let symbol = match[1].toUpperCase().trim();
    
    // Thêm USDT nếu user quên
    if (!symbol.endsWith('USDT')) symbol += 'USDT';

    const processingMsg = await bot.sendMessage(chatId, `⏳ Đang phân tích ${symbol}...\n📊 Loading multi-timeframe analysis`);

    try {
        const result = await analyzeSymbol(symbol);

        if (result && result.direction !== 'NEUTRAL' && result.direction !== 'NO_TRADE') {
            // Xóa message "đang xử lý"
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

// Lệnh /users để xem số lượng users (chỉ admin)
bot.onText(/\/users/, (msg) => {
    const chatId = msg.chat.id;
    // Simple admin check - bạn có thể thêm logic phức tạp hơn
    if (msg.from.username !== 'HOANGDUNGG789') {
        return bot.sendMessage(chatId, '❌ Bạn không có quyền sử dụng lệnh này');
    }
    
    let userList = `📊 <b>DANH SÁCH USERS</b> (${subscribedUsers.size} users)\n\n`;
    subscribedUsers.forEach((user, id) => {
        userList += `👤 ${user.username ? `@${user.username}` : user.first_name} - ${moment(user.subscribedAt).format('DD/MM HH:mm')}\n`;
    });
    
    bot.sendMessage(chatId, userList, { parse_mode: 'HTML' });
});

console.log('🤖 Bot is running with improved polling...');
console.log(`⏰ Auto analysis every 2 hours (04:00 - 23:30)`);
console.log(`🎯 Min confidence: 60% | Target coins: ${TARGET_COINS.length}`);
