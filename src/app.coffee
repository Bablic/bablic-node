express = require 'express'
app = express()
request = require 'request'
crypto = require 'crypto'
OS = require 'os'
fs = require 'fs'
async = require 'async'
moment = require 'moment'


#http://dev.bablic.com/api/engine/seo?site=56e7e95e374c81ab110e4cb4&url=http://lemonberry.com/?locale=es

#<middleware>

BablicSeo = (options) ->
  if options.default_cache?
    setTimeout preload, 30000

  preload = ->
    preloads = []
    for url in options.default_cache
      preloads.push ->
        get_html url, (error) ->
          if error?
            console.error "Bablic SDK Error: url #{url} failed preloading"
    async.series preloads
    return

  get_html = (url, cbk) ->
    ops =
      url: "http://dev.bablic.com/api/engine/seo?site=#{options.site_id}&url=#{url}"
      method: 'POST'
    request ops, (error, response, body) ->
      if error?
        return cbk error
      fs.writeFile full_path_from_url(url), body, (error) ->
        if error
          return cbk error
        cbk null, body
      return

  full_path_from_url = (url) -> OS.tmpdir()+'/'+ crypto.createHash('md5').update(url).digest('hex')

  get_from_cache = (url) ->
    file_path = full_path_from_url url
    try
      file_stats = fs.statSync(file_path)
      last_modified = moment file_stats.mtime.getTime()
      now = moment()
      last_modified.add options.TTL, 'days'
      if now.isBefore(last_modified)
        return fs.readFileSync file_path
    return null

  return (req, res, next) ->
    google_tester = new RegExp /bot|crawler|baiduspider|80legs|mediapartners-google|adsbot-google/i
    is_bot = google_tester.test req.headers['user-agent']
    if is_bot
      console.log 'found bot'
      my_url = "http://#{req.headers.host}#{req.url}"
      my_url = 'http://lemonberry.com/'
      html = get_from_cache my_url
      return res.send(html) if html?
      get_html my_url, (error, data) ->
        if error?
          console.error 'Bablic SDK Error:', error
          return next()
        return res.send data
      return
    return next()

options =
  site_id: '56e7e95e374c81ab110e4cb4'
  TTL: 2
  default_cache: ['/']

app.use BablicSeo(options)

#</middleware>

app.get '/', (req, res) ->
  res.send 'No'
  console.log 'no'

app.listen 81

