express = require('express')
app = express()

BablicSeo = require('./Bablic_Seo')
options =
  site_id: '56fa51a1fe353b8c4d8d4291'
  default_cache: [ 'http://bablic.weebly.com/fr' ]
  alt_host: 'bablic.weebly.com'

app.use BablicSeo(options)
app.get '/', (req, res) ->
  res.status 200
  res.set 'Content-Type', 'text/html'
  res.write '<div>BABLIC WEBSITE TRANSLATION </div>'
  res.end '<div> YEAH </div>'
  console.log 'all sent'
app.listen 81