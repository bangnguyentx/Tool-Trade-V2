const axios = require('axios');

// Cấu hình API
const BINANCE_API = {
    klines: (symbol, interval, limit = 500) => 
        `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
    price: (symbol) => 
        `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`,
    ticker24h: (symbol) => 
        `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`
};

const TIMEFRAMES = [
    { label: 'D1', interval: '1d', weight: 1.5 },
    { label: 'H4', interval: '4h', weight: 1.3 },
    { label: 'H1', interval: '1h', weight: 1.1 },
    { label: '15M', interval: '15m', weight: 0.8 }
];

// --- CÁC HÀM PHÂN TÍCH NÂNG CAO (GIỐNG HTML GỐC) ---

async function loadCandles(symbol, interval, limit = 500) {
    try {
        const response = await axios.get(BINANCE_API.klines(symbol, interval, limit));
        return response.data.map(candle => ({
            open: parseFloat(candle[1]),
            high: parseFloat(candle[2]),
            low: parseFloat(candle[3]),
            close: parseFloat(candle[4]),
            vol: parseFloat(candle[5]),
            t: candle[0]
        }));
    } catch (error) {
        throw new Error(`Failed to load candles for ${symbol} ${interval}: ${error.message}`);
    }
}

function calculateATR(candles, period = 14) {
    if (candles.length < period + 1) return 0;
    
    const trValues = [];
    for (let i = 1; i < candles.length; i++) {
        const tr = Math.max(
            candles[i].high - candles[i].low,
            Math.abs(candles[i].high - candles[i-1].close),
            Math.abs(candles[i].low - candles[i-1].close)
        );
        trValues.push(tr);
    }
    
    let atr = trValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trValues.length; i++) {
        atr = (atr * (period - 1) + trValues[i]) / period;
    }
    
    return atr;
}

function isSwingHigh(highs, index, lookback = 3) {
    for (let i = 1; i <= lookback; i++) {
        if (index - i >= 0 && highs[index] <= highs[index - i]) return false;
        if (index + i < highs.length && highs[index] <= highs[index + i]) return false;
    }
    return true;
}

function isSwingLow(lows, index, lookback = 3) {
    for (let i = 1; i <= lookback; i++) {
        if (index - i >= 0 && lows[index] >= lows[index - i]) return false;
        if (index + i < lows.length && lows[index] >= lows[index + i]) return false;
    }
    return true;
}

function analyzeAdvancedMarketStructure(candles) {
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    
    const structure = {
        swingHighs: [],
        swingLows: [],
        trend: 'neutral',
        breakOfStructure: false,
        changeOfCharacter: false
    };
    
    // Tìm swing points
    for (let i = 3; i < candles.length - 3; i++) {
        if (isSwingHigh(highs, i)) {
            structure.swingHighs.push({
                index: i,
                price: highs[i],
                time: candles[i].t
            });
        }
        if (isSwingLow(lows, i)) {
            structure.swingLows.push({
                index: i,
                price: lows[i],
                time: candles[i].t
            });
        }
    }
    
    // Xác định trend
    if (structure.swingHighs.length >= 2 && structure.swingLows.length >= 2) {
        const recentHighs = structure.swingHighs.slice(-2);
        const recentLows = structure.swingLows.slice(-2);
        
        if (recentHighs[1].price > recentHighs[0].price && recentLows[1].price > recentLows[0].price) {
            structure.trend = 'bullish';
        } else if (recentHighs[1].price < recentHighs[0].price && recentLows[1].price < recentLows[0].price) {
            structure.trend = 'bearish';
        }
    }
    
    // Kiểm tra Break of Structure và Change of Character
    structure.breakOfStructure = detectBreakOfStructure(structure);
    structure.changeOfCharacter = detectChangeOfCharacter(structure);
    
    return structure;
}

function detectBreakOfStructure(structure) {
    if (structure.swingHighs.length < 3 || structure.swingLows.length < 3) return false;
    
    const recentHighs = structure.swingHighs.slice(-3);
    const recentLows = structure.swingLows.slice(-3);
    
    if (structure.trend === 'bullish') {
        return recentHighs[2].price > recentHighs[1].price && recentHighs[1].price > recentHighs[0].price;
    } else if (structure.trend === 'bearish') {
        return recentLows[2].price < recentLows[1].price && recentLows[1].price < recentLows[0].price;
    }
    return false;
}

function detectChangeOfCharacter(structure) {
    if (structure.swingHighs.length < 3 || structure.swingLows.length < 3) return false;
    
    const recentHighs = structure.swingHighs.slice(-3);
    const recentLows = structure.swingLows.slice(-3);
    
    if (structure.trend === 'bullish') {
        return recentLows[2].price > recentLows[1].price && recentLows[1].price < recentLows[0].price;
    } else if (structure.trend === 'bearish') {
        return recentHighs[2].price < recentHighs[1].price && recentHighs[1].price > recentHighs[0].price;
    }
    return false;
}

function findOrderBlocks(candles) {
    const blocks = [];
    
    for (let i = 1; i < candles.length - 1; i++) {
        const current = candles[i];
        const next = candles[i + 1];
        
        // Bearish Order Block
        if (current.close < current.open && next.close < next.open && 
            Math.abs(next.close - next.open) > Math.abs(current.close - current.open) * 1.5) {
            blocks.push({
                type: 'bearish',
                high: current.high,
                low: current.low,
                time: current.t,
                strength: Math.random() * 0.5 + 0.5
            });
        }
        
        // Bullish Order Block
        if (current.close > current.open && next.close > next.open && 
            Math.abs(next.close - next.open) > Math.abs(current.close - current.open) * 1.5) {
            blocks.push({
                type: 'bullish',
                high: current.high,
                low: current.low,
                time: current.t,
                strength: Math.random() * 0.5 + 0.5
            });
        }
    }
    
    return blocks.slice(-10);
}

function findFairValueGaps(candles) {
    const gaps = [];
    
    for (let i = 1; i < candles.length - 1; i++) {
        const prev = candles[i - 1];
        const curr = candles[i];
        const next = candles[i + 1];
        
        // Bullish FVG
        if (curr.low > Math.max(prev.high, next.high)) {
            gaps.push({
                type: 'bullish',
                high: Math.min(prev.low, next.low),
                low: curr.high,
                time: curr.t,
                strength: Math.random() * 0.5 + 0.5
            });
        }
        
        // Bearish FVG
        if (curr.high < Math.min(prev.low, next.low)) {
            gaps.push({
                type: 'bearish',
                high: curr.low,
                low: Math.max(prev.high, next.high),
                time: curr.t,
                strength: Math.random() * 0.5 + 0.5
            });
        }
    }
    
    return gaps.slice(-8);
}

function analyzeVolumeProfile(candles) {
    const volumeByPrice = {};
    let totalVolume = 0;
    
    // Simplified volume profile
    candles.forEach(candle => {
        const range = candle.high - candle.low;
        const step = range / 10;
        for (let i = 0; i < 10; i++) {
            const priceLevel = (candle.low + step * i).toFixed(2);
            if (!volumeByPrice[priceLevel]) volumeByPrice[priceLevel] = 0;
            volumeByPrice[priceLevel] += candle.vol / 10;
        }
        totalVolume += candle.vol;
    });
    
    // Find POC (simplified)
    let poc = 0;
    let maxVolume = 0;
    for (const [price, volume] of Object.entries(volumeByPrice)) {
        if (volume > maxVolume) {
            maxVolume = volume;
            poc = parseFloat(price);
        }
    }
    
    return {
        poc,
        totalVolume,
        averageVolume: totalVolume / candles.length,
        volumeDelta: calculateVolumeDelta(candles)
    };
}

function calculateVolumeDelta(candles) {
    const recent = candles.slice(-5).reduce((sum, c) => sum + c.vol, 0) / 5;
    const older = candles.slice(-20, -5).reduce((sum, c) => sum + c.vol, 0) / 15;
    return recent / older;
}

function findLiquidityLevels(candles) {
    const levels = [];
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    
    // Find recent swing highs and lows as liquidity levels
    for (let i = 5; i < candles.length - 5; i++) {
        if (isSwingHigh(highs, i, 2)) {
            levels.push({
                type: 'resistance',
                price: highs[i],
                time: candles[i].t,
                strength: 'strong'
            });
        }
        if (isSwingLow(lows, i, 2)) {
            levels.push({
                type: 'support',
                price: lows[i],
                time: candles[i].t,
                strength: 'strong'
            });
        }
    }
    
    return levels.slice(-6);
}

function analyzeTimeframeICT(candles, timeframe) {
    if (candles.length === 0) return null;
    
    const price = candles[candles.length - 1].close;
    const marketStructure = analyzeAdvancedMarketStructure(candles);
    const orderBlocks = findOrderBlocks(candles);
    const fairValueGaps = findFairValueGaps(candles);
    const volumeAnalysis = analyzeVolumeProfile(candles);
    const liquidityLevels = findLiquidityLevels(candles);
    const atr = calculateATR(candles);
    
    return {
        price,
        trend: marketStructure.trend,
        strength: calculateTrendStrength(marketStructure),
        marketStructure,
        orderBlocks: filterRelevantLevels(orderBlocks, price),
        fairValueGaps: filterRelevantLevels(fairValueGaps, price),
        volumeAnalysis,
        liquidityLevels: filterRelevantLevels(liquidityLevels, price),
        atr,
        confidence: calculateTimeframeConfidence(marketStructure, volumeAnalysis, orderBlocks.length)
    };
}

function calculateTrendStrength(marketStructure) {
    if (marketStructure.swingHighs.length < 2 || marketStructure.swingLows.length < 2) return 0;
    
    const highSlope = (marketStructure.swingHighs[1].price - marketStructure.swingHighs[0].price) / 
                    (marketStructure.swingHighs[1].index - marketStructure.swingHighs[0].index);
    const lowSlope = (marketStructure.swingLows[1].price - marketStructure.swingLows[0].price) / 
                   (marketStructure.swingLows[1].index - marketStructure.swingLows[0].index);
    
    return Math.abs(highSlope + lowSlope) / 2;
}

function filterRelevantLevels(levels, currentPrice) {
    return levels.filter(level => {
        const distance = Math.abs(level.price - currentPrice) / currentPrice;
        return distance < 0.05; // Within 5%
    });
}

function calculateTimeframeConfidence(marketStructure, volumeAnalysis, obCount) {
    let confidence = 50;
    
    if (marketStructure.trend !== 'neutral') confidence += 20;
    if (volumeAnalysis.volumeDelta > 1.2) confidence += 15;
    if (obCount > 0) confidence += 10;
    
    return Math.min(95, confidence);
}

function calculateRealConfidence(results) {
    let totalScore = 0;
    let maxScore = 0;
    
    for (const [tf, data] of Object.entries(results.timeframes)) {
        const weight = getTimeframeWeight(tf);
        const tfScore = calculateTFScoreICT(data.analysis);
        
        totalScore += tfScore * weight;
        maxScore += 100 * weight;
    }
    
    const confluenceBonus = calculateConfluenceBonus(results);
    totalScore += confluenceBonus;
    
    return Math.min(100, (totalScore / maxScore) * 100);
}

function getTimeframeWeight(tf) {
    const weights = { 'D1': 1.5, 'H4': 1.3, 'H1': 1.1, '15M': 0.8 };
    return weights[tf] || 1.0;
}

function calculateTFScoreICT(analysis) {
    let score = 0;
    
    // Market Structure (0-35 points) - GIỐNG HTML GỐC
    score += analysis.marketStructure.trend !== 'neutral' ? 25 : 0;
    score += analysis.marketStructure.breakOfStructure ? 15 : 0;
    score += analysis.marketStructure.changeOfCharacter ? 8 : 0;
    
    // Volume Analysis (0-25 points)
    if (analysis.volumeAnalysis.volumeDelta) {
        score += Math.min(30, (analysis.volumeAnalysis.volumeDelta - 1) * 60);
    }
    
    // Order Blocks & FVG (0-35 points)
    score += Math.min(25, analysis.orderBlocks.length * 4);
    score += Math.min(20, analysis.fairValueGaps.length * 3);
    
    // Liquidity (0-20 points)
    if (analysis.liquidityLevels.length > 0) {
        score += 15;
        const nearLiquidity = analysis.liquidityLevels.some(level => 
            Math.abs(analysis.price - level.price) < analysis.atr * 0.5
        );
        if (nearLiquidity) score += 15;
    }
    
    return Math.min(100, score);
}

function calculateConfluenceBonus(results) {
    let bonus = 0;
    const timeframes = Object.values(results.timeframes);
    
    const bullishSignals = timeframes.filter(tf => 
        tf.analysis.trend === 'bullish' && 
        tf.analysis.orderBlocks.some(ob => ob.type === 'bullish')
    ).length;
    
    const bearishSignals = timeframes.filter(tf => 
        tf.analysis.trend === 'bearish' && 
        tf.analysis.orderBlocks.some(ob => ob.type === 'bearish')
    ).length;
    
    const confluence = Math.max(bullishSignals, bearishSignals);
    bonus = confluence * 8;
    
    return Math.min(30, bonus);
}

function calculateMultiTFBias(timeframes) {
    let bias = 0;
    
    timeframes.forEach((tf, index) => {
        const weight = TIMEFRAMES[index].weight;
        const analysis = tf.analysis;
        
        if (analysis.trend === 'bullish') bias += weight;
        else if (analysis.trend === 'bearish') bias -= weight;
        
        if (analysis.marketStructure.breakOfStructure) {
            if (analysis.marketStructure.trend === 'bullish') bias += weight * 0.5;
            else if (analysis.marketStructure.trend === 'bearish') bias -= weight * 0.5;
        }
    });
    
    return bias;
}

function findOptimalLongEntry(currentPrice, analysis, multiTimeframeAnalysis) {
    // Priority 1: Bullish Order Blocks
    const relevantOBs = analysis.orderBlocks.filter(ob => 
        ob.type === 'bullish' && currentPrice > ob.low && currentPrice < ob.high * 1.02
    );
    
    if (relevantOBs.length > 0) {
        const bestOB = relevantOBs.reduce((best, current) => 
            current.strength > best.strength ? current : best
        );
        return bestOB.low * 0.998;
    }
    
    // Priority 2: Bullish FVG
    const relevantFVGs = analysis.fairValueGaps.filter(fvg => 
        fvg.type === 'bullish' && currentPrice > fvg.low && currentPrice < fvg.high
    );
    
    if (relevantFVGs.length > 0) {
        const bestFVG = relevantFVGs[0];
        return Math.max(bestFVG.low, currentPrice * 0.995);
    }
    
    // Fallback: Support levels
    const supports = analysis.liquidityLevels
        .filter(level => level.type === 'support')
        .map(level => level.price)
        .filter(price => price < currentPrice)
        .sort((a, b) => b - a);
    
    if (supports.length > 0) {
        return supports[0] * 1.001;
    }
    
    return currentPrice * 0.998;
}

function findOptimalShortEntry(currentPrice, analysis, multiTimeframeAnalysis) {
    // Priority 1: Bearish Order Blocks
    const relevantOBs = analysis.orderBlocks.filter(ob => 
        ob.type === 'bearish' && currentPrice < ob.high && currentPrice > ob.low * 0.98
    );
    
    if (relevantOBs.length > 0) {
        const bestOB = relevantOBs.reduce((best, current) => 
            current.strength > best.strength ? current : best
        );
        return bestOB.high * 1.002;
    }
    
    // Priority 2: Bearish FVG
    const relevantFVGs = analysis.fairValueGaps.filter(fvg => 
        fvg.type === 'bearish' && currentPrice < fvg.high && currentPrice > fvg.low
    );
    
    if (relevantFVGs.length > 0) {
        const bestFVG = relevantFVGs[0];
        return Math.min(bestFVG.high, currentPrice * 1.005);
    }
    
    // Fallback: Resistance levels
    const resistances = analysis.liquidityLevels
        .filter(level => level.type === 'resistance')
        .map(level => level.price)
        .filter(price => price > currentPrice)
        .sort((a, b) => a - b);
    
    if (resistances.length > 0) {
        return resistances[0] * 0.999;
    }
    
    return currentPrice * 1.002;
}

function calculateSmartStopLoss(entry, direction, analysis, multiTimeframeAnalysis) {
    const atr = analysis.atr;
    
    if (direction === 'LONG') {
        const supports = analysis.liquidityLevels
            .filter(level => level.type === 'support')
            .map(level => level.price)
            .filter(price => price < entry)
            .sort((a, b) => b - a);
        
        if (supports.length > 0) {
            const nearestSupport = supports[0];
            const atrBasedSL = entry - (atr * 1.5);
            return Math.min(nearestSupport, atrBasedSL);
        }
        
        return entry - (atr * 2);
    } else {
        const resistances = analysis.liquidityLevels
            .filter(level => level.type === 'resistance')
            .map(level => level.price)
            .filter(price => price > entry)
            .sort((a, b) => a - b);
        
        if (resistances.length > 0) {
            const nearestResistance = resistances[0];
            const atrBasedSL = entry + (atr * 1.5);
            return Math.max(nearestResistance, atrBasedSL);
        }
        
        return entry + (atr * 2);
    }
}

function calculateSmartTakeProfit(entry, sl, direction, analysis, multiTimeframeAnalysis) {
    const risk = Math.abs(entry - sl);
    const atr = analysis.atr;
    
    if (direction === 'LONG') {
        const resistances = analysis.liquidityLevels
            .filter(level => level.type === 'resistance')
            .map(level => level.price)
            .filter(price => price > entry)
            .sort((a, b) => a - b);
        
        if (resistances.length > 0) {
            const nearestResistance = resistances[0];
            const minTP = entry + risk * 1.5;
            return Math.max(nearestResistance, minTP);
        }
        
        return entry + risk * 2.5;
    } else {
        const supports = analysis.liquidityLevels
            .filter(level => level.type === 'support')
            .map(level => level.price)
            .filter(price => price < entry)
            .sort((a, b) => b - a);
        
        if (supports.length > 0) {
            const nearestSupport = supports[0];
            const minTP = entry - risk * 1.5;
            return Math.min(nearestSupport, minTP);
        }
        
        return entry - risk * 2.5;
    }
}

function calculateSmartLevels(direction, currentPrice, analysis, multiTimeframeAnalysis) {
    const atr = analysis.atr;
    
    if (direction === 'LONG') {
        const entry = findOptimalLongEntry(currentPrice, analysis, multiTimeframeAnalysis);
        const sl = calculateSmartStopLoss(entry, direction, analysis, multiTimeframeAnalysis);
        const tp = calculateSmartTakeProfit(entry, sl, direction, analysis, multiTimeframeAnalysis);
        
        return { 
            entry: entry,
            sl: sl,
            tp: tp,
            rr: ((tp - entry) / (entry - sl)).toFixed(2)
        };
    } else {
        const entry = findOptimalShortEntry(currentPrice, analysis, multiTimeframeAnalysis);
        const sl = calculateSmartStopLoss(entry, direction, analysis, multiTimeframeAnalysis);
        const tp = calculateSmartTakeProfit(entry, sl, direction, analysis, multiTimeframeAnalysis);
        
        return { 
            entry: entry,
            sl: sl,
            tp: tp,
            rr: ((entry - tp) / (sl - entry)).toFixed(2)
        };
    }
}

function calculatePositionSize(riskPercent, accountBalance, entry, sl, direction) {
    const riskAmount = accountBalance * (riskPercent / 100);
    const riskPerUnit = Math.abs(entry - sl);
    const size = (riskAmount / riskPerUnit).toFixed(4);
    
    return {
        size: size,
        maxLoss: riskAmount.toFixed(2)
    };
}

// --- HÀM CHÍNH ĐỂ GỌI TỪ BÊN NGOÀI ---

async function analyzeSymbol(symbol) {
    try {
        const results = {
            timeframes: {},
            marketStructure: {},
            volumeAnalysis: {},
            signals: {},
            ictConcepts: {}
        };

        // Analyze each timeframe với ICT
        for (const tf of TIMEFRAMES) {
            try {
                const candles = await loadCandles(symbol, tf.interval, 300);
                results.timeframes[tf.label] = {
                    candles,
                    price: candles[candles.length - 1].close,
                    analysis: analyzeTimeframeICT(candles, tf.label)
                };
            } catch (error) {
                console.error(`Error analyzing ${tf.label}:`, error.message);
                // Continue with other timeframes
            }
        }

        // Generate trading signals với ICT
        const timeframes = Object.values(results.timeframes);
        if (timeframes.length === 0) {
            return {
                symbol,
                direction: 'NO_TRADE',
                confidence: 0,
                reason: 'No timeframe data available'
            };
        }

        const currentPrice = timeframes[0].price;
        const bias = calculateMultiTFBias(timeframes);
        const confidence = calculateRealConfidence(results);

        // Check minimum confidence
        if (confidence < 60) {
            return {
                symbol,
                direction: 'NO_TRADE',
                confidence: Math.round(confidence),
                reason: `Confidence ${Math.round(confidence)}% < Minimum 60%`
            };
        }
        
        const direction = bias > 0.5 ? 'LONG' : bias < -0.5 ? 'SHORT' : 'NEUTRAL';
        
        if (direction === 'NEUTRAL') {
            return {
                symbol,
                direction: 'NEUTRAL',
                confidence: Math.round(confidence),
                reason: 'No clear bias across timeframes'
            };
        }
        
        // Calculate smart levels
        const primaryAnalysis = timeframes.find(tf => tf.analysis.confidence > 70) || timeframes[0];
        const levels = calculateSmartLevels(direction, currentPrice, primaryAnalysis.analysis, results);
        
        // Calculate position size
        const positionData = calculatePositionSize(2, 1000, parseFloat(levels.entry), parseFloat(levels.sl), direction);
        
        return {
            symbol,
            direction,
            confidence: Math.round(confidence),
            entry: levels.entry.toFixed(4),
            sl: levels.sl.toFixed(4),         // ✅ Đã sửa thành sl
            tp: levels.tp.toFixed(4),         // ✅ Đã sửa thành tp
            rr: levels.rr,
            positionSize: positionData.size,
            maxLoss: positionData.maxLoss
        };

        
    } catch (error) {
        console.error(`Error analyzing ${symbol}:`, error);
        return {
            symbol,
            direction: 'NO_TRADE',
            confidence: 0,
            reason: `Analysis error: ${error.message}`
        };
    }
}

module.exports = { analyzeSymbol };
