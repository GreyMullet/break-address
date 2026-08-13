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

    const parts=str.split(',').map(el => el.trim())
    const first=parts[0] || ''
    const isIndex=/^\d+$/.test(first)

    let country, index, region, district, city, street, address

    if (isIndex){
        country=''
        index=first
        region=parts[1] || ''
        district=parts[2] || ''
        city=parts[3] || ''
        street=parts[4] || ''
        address=parts[5] || ''
    } else{
        country=first
        index=parts[1] || ''
        region=parts[2] || ''
        district=parts[3] || ''
        city=parts[4] || ''
        street=parts[5] || ''
        address=parts[6] || ''
    }

    const result={ country, index, region, district, city, street, address }
    res.json(result)
})

app.listen(PORT, ()=>{
    console.log(`App running on port ${PORT}`)
})