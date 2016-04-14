express = require 'express'
app = express()
BablicSeo = require('./Bablic_Seo')

options =
  site_id: '56fa51a1fe353b8c4d8d4291'
  default_cache: ['http://bablic.weebly.com/fr']

app.use BablicSeo(options)

app.get '/', (req, res) ->
  res.status 200
  res.write 'About'
  console.log 'sent About'
  res.end(' a horse')

app.listen 81