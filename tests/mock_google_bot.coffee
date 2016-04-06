request = require 'request'

request_options =
  url:'http://localhost:81'
  headers:
    'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'

request.get request_options, (error, response, body) ->
  if error
    console.log error
    return
  console.log body
  return
