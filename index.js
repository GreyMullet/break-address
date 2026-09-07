require('dotenv').config()
const path=require('path')
const express=require('express')
const axios=require('axios')
const { HttpsProxyAgent }=require('https-proxy-agent')

const app=express()
const PORT=process.env.PORT ?? 3000

app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.static(path.join(__dirname, 'public')))

const AI_PROVIDER=process.env.AI_PROVIDER || 'mistral'

const MISTRAL_API_KEY=process.env.MISTRAL_API_KEY
const MISTRAL_MODEL=process.env.MISTRAL_MODEL || 'mistral-small-latest'
const MISTRAL_URL='https://api.mistral.ai/v1/chat/completions'

const OPENROUTER_API_KEY=process.env.OPENROUTER_API_KEY
const OPENROUTER_MODEL=process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free'
const OPENROUTER_URL='https://openrouter.ai/api/v1/chat/completions'

const cache=new Map()
const CACHE_TTL_MS=1000*60*60*24

function getCacheKey(str){
    return str.toLowerCase().trim().replace(/\s+/g, ' ')
}

function getCached(key){
    const item=cache.get(key)
    if (!item) return null
    if (Date.now()>item.expiresAt){
        cache.delete(key)
        return null
    }
    return item.value
}

function setCached(key, value){
    cache.set(key, { value, expiresAt: Date.now()+CACHE_TTL_MS })
}

function hasIndex(input){
    return /(?<!\d)\d{5,6}(?!\d)/.test(input.trim())
}

function extractIndexFromString(input){
    const match=input.match(/(?<!\d)\d{5,6}(?!\d)/)
    return match ? match[0] : null
}

function extractJson(text){
    if (!text) throw new Error('Empty response from AI')
    let cleaned=text
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/gi, '')
        .trim()
    const match=cleaned.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('No JSON object found in response')
    return JSON.parse(match[0])
}

function validateResult(obj){
    const required=['index', 'region', 'district', 'city', 'street', 'address', 'corpus', 'flat']
    for (const key of required){
        if (!(key in obj)) throw new Error('Missing field: '+key)
        if (obj[key]!==null && typeof obj[key]!=='string'){
            obj[key]=String(obj[key])
        }
    }
    return obj
}

const SYSTEM_PROMPT=`Ты — сервис разбора российских почтовых адресов. Получаешь строку с адресом, возвращаешь ТОЛЬКО JSON-объект.

Правила:
1. Ответ — валидный JSON, без markdown (\`\`\`json), без пояснений, без текста вне JSON.
2. Поля:
   - "index": почтовый индекс (6 цифр), только если он ЯВНО указан в строке. Иначе null.
   - "region": регион/субъект РФ с типом. Примеры: "Московская область", "Краснодарский край", "Республика Татарстан", "г Санкт-Петербург".
   - "district": муниципальный район/улус/округ с типом. Примеры: "р-н Темрюкский", "улус Верхневилюйский". Или null.
   - "city": населённый пункт с типом. Город, посёлок, деревня, хутор, станица, село, ПГТ и т.д. Примеры: "г Москва", "п Восточный", "д Новинка", "с Ивановка", "пгт Красноармейский", "хутор Ленинский", "ст-ца Ленинградская", "рп Солнечный", "п Таманский".
   - "street": улица с типом. Примеры: "ул Ленина", "пр-кт Мира", "б-р Победы", "пер Садовый", "ш Каширское", "наб Реки Фонтанки", "пл Революции", "тупик Красный", "ул Спортивная". Или null.
   - "address": только номер дома. БЕЗ корпуса, строения и квартиры. Примеры: "д 15", "д 5/1", "д 100". Если номера нет — null.
   - "corpus": корпус, строение, сооружение. Примеры: "к 2", "стр 3", "с 1", "к 2 стр 3". Если нет — null.
   - "flat": квартира, офис, помещение. Примеры: "кв 45", "оф 20", "пом 5". Если нет — null.

3. Если в строке нет индекса — поле index = null, даже если ты знаешь индекс этого адреса.
4. Если адрес не содержит улицы — street = null.
5. Если населённый пункт — город федерального значения (Москва, СПб, Севастополь), region = "г Москва" и city = "г Москва".
6. Всегда включай тип в название: "г", "ул", "р-н", "п", "д", "с", "пгт", "ст-ца", "кв", "оф", "к", "стр" и т.д.
7. Если не уверен в каком-то поле — ставь null, не додумывай.

Примеры:

Вход: "123456, г Москва, ул Ленина, д 15, к 2, кв 45"
{"index":"123456","region":"г Москва","district":null,"city":"г Москва","street":"ул Ленина","address":"д 15","corpus":"к 2","flat":"кв 45"}

Вход: "РОССИЯ, 353546, Краснодарский край, Темрюкский р-н, Таманский п, Спортивная ул, 5/1"
{"index":"353546","region":"Краснодарский край","district":"р-н Темрюкский","city":"п Таманский","street":"ул Спортивная","address":"д 5/1","corpus":null,"flat":null}

Вход: "Краснодарский край, г Краснодар, ул Садовая, д 10"
{"index":null,"region":"Краснодарский край","district":null,"city":"г Краснодар","street":"ул Садовая","address":"д 10","corpus":null,"flat":null}

Вход: "Московская область, р-н Одинцовский, п Восточный, д 5"
{"index":null,"region":"Московская область","district":"р-н Одинцовский","city":"п Восточный","street":null,"address":"д 5","corpus":null,"flat":null}

Вход: "Республика Татарстан, г Казань, пр-кт Победы, д 100, к 1, оф 20"
{"index":null,"region":"Республика Татарстан","district":null,"city":"г Казань","street":"пр-кт Победы","address":"д 100","corpus":"к 1","flat":"оф 20"}

Вход: "ул Пушкина, д 10, кв 5, г Самара"
{"index":null,"region":null,"district":null,"city":"г Самара","street":"ул Пушкина","address":"д 10","corpus":null,"flat":"кв 5"}

Вход: "420000, Республика Татарстан, г Казань, ул Баумана, д 1"
{"index":"420000","region":"Республика Татарстан","district":null,"city":"г Казань","street":"ул Баумана","address":"д 1","corpus":null,"flat":null}

Вход: "д Новинка, с Ивановка, Костромская область"
{"index":null,"region":"Костромская область","district":null,"city":"с Ивановка","street":null,"address":null,"corpus":null,"flat":null}

Вход: "г Звенигород, Московская область, ул Мира, д 1"
{"index":null,"region":"Московская область","district":null,"city":"г Звенигород","street":"ул Мира","address":"д 1","corpus":null,"flat":null}

Вход: "197022, г Санкт-Петербург, наб Реки Фонтанки, д 1, кв 100"
{"index":"197022","region":"г Санкт-Петербург","district":null,"city":"г Санкт-Петербург","street":"наб Реки Фонтанки","address":"д 1","corpus":null,"flat":"кв 100"}

Вход: "д 15, к 2, стр 3, кв 45"
{"index":null,"region":null,"district":null,"city":null,"street":null,"address":"д 15","corpus":"к 2 стр 3","flat":"кв 45"}`

async function callMistral(address){
    if (!MISTRAL_API_KEY) throw new Error('MISTRAL_API_KEY not set')

    const response=await axios.post(
        MISTRAL_URL,
        {
            model: MISTRAL_MODEL,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: 'Разбери адрес: "'+address+'"' }
            ],
            temperature: 0.05,
            max_tokens: 512,
            response_format: { type: 'json_object' }
        },
        {
            headers: {
                'Authorization': 'Bearer '+MISTRAL_API_KEY,
                'Content-Type': 'application/json'
            },
            timeout: 15000
        }
    )

    return extractJson(response.data?.choices?.[0]?.message?.content)
}

async function callOpenRouter(address){
    if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY not set')

    const proxyUrl='http://165.154.162.73:8888'
    const proxyAgent=new HttpsProxyAgent(proxyUrl)

    const response=await axios.post(
        OPENROUTER_URL,
        {
            model: OPENROUTER_MODEL,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: 'Разбери адрес: "' + address + '"' }
            ],
            temperature: 0.05,
            max_tokens: 512,
            response_format: { type: 'json_object' }
        },
        {
            headers: {
                'Authorization': 'Bearer '+OPENROUTER_API_KEY,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'http://localhost:5000',
                'X-Title': 'Address Parser'
            },
            httpsAgent: proxyAgent,
            timeout: 15000
        }
    )

    return extractJson(response.data?.choices?.[0]?.message?.content)
}

async function parseAddress(str, maxRetries=3){
    const cacheKey=getCacheKey(str)
    const cached=getCached(cacheKey)
    if (cached) return cached

    const includeIndex=hasIndex(str)
    const extractedIndex=extractIndexFromString(str)

    const providers=AI_PROVIDER==='openrouter'
        ? ['openrouter', 'mistral']
        : ['mistral', 'openrouter']

    let lastError=null

    for (const provider of providers){
        let attempt=0
        while (attempt<maxRetries){
            try {
                let result=provider==='mistral'
                    ? await callMistral(str)
                    : await callOpenRouter(str)

                result=validateResult(result)

                if (!includeIndex){
                    result.index=null
                } else if (!result.index && extractedIndex){
                    result.index=extractedIndex
                }

                setCached(cacheKey, result)
                return result

            } catch (err){
                lastError=err
                console.error('['+provider+'] Attempt '+(attempt+1)+' failed:', err.message)
                attempt++
                if (attempt<maxRetries){
                    await new Promise(r=>setTimeout(r, 1000*Math.pow(2, attempt-1)))
                }
            }
        }
    }

    throw new Error('All providers failed. Last error: '+lastError?.message)
}

app.post('/break-address', async (req, res)=>{
    const { str }=req.body

    if (!str || typeof str!=='string'){
        return res.status(400).json({ error: 'Missing or invalid "str" field' })
    }

    if (!MISTRAL_API_KEY && !OPENROUTER_API_KEY){
        return res.status(500).json({
            error: 'No AI provider configured. Set MISTRAL_API_KEY or OPENROUTER_API_KEY in .env'
        })
    }

    try {
        const result=await parseAddress(str)
        res.json(result)
    } catch (error){
        console.error('Address parsing error:', error.message)
        res.status(500).json({
            error: 'Failed to parse address',
            details: error.message
        })
    }
})

app.listen(PORT, ()=>{
    console.log('App running on port '+PORT)
    console.log('Primary AI provider: '+AI_PROVIDER)
    console.log('   Mistral:    '+(MISTRAL_API_KEY ? 'OK' : '--')+' ('+MISTRAL_MODEL+')')
    console.log('   OpenRouter: '+(OPENROUTER_API_KEY ? 'OK' : '--')+' ('+OPENROUTER_MODEL+')')
})