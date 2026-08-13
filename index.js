require('dotenv').config();
const path = require('path');
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Конфигурация DaData ---
const DADATA_API_KEY = process.env.DADATA_API_KEY;
const DADATA_SECRET_KEY = process.env.DADATA_SECRET_KEY;
const DADATA_URL = 'https://cleaner.dadata.ru/api/v1/clean/address';

// --- Вспомогательные функции ---

// Достаём индекс напрямую из строки, если DaData его не вернула.
// Российский индекс — ровно 6 цифр, не являющихся частью более длинного числа.
function extractIndexFallback(str) {
    const match = str.match(/(?<!\d)\d{6}(?!\d)/);
    return match ? match[0] : null;
}

// Пытаемся вытащить номер участка ("з/у 1", "уч. 5", "участок №3") из
// неразобранного DaData хвоста строки.
function extractPlotNumber(unparsedParts) {
    if (!unparsedParts) return null;
    const match = unparsedParts.match(
        /(?:з\/у|зу|уч(?:асток)?|надел)\.?\s*№?\s*(\d+[а-яёА-ЯЁ]?)/i
    );
    return match ? match[1] : null;
}

// То же самое, но как последний fallback — ищем паттерн участка прямо
// в исходной строке (на случай если DaData вообще не вернула unparsed_parts).
function extractPlotNumberFromSource(str) {
    return extractPlotNumber(str);
}

// Формируем номер дома / участка из полей DaData, с fallback на "голый" участок
function formatHouse(data, sourceStr) {
    const parts = [];
    if (data.house_type && data.house) {
        parts.push(`${data.house_type} ${data.house}`);
    } else if (data.house) {
        parts.push(data.house);
    }
    if (data.block) {
        parts.push(`к${data.block}`);
    }
    if (data.structure) {
        parts.push(`стр${data.structure}`);
    }
    if (data.building) {
        parts.push(`с${data.building}`);
    }
    if (data.flat) {
        parts.push(`кв${data.flat}`);
    }

    if (parts.length) {
        return parts.join(' ');
    }

    // DaData не распознала дом/участок как отдельное поле — ищем цифру
    // сначала в её "неразобранном хвосте", потом прямо в исходной строке.
    const plotFromUnparsed = extractPlotNumber(data.unparsed_parts);
    if (plotFromUnparsed) return plotFromUnparsed;

    const plotFromSource = extractPlotNumberFromSource(sourceStr);
    if (plotFromSource) return plotFromSource;

    return null;
}

// Формируем регион: "Краснодарский край"
function formatRegion(data) {
    if (data.region_type && data.region) {
        return `${data.region} ${data.region_type}`;
    }
    return data.region || null;
}

// Формируем город: "г Краснодар"
function formatCity(data) {
    if (data.city_type && data.city) {
        return `${data.city_type} ${data.city}`;
    }
    return data.city || null;
}

// Формируем район: "Первомайский р-н"
function formatDistrict(data) {
    if (data.area_type && data.area) {
        return `${data.area} ${data.area_type}`;
    }
    return data.area || null;
}

// --- Эндпоинт ---
app.post('/break-address', async (req, res) => {
    const { str } = req.body;

    if (!str) {
        return res.status(400).json({ error: 'Missing "str" field' });
    }

    if (!DADATA_API_KEY || !DADATA_SECRET_KEY) {
        console.error('DaData API keys are not set in .env');
        return res.status(500).json({ error: 'Server configuration error' });
    }

    try {
        const response = await axios.post(
            DADATA_URL,
            [str],
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Token ${DADATA_API_KEY}`,
                    'X-Secret': DADATA_SECRET_KEY,
                }
            }
        );

        const data = response.data[0];

        // Если DaData вообще ничего не вернула по строке (например, строка
        // состоит из одного индекса) — не валим запрос ошибкой 404, а даём
        // fallback-логике ниже шанс собрать хоть что-то из исходной строки.
        const safeData = data || {};

        // Индекс: сперва то, что распознала DaData, иначе — вытаскиваем
        // 6-значное число прямо из исходной строки.
        const index = safeData.postal_code || extractIndexFallback(str);

        const result = {
            index: index || null,
            region: formatRegion(safeData),
            district: formatDistrict(safeData),
            city: formatCity(safeData),
            street: safeData.street || null,
            address: formatHouse(safeData, str)
        };

        res.json(result);

    } catch (error) {
        console.error('DaData API error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to parse address' });
    }
});

app.listen(PORT, () => {
    console.log(`App running on port ${PORT}`);
});