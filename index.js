require('dotenv').config()
const path=require('path')
const express=require('express')
const app=express()

const PORT=process.env.PORT ?? 3000

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.use(express.static(path.join(__dirname, 'public')))

app.post('/break-address', (req, res)=>{
    const { str }=req.body
    if (!str){
        return res.status(400).json({ error: 'Missing "str" field' })
    }
    const splitedStr=str.split(",").map(el=>el.trim())
    const result={
        country: splitedStr[0] || "",
        index: splitedStr[1] || "",
        region: splitedStr[2] || "",
        district: splitedStr[3] || "",
        city: splitedStr[4] || "",
        street: splitedStr[5] || "",
        address: splitedStr[6] || ""
    }

    res.json(result)
})

app.listen(PORT, ()=>{
    console.log(`App running on port ${PORT}`)
})