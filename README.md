# Bablic-Node-SDK

To install simply use NPM:
```sh
$ npm install --save bablic
```

Config your app:
```sh
bablic = require('bablic')

options =
  site_id: '[your site id from Bablic]'
  default_cache: [
    'http://some.site.url/'
  ]

app.use bablic.seo(options)
```

And use!
