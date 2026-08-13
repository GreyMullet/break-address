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

// Проверяем, начинается ли строка с индекса (5-6 цифр, опционально запятая)
function hasIndex(input) {
    return /^\s*\d{5,6}\s*(?:,|$)/.test(input.trim());
}

// Формируем номер дома / участка из полей DaData
function formatHouse(data) {
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
    return parts.length ? parts.join(' ') : null;
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
        if (!data) {
            return res.status(404).json({ error: 'Address not recognized' });
        }

        // Индекс возвращаем только если он был в исходной строке
        const includeIndex = hasIndex(str);

        const result = {
            index: includeIndex ? data.postal_code : null,
            region: formatRegion(data),
            district: data.area || null,
            city: formatCity(data),
            street: data.street || null,
            address: formatHouse(data) // только номер / участок
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