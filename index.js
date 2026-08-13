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

    const splitedStr=str.split(',').map(el => el.trim())
    const first=splitedStr[0] || ''
    const second=splitedStr[1] || ''
    const third=splitedStr[2] || ''
    const fourth=splitedStr[3] || ''
    const fifth=splitedStr[4] || ''
    const sixths=splitedStr[5] || ''
    const seventh=splitedStr[6] || ''

    const testFirst=/^\d+$/.test(first)

    const country=(first && !testFirst) ? first : ''
    const index=(second && !testFirst) ? second : splitedStr[0]
    const region=(third && !testFirst) ? third : splitedStr[1]
    const district=(fourth && !testFirst) ? fourth : splitedStr[2]
    const city=(fifth && !testFirst) ? fifth : splitedStr[3]
    const street=(sixths && !testFirst) ? sixths : splitedStr[4]
    const address=(seventh && !testFirst) ? seventh : splitedStr[5]

    const result={
        country: country,
        index: index,
        region: region,
        district: district,
        city: city,
        street: street,
        address: address
    };

    res.json(result)
})

app.listen(PORT, ()=>{
    console.log(`App running on port ${PORT}`)
})