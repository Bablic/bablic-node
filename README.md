# Bablic-Node-SDK

To install simply use NPM:
```sh
$ npm install --save bablic
```

Config your app:
```sh
bablic = require('bablic');

app.use(bablic.seo({
  site_id: '[your site id from Bablic]',
  default_cache: [
    'http://some.site.url/'
  ]
}));
```

And use!
