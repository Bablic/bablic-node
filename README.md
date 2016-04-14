# Bablic-Seo

To install simply use NPM:
```sh
$ npm install --save Bablic_Seo_SDK
```

Config your app:
```sh
BablicSeo = require('Bablic_Seo_SDK')

options =
  site_id: '[your site id from Bablic]'
  default_cache: [
    'http://some.site.url/'
  ]

app.use BablicSeo(options)
```

And use!