_ = require 'lodash'
async = require 'async'
crypto = require 'crypto'
cookie = require 'cookie'
fs = require 'fs'
moment = require 'moment'
OS = require 'os'
request = require 'request'
debug = require 'debug'
debug = debug 'bablic:seo'
url_parser = require 'url'
qs_parser = require 'querystring'

meta = null
snippet = ''

module.exports = (options) ->
  options = _.defaultsDeep options,
    site_id: null
    root_url: null
    subdir: false
    seo:
      use_cache: true
      default_cache: null
    test: false

  unless (options.site_id)
    throw new Error('Middleware requires and site_id')

  if options.seo
    options.seo.site_id = options.site_id
    if options.subdir
      options.seo.subdir = true
    SEO = require('./seo')(options.seo)

  snippet_url = -> "#{OS.tmpdir()}/snippet"

  get_data = (cb) ->
    debug 'getting from bablic'
    ops =
      url: "https://www.bablic.com/api/v1/site/#{options.site_id}?channel_id=node"
      method: 'GET'
    request ops, (error, response, body) ->
      if error?
        return cb error
      unless body?
        return cb new Error('empty response')
      try
        data = JSON.parse body
        debug 'data:', data
        save_data(body)
        cb null, data
        register_callback()
      catch e
        debug

  detect_locale_from_header = (req) ->
    langs = req.headers['accept-language'].split(',') if req.headers['accept-language']
    if langs?.length > 0
      return langs[0].replace('-','_')
    return false

  detect_locale_from_cookie = (req) ->
    return false unless req.headers['cookie']
    return false unless meta['localeKeys']
    if req.cookies?
      bablicookie = req.cookies['bab_locale']
    else
      cookies = cookie.parse(req.headers['cookie'])
      bablicookie = cookies['bab_locale']
    return false unless bablicookie
    match_index = meta['localeKeys'].indexOf bablicookie
    if match_index < 0
      match_index  = meta['localeKeys'].indexOf bablicookie.substr(0, 2)
    unless match_index < 0
      return meta['localeKeys'][match_index]
    return false

  get_current_url = (req) -> "http://#{req.host}#{req.originalUrl}"

  get_locale = (req) =>
    auto = meta['autoDetect']
    default_locale = meta['default']
    custom_urls = meta['customUrls']
    locale_keys = meta['localeKeys']
    locale_detection = meta['localeDetection']
    detected = ''
    if (auto and locale_keys)
      detected_lang = detect_locale_from_header req
      if detected_lang
        match_index = locale_keys.indexOf detected_lang
        if match_index < 0
          match_index = locale_keys.indexOf detected_lang.substr(0, 2)
        unless match_index < 0
          detected = locale_keys[match_index]

    from_cookie = detect_locale_from_cookie req
    if options.sub_dir
      locale_detection = 'subdir'
    switch locale_detection
      when 'querystring'
        return req.query['locale'] or from_cookie or detected or default_locale

      when 'subdir'
        match = /^(\/(\w\w(_\w\w)?))(?:\/|$)/.exec(req.originalUrl)
        return match[2] if match
        return detected or default_locale

      when 'custom'
        create_domain_rule = (str) ->
          return RegExp((str+'').replace(/([.?+^$[\]\\(){}|-])/g, "\\$1").replace(/\*/g,'.*'),'i')

        for key, value of custom_urls
          if create_domain_rule(value).test(get_current_url(req))
            return key
        return default_locale

      else
        return from_cookie
    return

  save_data = (bablic_data) ->
    bablic_data.id = options.site_id
    fs.writeFile snippet_url(), bablic_data, (error) ->
      if error
        console.error 'Error saving snippet to cache', error

  load_data = (cb) ->
    fs.readFile snippet_url(), (error, data) ->
      unless error
        try
          debug 'reading from temp file'
          try
            object = JSON.parse(data)
            if object.id isnt options.site_id
              debug 'not of this site id'
              return get_data cb
            cb null, object
          catch e
            debug e
            return get_data cb

          debug 'checking snippet time'
          fs.stat snippet_url(), (error, file_stats) ->
            if error
              return
            last_modified = moment file_stats.mtime.getTime()
            now = moment()
            last_modified.add 4, 'hours'
            if now.isBefore(last_modified)
              return debug 'snippet cache is good'
            debug 'refresh snippet'
            get_data cb
        catch e
          get_data cb
      else
        get_data cb

  load_data (error, data) =>
    if error
      debug "Error:", error
      debug error
      return
    snippet = data.snippet
    meta = data.meta
    debug 'snippet loaded', data.meta
    return

  handle_bablic_callback = (req, res) =>
    if req.body.event is 'snippet'
      snippet = req.body.data.snippet
      meta = req.body.data.meta
    res.send 'OK'
    return

  register_callback = () ->
    root = options.root_url or ''
    if root
      # make sure it works if user didnt use protocol
      if root.substr(0,4) isnt 'http'
        root = 'http://' + root
      # strip to have only protocol & domain
      parsed = url_parser.parse root
      root = parsed.protocol + '//' + parsed.host
    debug 'registering callback', root
    ops =
      url: "https://www.bablic.com/api/v1/site/#{options.site_id}?channel_id=node"
      method: 'PUT'
      json:
        callback: "#{root}/_bablicCallback"
    request ops, (error, response, body) ->
      if error?
        debug "setting callback failed"
      return




  get_link = (locale, url) ->
    parsed = url_parser.parse url
    protocol = if parsed.protocol then parsed.protocol + '//' else ''
    host = parsed.host or ''
    path = parsed.pathname or ''
    query = parsed.query or ''
    hash = parsed.hash or ''
    locale_detection = meta['localeDetection']
    if options.subdir
      locale_detection = 'subdir';
    if (locale_detection is 'custom') and (!meta['customUrls'])
      locale_detection = 'querystring';

    switch locale_detection
      when 'custom'
        custom_url = meta['customUrls'][locale]
        if custom_url
          protocol = protocol or 'http://'
          if custom_url.indexOf('?') > -1
            [custom_url,qs] = custom_url.split '?'
            query = '?' + qs
          if custom_url.indexOf('/') > -1
            parts = custom_url.split '/'
            custom_url = parts.shift()
            path = '/' + parts.join('/')
          host = custom_url

      when 'querystring'
        query_parsed = {}
        if query
          query_parsed = qs_parser.parse(query.substr(1))
        query_parsed['locale'] = locale
        query = '?' + qs_parser.stringify(query_parsed)

      when 'subdir'
        locale_keys = meta['localeKeys'] or []
        locale_regex = RegExp('^\\/(' + locale_keys.join('|') + ')\\b')
        path = path.replace(locale_regex,'')
        if locale isnt meta['original']
          path = '/' + locale + path

      when 'hash'
        hash = '#locale_' + locale
    return protocol + host + path + query + hash

  alt_tags = (url, locale) ->
    locales = meta['localeKeys'] or []
    locales = locales.slice()
    locales.unshift meta['original']
    locales.map (l) ->
      if l is locale
        return ''
      return '<link rel="alternate" href="' + get_link(l,url) + '" hreflang="' + l + '">'
    .join('')


  return (req, res, next) ->

    if req.originalUrl is '/_bablicCallback' and req.method is 'POST'
      debug 'Redirecting to Bablic callback'
      return handle_bablic_callback req, res

    unless meta
      debug 'not loaded yet'
      req.bablic =
        locale:''
      extend_locals =
        bablic:
          locale: ''
          snippet: ''
          snippetBottom: '<!-- Bablic Footer OFF -->'
          snippetTop: '<!-- Bablic Head OFF -->'

      if typeof(res.locals) == 'function'
        res.locals extend_locals
      else
        _.extend res.locals, extend_locals

      return next()

    locale = get_locale(req)

    req.bablic =
      locale: locale

    _snippet = snippet

    if options.subdir and meta['localeKeys']
      LOCALE_REGEX = RegExp('^\\/(' + meta['localeKeys'].join('|') + ')\\b')
      req.url = req.url.replace(LOCALE_REGEX, '')
      _snippet = '<script type="text/javascript">var bablic=bablic||{};bablic.localeURL="subdir"</script>' + _snippet

    top = if meta.original isnt locale then _snippet else ''
    bottom = if meta.original is locale then _snippet else ''

    extend_locals =
      bablic:
        locale: locale
        snippet: _snippet
        snippetBottom: '<!-- Bablic Footer -->' + bottom + '<!-- /Bablic Footer -->'
        snippetTop: '<!-- Bablic Head -->' + alt_tags(req.originalUrl,locale) + top + '<!-- /Bablic Head -->'

    if typeof(res.locals) == 'function'
      res.locals extend_locals
    else
      _.extend res.locals, extend_locals

    unless SEO?
      return next()


    if locale is meta.original
      debug 'ignored', req.url
      return next()
    return SEO req, res, next
